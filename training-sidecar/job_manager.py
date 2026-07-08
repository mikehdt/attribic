"""Training job lifecycle management."""

import asyncio
import json
import math
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from job_registry import JobKind, JobRegistry, LifecycleStatus
from models import (
    JobProgress,
    JobState,
    JobStatus,
    LossPoint,
    StartJobRequest,
    StartJobResponse,
)
from providers.base import TrainingProvider
from ws_manager import WebSocketManager


_TERMINAL_TRAINING_STATUSES = (
    JobStatus.COMPLETED,
    JobStatus.FAILED,
    JobStatus.CANCELLED,
)

# Upper bound on the accumulated loss series. Once exceeded we halve the
# series (keep every other point) and double the sampling stride, so a long
# run stays bounded while keeping an even spread across the whole timeline.
_MAX_LOSS_POINTS = 1000

# Minimum wall-clock gap between routine (non-terminal, no-new-save) disk
# writes of a job's JSON. Progress ticks arrive ~1/sec and the file grows to
# ~59KB at the loss cap, so rewriting it every tick is wasteful. Terminal
# updates, fresh checkpoint confirmations, and the first update always persist
# immediately regardless of this throttle.
_PERSIST_THROTTLE_SECONDS = 5.0


def predict_checkpoint_steps(hyperparameters: dict) -> list[int]:
    """Predict the step positions at which checkpoints will be written.

    Mirrors the client-side `deriveCheckpointSteps` (see
    src/app/store/training/training-runtime.ts) but reads the snake_case
    hyperparameters the sidecar actually receives. The Node side sends the
    save cadence in the user's chosen unit — `save_every_n_steps` for
    step-based saving, `save_every_n_epochs` for epoch-based (0/0 = disabled) —
    with steps taking precedence, matching what the providers pass to their
    backends.
    """
    hp = hyperparameters or {}
    total_steps = int(hp.get("steps", 0) or 0)
    epochs = int(hp.get("epochs", 0) or 0)
    if total_steps <= 0:
        return []

    save_every_steps = int(hp.get("save_every_n_steps", 0) or 0)
    if save_every_steps > 0:
        return list(range(save_every_steps, total_steps + 1, save_every_steps))

    save_every_epochs = int(hp.get("save_every_n_epochs", 0) or 0)
    if save_every_epochs <= 0 or epochs <= 0:
        return []

    steps_per_epoch = max(1, math.ceil(total_steps / epochs))
    out: list[int] = []
    epoch = save_every_epochs
    while epoch <= epochs:
        out.append(min(epoch * steps_per_epoch, total_steps))
        epoch += save_every_epochs
    return out


def _lifecycle_from_training(status: JobStatus) -> LifecycleStatus:
    """Map the training-specific JobStatus onto the shared lifecycle vocabulary.

    PENDING / PREPARING / TRAINING all collapse to RUNNING — the sub-phase
    detail stays in the progress payload.
    """
    if status == JobStatus.COMPLETED:
        return LifecycleStatus.COMPLETED
    if status == JobStatus.FAILED:
        return LifecycleStatus.FAILED
    if status == JobStatus.CANCELLED:
        return LifecycleStatus.CANCELLED
    return LifecycleStatus.RUNNING


