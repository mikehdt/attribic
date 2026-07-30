"""
Batch captioning manager — tracks active batches and streams progress.

Unlike the training JobManager which allows only one job at a time,
captioning is lightweight enough that we could support multiple batches,
but we only run one at a time for now to avoid GPU contention.
"""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass, field
from typing import Literal, Optional

from captioning.provider import CaptionCancelled, get_provider
from job_registry import JobKind, JobRegistry, LifecycleStatus
from models import CaptionBatchProgress, CaptionBatchRequest
from ws_manager import WebSocketManager

# Outcome of a clear request: removed, never existed, or still live.
ClearBatchResult = Literal["cleared", "not-found", "active"]

# Terminal batches are kept so a client that lost its socket can still collect
# their results, but not forever: without a bound they accumulate (with every
# caption they produced) for the life of the process. A client that hasn't
# reattached within the TTL isn't coming back for this run.
TERMINAL_BATCH_TTL_S = 30 * 60.0
# Belt-and-braces cap for a session that churns through batches faster than
# the TTL retires them. Oldest terminal batches go first.
MAX_TERMINAL_BATCHES = 20


@dataclass
class BatchState:
    batch_id: str
    total: int
    current: int = 0
    status: str = "queued"  # queued, running, completed, failed, cancelled
    cancel_requested: bool = False
    task: Optional[asyncio.Task] = None
    # Per-image outcomes in processing order. Success entries carry
    # item_id/image_path/caption; failures carry item_id/image_path/error.
    # Kept for the whole batch lifetime so a client that lost its WebSocket
    # (tab closed, page refresh) can replay them via the snapshot endpoint.
    results: list[dict] = field(default_factory=list)
    # Client-supplied per-image IDs, parallel to the request's image_paths.
    item_ids: list[str] = field(default_factory=list)
    # Client-side grouping key (project folder name) for reattach discovery.
    project: Optional[str] = None
    # Batch-level failure message, kept so reconnecting clients see why.
    error: Optional[str] = None
    # Model path from the request — reattaching clients derive a display
    # name from it (the original request isn't otherwise recoverable).
    model_path: Optional[str] = None
    # `time.monotonic()` at the moment the batch went terminal — drives the
    # retention sweep. None while queued or running.
    finished_at: Optional[float] = None


