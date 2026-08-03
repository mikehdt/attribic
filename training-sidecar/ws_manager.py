"""WebSocket connection manager for broadcasting training progress."""

import asyncio

from fastapi import WebSocket


class WebSocketManager:
    """Manages WebSocket connections and broadcasts progress updates."""

    def __init__(self):
        self._connections: list[WebSocket] = []
        # Per-connection outbound queue + the task draining it, backing
        # broadcast_nowait(). Keyed by the WebSocket instance.
        self._queues: dict[WebSocket, "asyncio.Queue[dict]"] = {}
        self._senders: dict[WebSocket, asyncio.Task] = {}

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self._connections.append(websocket)
        queue: "asyncio.Queue[dict]" = asyncio.Queue(maxsize=64)
        self._queues[websocket] = queue
        self._senders[websocket] = asyncio.create_task(
            self._sender_loop(websocket, queue)
        )

    def disconnect(self, websocket: WebSocket):
        if websocket in self._connections:
            self._connections.remove(websocket)
        task = self._senders.pop(websocket, None)
        if task is not None:
            task.cancel()
        self._queues.pop(websocket, None)

    async def broadcast(self, data: dict):
        """Send data to all connected clients. Removes dead connections."""
        dead: list[WebSocket] = []
        for ws in self._connections:
            try:
                await ws.send_json(data)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self._connections.remove(ws)

    def broadcast_nowait(self, data: dict) -> None:
        """Queue data for delivery without blocking on any client's send.

        Each connection drains from its own bounded queue via a background
        sender task, so one slow/stuck client can only ever stall its own
        queue — never this call, and never any other client. If a queue is
        full, the OLDEST pending tick is dropped in favour of the newest, so
        a client that's behind still ends up caught up to the latest state
        (including a terminal one) rather than stuck replaying a backlog.
        """
        for ws in self._connections:
            queue = self._queues.get(ws)
            if queue is None:
                continue
            try:
                queue.put_nowait(data)
            except asyncio.QueueFull:
                try:
                    queue.get_nowait()
                except asyncio.QueueEmpty:
                    pass
                try:
                    queue.put_nowait(data)
                except asyncio.QueueFull:
                    pass

    async def _sender_loop(self, websocket: WebSocket, queue: "asyncio.Queue[dict]"):
        """Drain one connection's queue in order, feeding broadcast_nowait()."""
        try:
            while True:
                data = await queue.get()
                try:
                    await websocket.send_json(data)
                except Exception:
                    self.disconnect(websocket)
                    return
        except asyncio.CancelledError:
            pass

    @property
    def connection_count(self) -> int:
        return len(self._connections)
