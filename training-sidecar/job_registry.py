"""Unified registry for GPU-bound jobs (training + captioning).

The registry is a coordination layer: it tracks lifecycle state
(queued/running/completed/...) across job kinds so the sidecar has one source
of truth for "what's running on the GPU." Rich per-kind progress still lives
in each manager's own state — the registry is lifecycle, not progress.

Phase 1 scope: enforce single-running semantics across training + caption
batches via one shared check. Phase 2 adds the pending queue and a worker
loop that pulls from it.
"""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Optional

JobRunner = Callable[[], Awaitable[None]]


class JobKind(str, Enum):
    TRAINING = "training"
    CAPTION_BATCH = "caption_batch"
    CAPTION_SINGLE = "caption_single"


class LifecycleStatus(str, Enum):
    QUEUED = "queued"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


TERMINAL_STATUSES = (
    LifecycleStatus.COMPLETED,
    LifecycleStatus.FAILED,
    LifecycleStatus.CANCELLED,
)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass
class JobRecord:
    id: str
    kind: JobKind
    status: LifecycleStatus
    created_at: str
    started_at: Optional[str] = None
    completed_at: Optional[str] = None
    gpu_id: Optional[int] = None
    metadata: dict = field(default_factory=dict)


class JobRegistry:
    """In-memory lifecycle + queue for GPU-bound jobs.

    The registry holds job records (lifecycle metadata) plus a FIFO pending
    queue of runners. A worker loop (see `run_worker`) pulls jobs from the
    queue and executes their runner. Managers submit jobs via `enqueue()`.
    """

    def __init__(self) -> None:
        self._records: dict[str, JobRecord] = {}
        self._pending_ids: list[str] = []
        self._runners: dict[str, JobRunner] = {}
        self._wake = asyncio.Event()
        self._queue_listeners: list[Callable[[], None]] = []

    def add_queue_listener(self, listener: Callable[[], None]) -> None:
        """Register a callback fired whenever queue composition changes
        (enqueue, dequeue-pick, cancel-while-queued). Called synchronously on
        the event loop thread — listeners should schedule async work rather
        than block."""
        self._queue_listeners.append(listener)

    def _notify_queue_change(self) -> None:
        for listener in self._queue_listeners:
            try:
                listener()
            except Exception:  # noqa: BLE001 — listeners must not break the queue
                pass

    def create(
        self,
        job_id: str,
        kind: JobKind,
        *,
        status: LifecycleStatus = LifecycleStatus.QUEUED,
        metadata: Optional[dict] = None,
    ) -> JobRecord:
        now = _now()
        record = JobRecord(
            id=job_id,
            kind=kind,
            status=status,
            created_at=now,
            started_at=now if status == LifecycleStatus.RUNNING else None,
            completed_at=now if status in TERMINAL_STATUSES else None,
            metadata=metadata or {},
        )
        self._records[job_id] = record
        return record

    def get(self, job_id: str) -> Optional[JobRecord]:
        return self._records.get(job_id)

    def set_running(self, job_id: str, *, gpu_id: Optional[int] = None) -> None:
        record = self._records.get(job_id)
        if record is None:
            return
        record.status = LifecycleStatus.RUNNING
        if record.started_at is None:
            record.started_at = _now()
        if gpu_id is not None:
            record.gpu_id = gpu_id

    def finish(self, job_id: str, status: LifecycleStatus) -> None:
        if status not in TERMINAL_STATUSES:
            raise ValueError(f"finish() requires a terminal status, got {status}")
        record = self._records.get(job_id)
        if record is None:
            return
        record.status = status
        record.completed_at = _now()

    def remove(self, job_id: str) -> None:
        self._records.pop(job_id, None)

    def has_running(self) -> bool:
        return any(
            r.status == LifecycleStatus.RUNNING for r in self._records.values()
        )

    def running_jobs(self) -> list[JobRecord]:
        return [
            r for r in self._records.values() if r.status == LifecycleStatus.RUNNING
        ]

    def list(self) -> list[JobRecord]:
        return list(self._records.values())

    # -- Queue operations -----------------------------------------------------

    def enqueue(self, job_id: str, runner: JobRunner) -> None:
        """Register a runner and add the job to the pending queue.

        The job must already have a record (typically created in QUEUED status
        by the manager calling `create()`). The worker loop will pick it up
        when a worker slot is free.
        """
        if job_id not in self._records:
            raise ValueError(f"Cannot enqueue unknown job {job_id}")
        self._runners[job_id] = runner
        self._pending_ids.append(job_id)
        self._wake.set()
        self._notify_queue_change()

    async def dequeue(self) -> tuple[str, JobRunner]:
        """Wait for the next pending runnable job.

        Skips jobs that were cancelled while queued (their runner is gone or
        their status is no longer QUEUED). Blocks when the queue is empty.
        """
        while True:
            while self._pending_ids:
                job_id = self._pending_ids.pop(0)
                record = self._records.get(job_id)
                runner = self._runners.pop(job_id, None)
                if (
                    record
                    and record.status == LifecycleStatus.QUEUED
                    and runner is not None
                ):
                    self._notify_queue_change()
                    return job_id, runner
                # Skipped — cancelled-while-queued or inconsistent state.
            self._wake.clear()
            await self._wake.wait()

    def cancel_queued(self, job_id: str) -> bool:
        """Cancel a queued (not yet running) job. Returns True if it was queued."""
        record = self._records.get(job_id)
        if record is None or record.status != LifecycleStatus.QUEUED:
            return False
        record.status = LifecycleStatus.CANCELLED
        record.completed_at = _now()
        self._runners.pop(job_id, None)
        # The id stays in _pending_ids — the worker skips it on dequeue.
        self._notify_queue_change()
        return True

    def queue_position(self, job_id: str) -> int:
        """1-indexed position in the queue; 0 if not queued."""
        pos = 0
        for pid in self._pending_ids:
            record = self._records.get(pid)
            if record and record.status == LifecycleStatus.QUEUED:
                pos += 1
                if pid == job_id:
                    return pos
        return 0

    def queued_jobs(self) -> list[JobRecord]:
        out: list[JobRecord] = []
        for pid in self._pending_ids:
            record = self._records.get(pid)
            if record and record.status == LifecycleStatus.QUEUED:
                out.append(record)
        return out


async def run_worker(
    registry: JobRegistry, *, worker_id: int = 0, gpu_id: Optional[int] = None
) -> None:
    """Pull jobs from the registry queue and dispatch their runners.

    Terminal state transitions are the runner's responsibility — the runner
    calls `registry.finish(...)` through its manager's normal progress paths.
    The worker only catches unhandled exceptions as a last-resort safety net.
    """
    while True:
        try:
            job_id, runner = await registry.dequeue()
        except asyncio.CancelledError:
            raise

        registry.set_running(job_id, gpu_id=gpu_id)
        try:
            await runner()
        except asyncio.CancelledError:
            record = registry.get(job_id)
            if record and record.status == LifecycleStatus.RUNNING:
                registry.finish(job_id, LifecycleStatus.CANCELLED)
            raise
        except Exception as err:  # noqa: BLE001 — last-resort safety net
            import traceback

            traceback.print_exc()
            record = registry.get(job_id)
            if record and record.status == LifecycleStatus.RUNNING:
                registry.finish(job_id, LifecycleStatus.FAILED)
            print(f"[worker {worker_id}] Unhandled error in job {job_id}: {err}")
