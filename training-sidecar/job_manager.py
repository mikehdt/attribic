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
import re

from models import (
    JobProgress,
    JobState,
    JobStatus,
    LossPoint,
    SpeedPoint,
    StartJobRequest,
    StartJobResponse,
)
from providers.base import TrainingProvider
from training_time import read_carryforward_seconds, record_time_markers
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

# Upper bound on a single gap between consecutive TRAINING-status ticks that we
# still count as training time. Ticks normally arrive ~1/sec, and a legitimate
# between-step pause (checkpoint save, sample generation) is still TRAINING and
# should count — but only up to this cap, past which the gap is treated as a
# stall / clock jump / discontinuity and dropped, so a frozen or backgrounded
# process can't inflate the figure. Bounds the per-gap error to this many
# seconds.
_MAX_TRAINING_GAP_SECONDS = 180.0

# Matches a trainer-reported iteration rate like "2.30it/s" or "23.01 s/it".
_RATE_RE = re.compile(r"([\d.]+)\s*(it/s|s/it)", re.IGNORECASE)


def _parse_sec_per_it(speed: Optional[str]) -> Optional[float]:
    """Normalise a trainer's speed string to seconds-per-iteration.

    Trainers print the rate in whichever unit reads nicer for the current
    pace — "2.30 it/s" when fast, "23.01 s/it" when slow. We store a single
    consistent series (s/it) so the client doesn't have to branch per point:
    an it/s value is inverted, an s/it value is taken as-is. Returns None when
    the string is missing or unparseable (best-effort — don't rely on it).
    """
    if not speed:
        return None
    m = _RATE_RE.search(speed)
    if not m:
        return None
    try:
        value = float(m.group(1))
    except ValueError:
        return None
    if value <= 0:
        return None
    unit = m.group(2).lower()
    return 1.0 / value if unit == "it/s" else value