class CaptionBatchManager:
    """Manages active caption batches and broadcasts progress."""

    def __init__(
        self, ws_manager: WebSocketManager, registry: JobRegistry
    ) -> None:
        self.ws_manager = ws_manager
        self.registry = registry
        self.batches: dict[str, BatchState] = {}
        # Strong references to fire-and-forget broadcast tasks. Without these
        # the event loop holds only a weak reference and the broadcast can be
        # garbage-collected before it runs.
        self._background_tasks: set[asyncio.Task] = set()
        # Re-broadcast queue positions whenever the shared queue moves, so
        # queued batches' clients see themselves advance in line.
        registry.add_queue_listener(self._on_queue_change)

    def get_batch(self, batch_id: str) -> Optional[BatchState]:
        return self.batches.get(batch_id)

    def get_snapshot(self, batch_id: str) -> Optional[dict]:
        """Full state of a batch, including accumulated per-image results.
        Used by reconnecting clients to catch up before streaming live."""
        state = self.batches.get(batch_id)
        if state is None:
            return None
        return {
            "batch_id": state.batch_id,
            "status": state.status,
            "current": state.current,
            "total": state.total,
            "project": state.project,
            "error": state.error,
            "queue_position": self.registry.queue_position(state.batch_id),
            "results": list(state.results),
        }

    def list_batches(self, project: Optional[str] = None) -> list[dict]:
        """Lightweight listing of all batches (optionally per project) —
        no results payload. Terminal batches stay listed until cleared so a
        client that missed the end can still collect their results."""
        out: list[dict] = []
        for state in self.batches.values():
            if project is not None and state.project != project:
                continue
            out.append(
                {
                    "batch_id": state.batch_id,
                    "status": state.status,
                    "current": state.current,
                    "total": state.total,
                    "project": state.project,
                    "model_path": state.model_path,
                    "queue_position": self.registry.queue_position(
                        state.batch_id
                    ),
                    "result_count": len(state.results),
                }
            )
        return out

    def _on_queue_change(self) -> None:
        """Registry queue-change hook (sync, event loop thread)."""
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            return
        task = loop.create_task(self._broadcast_queue_positions())
        self._background_tasks.add(task)
        task.add_done_callback(self._background_tasks.discard)

    async def _broadcast_queue_positions(self) -> None:
        for state in list(self.batches.values()):
            if state.status != "queued":
                continue
            position = self.registry.queue_position(state.batch_id)
            if position <= 0:
                continue
            await self._broadcast(
                CaptionBatchProgress(
                    batch_id=state.batch_id,
                    current=state.current,
                    total=state.total,
                    status="queued",
                    queue_position=position,
                )
            )

    @property
    def has_active(self) -> bool:
        return any(
            b.status in ("queued", "running") for b in self.batches.values()
        )

    @property
    def has_unclaimed_results(self) -> bool:
        """True when a terminal batch still holds results nobody collected.

        A client acknowledges collection by clearing the batch, so anything
        terminal with results left is a run whose client died mid-flight. The
        idle watchdog checks this before exiting — the in-memory copy is all
        that survives once the process goes.
        """
        return any(
            b.finished_at is not None and b.results
            for b in self.batches.values()
        )

    def _settle(self, state: BatchState, status: str) -> None:
        """Record a terminal status and stamp it for the retention sweep."""
        state.status = status
        state.finished_at = time.monotonic()

    def prune_terminal(self) -> list[str]:
        """Retire terminal batches past the TTL, then the oldest over the cap.

        Returns the ids removed. Queued/running batches are never touched.
        """
        now = time.monotonic()
        terminal = sorted(
            (b for b in self.batches.values() if b.finished_at is not None),
            key=lambda b: b.finished_at or 0.0,
        )
        doomed = [
            b.batch_id
            for b in terminal
            if now - (b.finished_at or now) >= TERMINAL_BATCH_TTL_S
        ]
        survivors = [b for b in terminal if b.batch_id not in set(doomed)]
        overflow = max(0, len(survivors) - MAX_TERMINAL_BATCHES)
        doomed.extend(b.batch_id for b in survivors[:overflow])

        for batch_id in doomed:
            del self.batches[batch_id]
            self.registry.remove(batch_id)
        return doomed

    async def start_batch(self, request: CaptionBatchRequest) -> None:
        """Enqueue a batch caption run.

        The batch starts in QUEUED lifecycle status. When a worker picks it up,
        the runner loads the model and streams per-image progress.
        """
        # Retire long-dead batches first so a session that never closes the app
        # doesn't hold every run's captions for the life of the process.
        self.prune_terminal()

        if request.batch_id in self.batches:
            raise RuntimeError(f"Batch {request.batch_id} already exists")

        # Fall back to image paths as item IDs when the client doesn't
        # supply its own — every result entry always has an item_id.
        item_ids = request.item_ids or list(request.image_paths)
        if len(item_ids) != len(request.image_paths):
            raise RuntimeError(
                "item_ids must be parallel to image_paths "
                f"({len(item_ids)} ids for {len(request.image_paths)} paths)"
            )

        state = BatchState(
            batch_id=request.batch_id,
            total=len(request.image_paths),
            item_ids=item_ids,
            project=request.project,
            model_path=request.model_path,
        )
        try:
            self.registry.create(
                request.batch_id,
                JobKind.CAPTION_BATCH,
                status=LifecycleStatus.QUEUED,
                metadata={
                    "total": state.total,
                    "runtime": request.runtime,
                    "project": request.project,
                },
            )
        except ValueError as err:
            # The id is live in the registry even though we had no BatchState
            # for it — surface it through the duplicate-batch 409 path.
            raise RuntimeError(str(err)) from err
        self.batches[request.batch_id] = state

        async def runner() -> None:
            await self._run_batch(request, state)

        self.registry.enqueue(request.batch_id, runner)

    async def _run_batch(
        self, request: CaptionBatchRequest, state: BatchState
    ) -> None:
        """Run the batch — one image at a time, broadcasting progress."""
        # Closure read by the provider during inference so we can abort
        # mid-image instead of waiting for the next loop iteration.
        def cancel_check() -> bool:
            return state.cancel_requested

        # Model loading happens inside the provider's executor thread.
        # The provider calls on_load_progress(message, current, total) from
        # that thread — we schedule the async broadcast back onto the main
        # event loop with run_coroutine_threadsafe.
        main_loop = asyncio.get_running_loop()

        def on_load_progress(message: str, current: int, total: int) -> None:
            coro = self._broadcast(
                CaptionBatchProgress(
                    batch_id=state.batch_id,
                    current=current,
                    total=total,
                    status="loading",
                    message=message,
                )
            )
            try:
                asyncio.run_coroutine_threadsafe(coro, main_loop)
            except Exception:
                # Best-effort — never break model loading over a broadcast failure.
                pass

        async def broadcast_cancelled() -> None:
            self._settle(state, "cancelled")
            self.registry.finish(state.batch_id, LifecycleStatus.CANCELLED)
            await self._broadcast(
                CaptionBatchProgress(
                    batch_id=state.batch_id,
                    current=state.current,
                    total=state.total,
                    status="cancelled",
                )
            )

        try:
            state.status = "running"

            # Cancel may have landed between dequeue and here.
            if state.cancel_requested:
                await broadcast_cancelled()
                return

            # Inside the try so a missing runtime extra broadcasts 'failed'
            # instead of dying silently — the Node client is waiting on the
            # WebSocket and would otherwise hang forever.
            provider = get_provider(request.runtime)

            # Pre-load the model so the UI can surface loading progress
            # separately from inference progress. Without this, the first
            # caption_image call blocks through load AND inference and the
            # UI sits on the last loading tick for the whole duration.
            try:
                await provider.prepare(
                    model_path=request.model_path,
                    on_load_progress=on_load_progress,
                    cancel_check=cancel_check,
                )
            except CaptionCancelled:
                await broadcast_cancelled()
                return

            # Model is ready — broadcast a "running" transition so the UI
            # clears its loading overlay before the first image starts.
            if not state.cancel_requested:
                await self._broadcast(
                    CaptionBatchProgress(
                        batch_id=state.batch_id,
                        current=0,
                        total=state.total,
                        status="running",
                    )
                )

            for i, image_path in enumerate(request.image_paths):
                if state.cancel_requested:
                    await broadcast_cancelled()
                    return

                item_id = state.item_ids[i]
                try:
                    caption = await provider.caption_image(
                        image_path=image_path,
                        model_path=request.model_path,
                        prompt=request.prompt,
                        max_tokens=request.max_tokens,
                        temperature=request.temperature,
                        cancel_check=cancel_check,
                        on_load_progress=on_load_progress,
                        video_options=request.video,
                    )
                    state.current = i + 1
                    state.results.append(
                        {
                            "item_id": item_id,
                            "image_path": image_path,
                            "caption": caption,
                        }
                    )
                    await self._broadcast(
                        CaptionBatchProgress(
                            batch_id=state.batch_id,
                            current=state.current,
                            total=state.total,
                            image_path=image_path,
                            item_id=item_id,
                            caption=caption,
                            status="running",
                        )
                    )
                except CaptionCancelled:
                    # Mid-image cancel — drop the partial caption and exit.
                    await broadcast_cancelled()
                    return
                except Exception as err:
                    import traceback

                    traceback.print_exc()
                    # Per-image error — record for replay, broadcast, keep going.
                    # `current` advances here too: an errored image is still a
                    # processed image, and a stalled counter looked like a hang.
                    state.current = i + 1
                    state.results.append(
                        {
                            "item_id": item_id,
                            "image_path": image_path,
                            "error": str(err),
                        }
                    )
                    await self._broadcast(
                        CaptionBatchProgress(
                            batch_id=state.batch_id,
                            current=state.current,
                            total=state.total,
                            image_path=image_path,
                            item_id=item_id,
                            status="running",
                            error=str(err),
                        )
                    )

            self._settle(state, "completed")
            self.registry.finish(state.batch_id, LifecycleStatus.COMPLETED)
            await self._broadcast(
                CaptionBatchProgress(
                    batch_id=state.batch_id,
                    current=state.current,
                    total=state.total,
                    status="completed",
                )
            )

        except Exception as err:
            import traceback

            traceback.print_exc()
            self._settle(state, "failed")
            state.error = str(err)
            self.registry.finish(state.batch_id, LifecycleStatus.FAILED)
            await self._broadcast(
                CaptionBatchProgress(
                    batch_id=state.batch_id,
                    current=state.current,
                    total=state.total,
                    status="failed",
                    error=str(err),
                )
            )

    async def cancel_batch(self, batch_id: str) -> bool:
        """Request cancellation of a queued or running batch."""
        state = self.batches.get(batch_id)
        if state is None or state.status not in ("queued", "running"):
            return False

        record = self.registry.get(batch_id)
        if record and record.status == LifecycleStatus.QUEUED:
            # Not yet picked up — remove from the queue immediately. Broadcast
            # the terminal state: the Node client is holding a WebSocket open
            # for this batch and hangs forever without one.
            self.registry.cancel_queued(batch_id)
            self._settle(state, "cancelled")
            await self._broadcast(
                CaptionBatchProgress(
                    batch_id=state.batch_id,
                    current=state.current,
                    total=state.total,
                    status="cancelled",
                )
            )
            return True

        state.cancel_requested = True
        return True

    def clear_batch(self, batch_id: str) -> ClearBatchResult:
        """Remove a completed batch from the manager.

        The three outcomes are distinct to the caller: an unknown id means
        there is nothing left to clear (the client can stop asking), whereas a
        live batch means "not yet — try again". Folding them together made a
        client polling for its clear to land wait out its whole deadline
        against a batch that had already gone.
        """
        state = self.batches.get(batch_id)
        if state is None:
            return "not-found"
        if state.status in ("queued", "running"):
            return "active"
        del self.batches[batch_id]
        self.registry.remove(batch_id)
        return "cleared"

    async def _broadcast(self, progress: CaptionBatchProgress) -> None:
        """Send a progress update over the caption WebSocket channel."""
        await self.ws_manager.broadcast(
            {"channel": "caption", **progress.model_dump()}
        )