class JobManager:
    """Manages training job lifecycle, state persistence, and progress broadcasting.

    Training jobs are enqueued via the shared JobRegistry; a worker loop picks
    them up and invokes the runner. Multiple jobs may be tracked simultaneously
    (queued + running + terminal), keyed by job_id in `_jobs`.
    """

    def __init__(
        self,
        jobs_dir: Path,
        ws_manager: WebSocketManager,
        registry: JobRegistry,
    ):
        self._jobs_dir = jobs_dir
        self._ws = ws_manager
        self._registry = registry
        self._jobs: dict[str, JobState] = {}
        self._providers: dict[str, TrainingProvider] = {}
        # Central per-job loss/checkpoint accumulator, keyed by job_id. Holds
        # the growing loss series, downsample stride, and the confirmed-save
        # set so providers can stay stateless (they report only the latest
        # loss and any newly-confirmed save step). Seeded lazily from the
        # persisted progress when missing (e.g. cancel path).
        self._accumulators: dict[str, dict] = {}
        # Per-job monotonic timestamp of the last disk persist, used to
        # throttle routine progress-tick writes (see _update_progress).
        self._last_persist_at: dict[str, float] = {}

        # Try to recover state from a previous run
        self._recover_state()

    def register_provider(self, name: str, provider: TrainingProvider):
        """Register a training provider (e.g. 'ai-toolkit', 'kohya')."""
        self._providers[name] = provider

    @property
    def providers(self) -> dict[str, TrainingProvider]:
        return self._providers

    @property
    def active_job_id(self) -> Optional[str]:
        """ID of the currently running training job, if any."""
        for rec in self._registry.running_jobs():
            if rec.kind == JobKind.TRAINING:
                return rec.id
        return None

    def _focus_job(self) -> Optional[JobState]:
        """Pick the most relevant job for the single-job status view.

        Priority: running training job, else oldest queued training job, else
        newest terminal training job. Mirrors the pre-queue behaviour where
        the status endpoint returned a single training job state.
        """
        for rec in self._registry.running_jobs():
            if rec.kind == JobKind.TRAINING and rec.id in self._jobs:
                return self._jobs[rec.id]
        for rec in self._registry.queued_jobs():
            if rec.kind == JobKind.TRAINING and rec.id in self._jobs:
                return self._jobs[rec.id]
        terminal = [
            j for j in self._jobs.values() if j.status in _TERMINAL_TRAINING_STATUSES
        ]
        if terminal:
            terminal.sort(key=lambda j: j.completed_at or "", reverse=True)
            return terminal[0]
        return None

    def get_status(self) -> Optional[dict]:
        """Get the focus job's state as a dict, or None if no training jobs tracked.

        Includes the registry's queue position for queued jobs so the client
        can show placement.
        """
        job = self._focus_job()
        if job is None:
            return None
        data = job.model_dump()
        position = self._registry.queue_position(job.job_id)
        if position > 0:
            data["queue_position"] = position
        return data

    async def start_job(self, request: StartJobRequest) -> StartJobResponse:
        """Create a training job and enqueue it. Returns immediately.

        The job starts in QUEUED lifecycle status; when a worker picks it up,
        it transitions to RUNNING and the provider's training loop begins.
        """
        provider = self._providers.get(request.provider.value)
        if provider is None:
            raise RuntimeError(
                f"Provider '{request.provider.value}' is not registered. "
                f"Available: {list(self._providers.keys())}"
            )

        job_id = uuid.uuid4().hex[:12]
        now = datetime.now(timezone.utc).isoformat()
        # Predict the checkpoint step positions once, up front, so they're
        # persisted with the job and survive a page refresh.
        checkpoint_steps = predict_checkpoint_steps(request.hyperparameters)
        progress = JobProgress(
            job_id=job_id,
            status=JobStatus.PENDING,
            checkpoint_steps=checkpoint_steps,
        )
        self._accumulators[job_id] = {
            "history": [],
            "last_step": 0,
            "stride": 1,
            "raw_count": 0,
            "checkpoint_steps": checkpoint_steps,
            "saved": set(),
        }

        self._jobs[job_id] = JobState(
            job_id=job_id,
            status=JobStatus.PENDING,
            provider=request.provider,
            project_path=request.project_path,
            config=request.model_dump(),
            started_at=now,
            progress=progress,
        )
        self._registry.create(
            job_id,
            JobKind.TRAINING,
            status=LifecycleStatus.QUEUED,
            metadata={
                "provider": request.provider.value,
                "project_path": request.project_path,
            },
        )
        self._persist_state(job_id)

        # Runner invoked by the worker when it's this job's turn. The worker
        # calls set_running() before invoking us, so the record carries the
        # assigned gpu_id by the time the runner body executes.
        async def runner() -> None:
            record = self._registry.get(job_id)
            gpu_id = record.gpu_id if record and record.gpu_id is not None else 0
            await self._run_training(job_id, request, provider, gpu_id=gpu_id)

        self._registry.enqueue(job_id, runner)

        return StartJobResponse(job_id=job_id, status=JobStatus.PENDING)

    async def cancel_job(self, job_id: Optional[str] = None) -> bool:
        """Cancel a training job — queued or running.

        If `job_id` is omitted, cancels the focus job (running one, else oldest
        queued). Returns True if a job was cancelled.
        """
        if job_id is None:
            focus = self._focus_job()
            if focus is None or focus.status in _TERMINAL_TRAINING_STATUSES:
                return False
            job_id = focus.job_id

        job = self._jobs.get(job_id)
        if job is None:
            return False

        record = self._registry.get(job_id)
        if record is None:
            return False

        # Cancelled while still queued — no subprocess to kill.
        if record.status == LifecycleStatus.QUEUED:
            self._registry.cancel_queued(job_id)
            job.status = JobStatus.CANCELLED
            job.progress.status = JobStatus.CANCELLED
            job.progress.error = "Cancelled before start"
            job.completed_at = datetime.now(timezone.utc).isoformat()
            self._accumulators.pop(job_id, None)
            self._persist_state(job_id)
            await self._ws.broadcast(job.progress.model_dump())
            return True

        # Running — ask the provider to stop; the runner's exception handler
        # will emit the CANCELLED progress update.
        provider = self._providers.get(job.provider.value)
        if provider:
            await provider.cancel_training()

        await self._update_progress(
            JobProgress(
                job_id=job_id,
                status=JobStatus.CANCELLED,
                current_step=job.progress.current_step,
                total_steps=job.progress.total_steps,
                error="Cancelled by user",
            )
        )
        return True

    async def _run_training(
        self,
        job_id: str,
        request: StartJobRequest,
        provider: TrainingProvider,
        gpu_id: int = 0,
    ):
        """Runner invoked by the worker when this job reaches the front of the queue."""
        try:
            config_dir = str(self._jobs_dir / job_id)
            Path(config_dir).mkdir(parents=True, exist_ok=True)
            config_path = await provider.generate_config(request, config_dir)

            async for progress in provider.start_training(
                request, config_path, gpu_id=gpu_id
            ):
                progress.job_id = job_id
                await self._update_progress(progress)

        except asyncio.CancelledError:
            # Cancellation path: the cancel_job caller already emitted the
            # CANCELLED progress update and updated state.
            raise
        except Exception as e:
            await self._update_progress(
                JobProgress(
                    job_id=job_id,
                    status=JobStatus.FAILED,
                    error=str(e),
                )
            )

    def _accumulate_progress(self, job: JobState, progress: JobProgress) -> None:
        """Fold central loss history + checkpoint tracking into `progress`.

        Providers stay stateless: they report the latest `loss` and any
        newly-confirmed save step(s) in `saved_checkpoints`. This merges those
        into the per-job accumulator and writes the full accumulated series,
        predicted checkpoint steps, and deduped confirmed-save set back onto
        the outgoing progress so every WS broadcast and `/jobs/status`
        rehydration carries them.

        Called while `job.progress` still holds the PREVIOUS update, so the
        accumulator can be seeded from persisted state when missing.
        """
        acc = self._accumulators.get(progress.job_id)
        if acc is None:
            # Seed from persisted progress — covers the cancel path and any
            # update for a job that predates the accumulator.
            acc = {
                "history": list(job.progress.loss_history),
                "last_step": job.progress.current_step,
                "stride": 1,
                "raw_count": len(job.progress.loss_history),
                "checkpoint_steps": list(job.progress.checkpoint_steps),
                "saved": {int(s) for s in job.progress.saved_checkpoints},
            }
            self._accumulators[progress.job_id] = acc

        # Merge any confirmed saves the provider reported this tick. The set
        # dedupes by step (e.g. Kohya prints "model saved" for both an epoch
        # save and the final save at the same step).
        for step in progress.saved_checkpoints:
            acc["saved"].add(int(step))

        # Append a loss point only when actively training, the loss is
        # numeric, and the step advanced — so between-step activity events
        # (saving/sampling) that carry the last loss don't create duplicates.
        if (
            progress.status == JobStatus.TRAINING
            and progress.loss is not None
            and progress.current_step > acc["last_step"]
        ):
            acc["last_step"] = progress.current_step
            acc["raw_count"] += 1
            if acc["raw_count"] % acc["stride"] == 0:
                acc["history"].append(
                    LossPoint(step=progress.current_step, loss=progress.loss)
                )
                if len(acc["history"]) > _MAX_LOSS_POINTS:
                    # Halve the series and sample half as often from here on.
                    acc["history"] = acc["history"][::2]
                    acc["stride"] *= 2

        # Write the accumulated view onto the outgoing progress.
        progress.loss_history = list(acc["history"])
        progress.checkpoint_steps = list(acc["checkpoint_steps"])
        progress.saved_checkpoints = sorted(acc["saved"])

    async def _update_progress(self, progress: JobProgress):
        """Update the referenced job's progress and broadcast to WebSocket clients."""
        job = self._jobs.get(progress.job_id)
        if job is None:
            return

        # Capture whether the provider reported fresh saves *before*
        # accumulation rewrites saved_checkpoints to the full deduped set —
        # a checkpoint confirmation must always be persisted immediately.
        has_new_saves = bool(progress.saved_checkpoints)

        # Fold in central loss/checkpoint accumulation before we replace
        # job.progress (the seed path reads the previous progress).
        self._accumulate_progress(job, progress)

        job.progress = progress
        job.status = progress.status

        is_terminal = progress.status in _TERMINAL_TRAINING_STATUSES
        if is_terminal:
            job.completed_at = datetime.now(timezone.utc).isoformat()
            self._registry.finish(
                job.job_id, _lifecycle_from_training(progress.status)
            )
            # The run is over — drop the accumulator (its state is now fully
            # captured in the persisted job.progress).
            self._accumulators.pop(progress.job_id, None)

        # Throttle routine per-tick writes: persist at most once every
        # _PERSIST_THROTTLE_SECONDS while training. Always persist immediately
        # for a terminal status, a fresh checkpoint confirmation (matters for
        # crash recovery), or the first update seen for this job.
        now = time.monotonic()
        last = self._last_persist_at.get(job.job_id)
        if (
            is_terminal
            or has_new_saves
            or last is None
            or (now - last) >= _PERSIST_THROTTLE_SECONDS
        ):
            self._persist_state(job.job_id)
            self._last_persist_at[job.job_id] = now

        await self._ws.broadcast(progress.model_dump())

    def mark_failed(self, job_id: str, error: str):
        """Mark a specific job as failed with an error message."""
        job = self._jobs.get(job_id)
        if job is None:
            return

        job.status = JobStatus.FAILED
        job.progress.status = JobStatus.FAILED
        job.progress.error = error
        job.completed_at = datetime.now(timezone.utc).isoformat()
        self._registry.finish(job_id, LifecycleStatus.FAILED)
        self._accumulators.pop(job_id, None)
        self._persist_state(job_id)

    def clear_completed(self, job_id: Optional[str] = None):
        """Clear terminal training jobs from active state and disk.

        If `job_id` is given, clears only that job (if terminal). Otherwise,
        sweeps all terminal training jobs.
        """
        targets = (
            [job_id]
            if job_id is not None
            else [
                jid
                for jid, j in self._jobs.items()
                if j.status in _TERMINAL_TRAINING_STATUSES
            ]
        )
        for jid in targets:
            job = self._jobs.get(jid)
            if job is None or job.status not in _TERMINAL_TRAINING_STATUSES:
                continue
            path = self._jobs_dir / f"{jid}.json"
            try:
                path.unlink(missing_ok=True)
            except OSError as e:
                print(f"Warning: Failed to delete cleared job file: {e}")
            self._registry.remove(jid)
            self._accumulators.pop(jid, None)
            self._last_persist_at.pop(jid, None)
            del self._jobs[jid]

    def _persist_state(self, job_id: str):
        """Write a job's state to disk for crash recovery."""
        job = self._jobs.get(job_id)
        if job is None:
            return

        path = self._jobs_dir / f"{job_id}.json"
        try:
            path.write_text(
                json.dumps(job.model_dump(), indent=2),
                encoding="utf-8",
            )
        except OSError as e:
            print(f"Warning: Failed to persist job state: {e}")

    def _recover_state(self):
        """Attempt to recover in-flight jobs from disk after a restart.

        Each in-flight file (PENDING/PREPARING/TRAINING) is marked FAILED since
        the training subprocess did not survive the restart. Terminal files
        from prior sessions are cleaned up opportunistically — the client
        owns terminal training history via localStorage.
        """
        if not self._jobs_dir.exists():
            return

        for path in self._jobs_dir.glob("*.json"):
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
                job = JobState(**data)

                if job.status in (
                    JobStatus.PENDING,
                    JobStatus.PREPARING,
                    JobStatus.TRAINING,
                ):
                    job.status = JobStatus.FAILED
                    job.progress.status = JobStatus.FAILED
                    job.progress.error = "Training interrupted — sidecar restarted"
                    job.completed_at = datetime.now(timezone.utc).isoformat()
                    self._jobs[job.job_id] = job
                    self._registry.create(
                        job.job_id,
                        JobKind.TRAINING,
                        status=LifecycleStatus.FAILED,
                        metadata={
                            "provider": job.provider.value,
                            "project_path": job.project_path,
                        },
                    )
                    self._persist_state(job.job_id)
                else:
                    try:
                        path.unlink(missing_ok=True)
                    except OSError:
                        pass
            except (json.JSONDecodeError, OSError, ValueError) as e:
                print(f"Warning: Failed to recover job state from {path.name}: {e}")
