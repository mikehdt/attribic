"""Model download manager — owns downloads for the whole app.

Downloads used to run inside the Next.js route that streamed them to the
browser, so their lifetime was the SSE connection's: a refresh or a Node
restart killed them mid-file. Here they outlive both, because the sidecar
does (detached spawn + heartbeat; see the module docstring in main.py).

Deliberately NOT routed through `JobRegistry`. That registry serialises
GPU-bound work behind a single worker — putting downloads in it would make a
download block training and vice versa, when in fact they should happily run
side by side. Downloads get their own small concurrency pool here, and the
idle watchdog consults `has_active` directly so the sidecar can't exit from
under one.

Records are persisted to `<training>/downloads/<job_id>.json` so a sidecar
restart doesn't lose the queue: anything non-terminal is re-queued on boot and
resumes from its partial.
"""

from __future__ import annotations

import asyncio
import json
import time
from collections import deque
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from downloads.engine import (
    DownloadFile,
    DownloadSpec,
    download_model_files,
)
from models import StartDownloadRequest
from ws_manager import WebSocketManager

# Model files are huge, so running many at once just splits bandwidth and
# thrashes the disk. Matches the cap the old client-side queue used.
MAX_CONCURRENT_DOWNLOADS = 2

# Terminal records are kept so the activity panel can show a download's outcome
# after a refresh, but not forever.
MAX_TERMINAL_RECORDS = 50

QUEUED = "queued"
RUNNING = "running"
COMPLETED = "completed"
FAILED = "failed"
CANCELLED = "cancelled"

TERMINAL_STATUSES = (COMPLETED, FAILED, CANCELLED)

# Transfer rate is measured over a short rolling window rather than since the
# job started. A resumed download credits everything already on disk in one
# tick, and a lifetime average would carry that phantom gigabyte-per-second
# forever; a window forgets it.
SPEED_WINDOW_SECONDS = 10.0
# Below this the sample span is too short for the numbers to mean anything —
# ticks land ~every megabyte, so on a fast link dozens arrive per second.
SPEED_MIN_SPAN_SECONDS = 0.75


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class RateTracker:
    """Rolling-window transfer rate for one download.

    Fed cumulative byte counts; reports bytes/second over the trailing window.
    Reset it whenever the counter jumps for a reason other than transfer (a new
    file crediting its already-on-disk bytes), so the jump becomes a new
    baseline instead of a spike.
    """

    def __init__(self) -> None:
        self._samples: deque[tuple[float, int]] = deque()

    def reset(self) -> None:
        self._samples.clear()

    def record(self, bytes_downloaded: int) -> None:
        now = time.monotonic()
        # The counter can go backwards: the engine optimistically credits a
        # partial, then withdraws it if the server ignores our Range and sends
        # the file from byte 0. Start over rather than report a negative rate.
        if self._samples and bytes_downloaded < self._samples[-1][1]:
            self.reset()
        self._samples.append((now, bytes_downloaded))
        cutoff = now - SPEED_WINDOW_SECONDS
        # Always keep two samples, however old — on a slow link they're the
        # only measurement there is.
        while len(self._samples) > 2 and self._samples[0][0] < cutoff:
            self._samples.popleft()

    def bytes_per_second(self) -> Optional[float]:
        if len(self._samples) < 2:
            return None
        (start, first), (end, last) = self._samples[0], self._samples[-1]
        span = end - start
        if span < SPEED_MIN_SPAN_SECONDS:
            return None
        return max(0.0, (last - first) / span)