def predict_checkpoint_steps(
    hyperparameters: dict,
    total_steps: int | None = None,
    total_epochs: int | None = None,
) -> list[int]:
    """Predict the step positions at which checkpoints will be written.

    Mirrors the client-side `deriveCheckpointSteps` (see
    src/app/store/training/training-runtime.ts) but reads the snake_case
    hyperparameters the sidecar actually receives. The Node side sends the
    save cadence in the user's chosen unit — `save_every_n_steps` for
    step-based saving, `save_every_n_epochs` for epoch-based (0/0 = disabled) —
    with steps taking precedence, matching what the providers pass to their
    backends.

    Epoch-based saves land on the trainer's own epoch rhythm: whole epochs of
    `steps_per_epoch` counted from step 0, with the last epoch cut short by a
    max-steps cap. `total_steps` / `total_epochs` override the configured
    values so a running job can re-derive that rhythm from what the trainer
    actually reports — the configured pair can imply a different (wrong)
    steps-per-epoch when a step cap truncates the run.
    """
    hp = hyperparameters or {}
    if total_steps is None:
        total_steps = int(hp.get("steps", 0) or 0)
    if total_epochs is None:
        total_epochs = int(hp.get("epochs", 0) or 0)
    if total_steps <= 0:
        return []

    save_every_steps = int(hp.get("save_every_n_steps", 0) or 0)
    if save_every_steps > 0:
        return list(range(save_every_steps, total_steps + 1, save_every_steps))

    save_every_epochs = int(hp.get("save_every_n_epochs", 0) or 0)
    if save_every_epochs <= 0 or total_epochs <= 0:
        return []

    steps_per_epoch = max(1, math.ceil(total_steps / total_epochs))
    out: list[int] = []
    epoch = save_every_epochs
    while epoch <= total_epochs:
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
        # If this run resumes from a saved state, seed the training clock from
        # the marker left beside that state so the timer continues rather than
        # restarting at zero (see training_time.py).
        carryforward = read_carryforward_seconds(
            request.hyperparameters.get("resume_state")
        )
        progress = JobProgress(
            job_id=job_id,
            status=JobStatus.PENDING,
            checkpoint_steps=checkpoint_steps,
            training_seconds=carryforward,
        )
        self._accumulators[job_id] = {
            "history": [],
            "speed_history": [],
            "last_step": 0,
            "stride": 1,
            "raw_count": 0,
            "checkpoint_steps": checkpoint_steps,
            "saved": set(),
            # Active-training time accounting. `training_seconds` carries the
            # running total (seeded from any resume marker above); `last_tick`
            # is the monotonic timestamp of the previous TRAINING update, or
            # None whenever we're not mid-training so a non-training stretch
            # isn't counted. The output_* / provider fields let the terminal
            # and per-save marker writes find the trainer's state dirs.
            "training_seconds": carryforward,
            "last_tick": None,
            "provider": request.provider.value,
            "output_path": request.output_path,
            "output_name": request.output_name,
            # step -> training_seconds at the moment that step's checkpoint was
            # saved, so a state dir gets the time for the step it belongs to
            # rather than the time we happened to notice the dir on disk.
            "save_seconds_by_step": {},
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
                error="Training run cancelled",
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
            # update for a job that predates the accumulator. Output info comes
            # from the persisted config (snake_case request dump) so a marker
            # write on this path can still locate the state dirs.
            cfg = job.config or {}
            acc = {
                "history": list(job.progress.loss_history),
                "speed_history": list(job.progress.speed_history),
                "last_step": job.progress.current_step,
                "stride": 1,
                "raw_count": len(job.progress.loss_history),
                "checkpoint_steps": list(job.progress.checkpoint_steps),
                "saved": {int(s) for s in job.progress.saved_checkpoints},
                "training_seconds": float(job.progress.training_seconds or 0.0),
                "last_tick": None,
                "provider": cfg.get("provider") or job.provider.value,
                "output_path": cfg.get("output_path", ""),
                "output_name": cfg.get("output_name", ""),
                "save_seconds_by_step": {},
            }
            self._accumulators[progress.job_id] = acc

        # Accumulate active-training wall-time. Every TRAINING update (step ticks
        # *and* between-step activity like saving/sampling, which stay TRAINING)
        # advances the clock by the gap since the previous TRAINING tick, capped
        # so a stall/clock-jump can't inflate it. Any non-training status
        # (pending/preparing/terminal) drops the anchor so its span isn't
        # counted when training resumes.
        now = time.monotonic()
        if progress.status == JobStatus.TRAINING:
            last_tick = acc.get("last_tick")
            if last_tick is not None:
                delta = now - last_tick
                if 0 < delta <= _MAX_TRAINING_GAP_SECONDS:
                    acc["training_seconds"] += delta
            acc["last_tick"] = now
        else:
            acc["last_tick"] = None
        progress.training_seconds = acc["training_seconds"]

        # Merge any confirmed saves the provider reported this tick. The set
        # dedupes by step (e.g. Kohya prints "model saved" for both an epoch
        # save and the final save at the same step).
        for step in progress.saved_checkpoints:
            acc["saved"].add(int(step))

        # Re-derive the predicted save positions from the trainer's own totals
        # once it reports them. The configured steps/epochs pair is only an
        # estimate of the real rhythm: a max-steps cap cuts the final epoch
        # short, so the trainer runs fewer epochs than configured (e.g. 1600
        # steps at 21 steps/epoch is 77 epochs, not the 80 asked for) and the
        # configured pair implies the wrong steps-per-epoch. Predicting from
        # what the trainer reports keeps upcoming checkpoints on the same beat
        # as the confirmed ones.
        if progress.total_steps > 0 and progress.total_epochs > 0:
            refined = predict_checkpoint_steps(
                (job.config or {}).get("hyperparameters", {}),
                total_steps=progress.total_steps,
                total_epochs=progress.total_epochs,
            )
            if refined:
                acc["checkpoint_steps"] = refined

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
                # Speed rides alongside loss at the same downsampled steps, so
                # the two curves share an x-axis. Skip the point (rather than
                # storing a gap) when the backend didn't report a parseable
                # rate this tick — the series stays sparse but valid.
                sec_per_it = _parse_sec_per_it(progress.speed)
                if sec_per_it is not None:
                    acc["speed_history"].append(
                        SpeedPoint(step=progress.current_step, sec_per_it=sec_per_it)
                    )
                if len(acc["history"]) > _MAX_LOSS_POINTS:
                    # Halve both series and sample half as often from here on.
                    acc["history"] = acc["history"][::2]
                    acc["speed_history"] = acc["speed_history"][::2]
                    acc["stride"] *= 2

        # Write the accumulated view onto the outgoing progress.
        progress.loss_history = list(acc["history"])
        progress.speed_history = list(acc["speed_history"])
        progress.checkpoint_steps = list(acc["checkpoint_steps"])
        progress.saved_checkpoints = sorted(acc["saved"])

    async def _update_progress(self, progress: JobProgress):
        """Update the referenced job's progress and broadcast to WebSocket clients."""
        job = self._jobs.get(progress.job_id)
        if job is None:
            return

        # Capture the steps the provider reported as freshly saved *before*
        # accumulation rewrites saved_checkpoints to the full deduped set — a
        # checkpoint confirmation must always be persisted immediately, and each
        # fresh step's save-time is recorded into the ledger below.
        fresh_saved_steps = [int(s) for s in progress.saved_checkpoints]
        has_new_saves = bool(fresh_saved_steps)
        is_terminal = progress.status in _TERMINAL_TRAINING_STATUSES

        # Fold in central loss/checkpoint accumulation before we replace
        # job.progress (the seed path reads the previous progress).
        self._accumulate_progress(job, progress)

        # Persist a training-time marker beside the trainer's saved state
        # whenever a checkpoint is confirmed written or the run ends, so a later
        # resume can continue the training clock rather than restarting it.
        # Best-effort and cheap — only fires on save/terminal events, and reads
        # the accumulator before the terminal branch below drops it.
        if has_new_saves or is_terminal:
            acc = self._accumulators.get(progress.job_id)
            if acc and acc.get("output_path") and acc.get("output_name"):
                # Stamp each fresh save's step with the current training-seconds
                # so its state dir can be marked with the right value even if we
                # only find the dir on disk on a later scan.
                for saved_step in fresh_saved_steps:
                    acc["save_seconds_by_step"][saved_step] = (
                        progress.training_seconds
                    )
                record_time_markers(
                    provider=acc["provider"],
                    output_path=acc["output_path"],
                    output_name=acc["output_name"],
                    training_seconds=progress.training_seconds,
                    step=progress.current_step,
                    job_id=progress.job_id,
                    seconds_by_step=acc["save_seconds_by_step"],
                )

        job.progress = progress
        job.status = progress.status

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