@dataclass
class DownloadState:
    job_id: str
    model_id: str
    model_name: str
    repo_id: str
    target_dir: str
    files: list[dict]
    status: str = QUEUED
    bytes_downloaded: int = 0
    total_bytes: int = 0
    current_file: Optional[str] = None
    file_index: Optional[int] = None
    total_files: Optional[int] = None
    error: Optional[str] = None
    created_at: str = field(default_factory=_now)
    started_at: Optional[str] = None
    completed_at: Optional[str] = None
    # Written next to the model on completion so the training model scanner can
    # identify it without inferring anything from the folder layout. Opaque to
    # the sidecar — the Node side builds it.
    sidecar_meta: Optional[dict] = None
    sidecar_file_name: Optional[str] = None
    # Not persisted — process-local runtime handles and live measurements.
    cancel_event: asyncio.Event = field(default_factory=asyncio.Event)
    task: Optional[asyncio.Task] = None
    speed_bps: Optional[float] = None
    eta_seconds: Optional[float] = None
    rate: RateTracker = field(default_factory=RateTracker)

    def measure(self) -> None:
        """Refresh speed/ETA from the current byte count."""
        self.rate.record(self.bytes_downloaded)
        speed = self.rate.bytes_per_second()
        self.speed_bps = speed
        remaining = self.total_bytes - self.bytes_downloaded
        # Total is the registry's declared size, which is sometimes an
        # estimate, so the ETA is an estimate too — but a useful one.
        self.eta_seconds = (
            remaining / speed if speed and speed > 0 and remaining > 0 else None
        )

    def to_public(self) -> dict:
        """The shape both the WebSocket and the REST endpoints hand out."""
        return {
            "job_id": self.job_id,
            "model_id": self.model_id,
            "model_name": self.model_name,
            "status": self.status,
            "bytes_downloaded": self.bytes_downloaded,
            "total_bytes": self.total_bytes,
            "current_file": self.current_file,
            "file_index": self.file_index,
            "total_files": self.total_files,
            "error": self.error,
            "created_at": self.created_at,
            "started_at": self.started_at,
            "completed_at": self.completed_at,
            "speed_bps": self.speed_bps,
            "eta_seconds": self.eta_seconds,
        }

    def to_record(self) -> dict:
        """Everything needed to rebuild and resume this download after a
        restart. No credentials: the HuggingFace token is read from config.json
        when a transfer needs it, never copied into a record."""
        record = self.to_public()
        # Measured live, meaningless once the process that measured them is
        # gone — a restored record would otherwise show a stale rate until the
        # first tick of the resumed transfer.
        record.pop("speed_bps", None)
        record.pop("eta_seconds", None)
        return {
            **record,
            "repo_id": self.repo_id,
            "target_dir": self.target_dir,
            "files": self.files,
            "sidecar_meta": self.sidecar_meta,
            "sidecar_file_name": self.sidecar_file_name,
        }


class DownloadManager:
    """Queues, runs, cancels and persists model downloads."""

    def __init__(
        self,
        *,
        downloads_dir: Path,
        ws_manager: WebSocketManager,
        hf_token_provider: Callable[[], Optional[str]],
        transport=None,
    ) -> None:
        self.downloads_dir = downloads_dir
        self.downloads_dir.mkdir(parents=True, exist_ok=True)
        self.ws_manager = ws_manager
        # Called per transfer rather than read once, so a token pasted into
        # settings mid-session applies to the very next attempt.
        self._hf_token_provider = hf_token_provider
        # Passed through to the engine so tests can serve transfers without
        # reaching HuggingFace. None in production.
        self._transport = transport
        self.jobs: dict[str, DownloadState] = {}
        self._semaphore = asyncio.Semaphore(MAX_CONCURRENT_DOWNLOADS)
        # Strong references to in-flight runner tasks; without them the loop
        # holds only a weak reference and a download can be collected mid-run.
        self._tasks: set[asyncio.Task] = set()

    # -- Queries -------------------------------------------------------------

    @property
    def has_active(self) -> bool:
        return any(j.status in (QUEUED, RUNNING) for j in self.jobs.values())

    def list_jobs(self) -> list[dict]:
        return [j.to_public() for j in self.jobs.values()]

    def get(self, job_id: str) -> Optional[DownloadState]:
        return self.jobs.get(job_id)

    def active_model_ids(self) -> set[str]:
        """Models with bytes landing right now. The Node delete route refuses
        to wipe these — on Windows the unlink fails against the open handle and
        leaves a half-deleted model."""
        return {
            j.model_id for j in self.jobs.values() if j.status in (QUEUED, RUNNING)
        }

    # -- Lifecycle -----------------------------------------------------------

    async def start(self, request: StartDownloadRequest) -> DownloadState:
        """Queue a download. Raises RuntimeError if one is already live for
        this model — two writers appending to the same files interleave and
        corrupt them."""
        for job in self.jobs.values():
            if job.model_id == request.model_id and job.status in (
                QUEUED,
                RUNNING,
            ):
                raise RuntimeError(
                    "A download for this model is already in progress"
                )

        existing = self.jobs.get(request.job_id)
        if existing is not None and existing.status in (QUEUED, RUNNING):
            raise RuntimeError(f"Download {request.job_id} already exists")

        state = DownloadState(
            job_id=request.job_id,
            model_id=request.model_id,
            model_name=request.model_name,
            repo_id=request.repo_id,
            target_dir=request.target_dir,
            files=[f.model_dump() for f in request.files],
            total_bytes=sum(f.size for f in request.files),
            total_files=len(request.files),
            sidecar_meta=request.sidecar_meta,
            sidecar_file_name=request.sidecar_file_name,
        )
        self.jobs[request.job_id] = state
        self._prune_terminal()
        self._persist(state)
        await self._broadcast(state)
        self._spawn(state)
        return state

    def _spawn(self, state: DownloadState) -> None:
        task = asyncio.create_task(self._run(state))
        state.task = task
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    async def _run(self, state: DownloadState) -> None:
        """Wait for a concurrency slot, then stream the model to disk."""
        try:
            async with self._semaphore:
                # A cancel can land while we were queued.
                if state.cancel_event.is_set():
                    await self._settle(state, CANCELLED, error="Download cancelled")
                    return

                state.status = RUNNING
                state.started_at = _now()
                await self._broadcast(state)

                spec = DownloadSpec(
                    model_id=state.model_id,
                    repo_id=state.repo_id,
                    files=[
                        DownloadFile(name=f["name"], size=f.get("size", 0))
                        for f in state.files
                    ],
                    target_dir=Path(state.target_dir),
                    hf_token=self._hf_token_provider(),
                )

                # Progress ticks land ~every megabyte; persisting each one
                # would mean thousands of writes per gigabyte, so the record on
                # disk is only refreshed on status changes and every so often
                # (see _maybe_persist_progress).
                ticks = 0
                async for event in download_model_files(
                    spec, state.job_id, state.cancel_event, self._transport
                ):
                    # Each file starts by crediting whatever of it is already on
                    # disk, which isn't bandwidth. Rebaseline on the boundary so
                    # that credit doesn't read as a burst of speed.
                    if event["file_index"] != state.file_index:
                        state.rate.reset()

                    state.bytes_downloaded = event["bytes_downloaded"]
                    state.total_bytes = event["total_bytes"] or state.total_bytes
                    state.current_file = event["current_file"]
                    state.file_index = event["file_index"]
                    state.total_files = event["total_files"] or state.total_files

                    if event["status"] == "error":
                        await self._settle(state, FAILED, error=event["error"])
                        return
                    if event["status"] == "ready":
                        self._write_model_sidecar(state)
                        state.bytes_downloaded = state.total_bytes
                        await self._settle(state, COMPLETED)
                        return

                    ticks += 1
                    state.measure()
                    self._maybe_persist_progress(state, ticks)
                    await self._broadcast(state)

                # The generator stopped without a terminal event — the only
                # path there is a cancel.
                await self._settle(state, CANCELLED, error="Download cancelled")
        except asyncio.CancelledError:
            await self._settle(state, CANCELLED, error="Download cancelled")
            raise
        except Exception as err:  # noqa: BLE001 — last-resort safety net
            import traceback

            traceback.print_exc()
            await self._settle(state, FAILED, error=str(err))

    async def cancel(self, job_id: str) -> bool:
        """Ask a queued or running download to stop. Partial files stay on disk
        so a later retry resumes rather than restarting."""
        state = self.jobs.get(job_id)
        if state is None or state.status in TERMINAL_STATUSES:
            return False
        state.cancel_event.set()
        if state.status == QUEUED:
            # Nothing is reading the event yet — settle it now so the client
            # isn't left watching a queued card that never moves.
            await self._settle(state, CANCELLED, error="Download cancelled")
        return True

    def clear(self, job_id: str) -> bool:
        """Drop a terminal record (and its state file). Live jobs are kept."""
        state = self.jobs.get(job_id)
        if state is None or state.status not in TERMINAL_STATUSES:
            return False
        del self.jobs[job_id]
        self._remove_record(job_id)
        return True

    async def _settle(
        self, state: DownloadState, status: str, *, error: Optional[str] = None
    ) -> None:
        if state.status in TERMINAL_STATUSES:
            return
        state.status = status
        state.error = error
        state.completed_at = _now()
        state.speed_bps = None
        state.eta_seconds = None
        state.rate.reset()
        self._persist(state)
        await self._broadcast(state)

    def _write_model_sidecar(self, state: DownloadState) -> None:
        """Write the `.model.json` the training model scanner reads.

        Done here rather than on the Node side because completion may well
        happen with no browser attached — that's the whole point of the move.
        """
        if not state.sidecar_meta or not state.sidecar_file_name:
            return
        try:
            path = Path(state.target_dir) / f"{state.sidecar_file_name}.model.json"
            path.parent.mkdir(parents=True, exist_ok=True)
            # The one field we fill in rather than pass through: only here do we
            # know when the download actually finished, which for a resumed
            # multi-gigabyte model can be sessions after it started.
            meta = {**state.sidecar_meta, "downloadedAt": _now()}
            path.write_text(json.dumps(meta, indent=2), encoding="utf-8")
        except OSError as err:
            print(f"[downloads] Could not write model sidecar: {err}", flush=True)

    # -- Persistence ---------------------------------------------------------

    def _record_path(self, job_id: str) -> Path:
        return self.downloads_dir / f"{job_id}.json"

    def _persist(self, state: DownloadState) -> None:
        try:
            self._record_path(state.job_id).write_text(
                json.dumps(state.to_record(), indent=2), encoding="utf-8"
            )
        except OSError as err:
            print(f"[downloads] Could not persist {state.job_id}: {err}", flush=True)

    def _maybe_persist_progress(self, state: DownloadState, ticks: int) -> None:
        """Checkpoint the record every ~64 MB of progress.

        Only so a restart's card starts from roughly the right number — the
        real resume position always comes from the bytes on disk, never from
        here, so a stale record costs nothing.
        """
        if ticks % 64 == 0:
            self._persist(state)

    def _remove_record(self, job_id: str) -> None:
        try:
            self._record_path(job_id).unlink()
        except OSError:
            pass

    def _prune_terminal(self) -> None:
        terminal = sorted(
            (j for j in self.jobs.values() if j.status in TERMINAL_STATUSES),
            key=lambda j: j.completed_at or j.created_at,
        )
        overflow = len(terminal) - MAX_TERMINAL_RECORDS
        for state in terminal[:overflow] if overflow > 0 else []:
            del self.jobs[state.job_id]
            self._remove_record(state.job_id)

    def load_records(self) -> list[DownloadState]:
        """Rebuild state from disk. Called once at startup, before resume."""
        restored: list[DownloadState] = []
        for path in sorted(self.downloads_dir.glob("*.json")):
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                continue
            try:
                state = DownloadState(
                    job_id=data["job_id"],
                    model_id=data["model_id"],
                    model_name=data.get("model_name", data["model_id"]),
                    repo_id=data["repo_id"],
                    target_dir=data["target_dir"],
                    files=data.get("files", []),
                    status=data.get("status", QUEUED),
                    bytes_downloaded=data.get("bytes_downloaded", 0),
                    total_bytes=data.get("total_bytes", 0),
                    current_file=data.get("current_file"),
                    file_index=data.get("file_index"),
                    total_files=data.get("total_files"),
                    error=data.get("error"),
                    created_at=data.get("created_at", _now()),
                    started_at=data.get("started_at"),
                    completed_at=data.get("completed_at"),
                    sidecar_meta=data.get("sidecar_meta"),
                    sidecar_file_name=data.get("sidecar_file_name"),
                )
            except KeyError:
                # Record from an older/partial write — drop it rather than
                # resurrecting something we can't actually resume.
                continue
            self.jobs[state.job_id] = state
            restored.append(state)
        return restored

    def resume_interrupted(self) -> list[str]:
        """Re-queue every download the last process didn't finish.

        The engine resumes each file from the bytes already on disk (validated
        against the stored ETag), so this costs nothing beyond what was already
        transferred. Returns the ids re-queued.
        """
        resumed: list[str] = []
        for state in self.jobs.values():
            if state.status not in (QUEUED, RUNNING):
                continue
            state.status = QUEUED
            state.error = None
            state.started_at = None
            state.cancel_event = asyncio.Event()
            self._persist(state)
            self._spawn(state)
            resumed.append(state.job_id)
        return resumed

    # -- Broadcast -----------------------------------------------------------

    async def _broadcast(self, state: DownloadState) -> None:
        self.ws_manager.broadcast_nowait(
            {"channel": "download", **state.to_public()}
        )
