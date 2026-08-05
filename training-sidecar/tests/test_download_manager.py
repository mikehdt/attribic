"""Tests for the download manager.

The point of moving downloads into the sidecar was that they outlive the
browser tab and the Node process. What actually delivers that is the record on
disk plus resume-on-boot, so those are what's pinned here.
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path

import httpx
import pytest

from downloads.manager import DownloadManager
from models import DownloadFileSpec, StartDownloadRequest

BODY = bytes(range(256)) * 40


class FakeWs:
    """Stand-in for WebSocketManager — records what would have been sent."""

    def __init__(self) -> None:
        self.sent: list[dict] = []

    def broadcast_nowait(self, data: dict) -> None:
        self.sent.append(data)


def chunked(body: bytes, size: int = 4096):
    async def gen():
        for offset in range(0, len(body), size):
            yield body[offset : offset + size]

    return gen()


def transport(body: bytes = BODY, on_request=None):
    def handler(request: httpx.Request) -> httpx.Response:
        if on_request is not None:
            on_request(request)
        range_header = request.headers.get("range")
        if range_header:
            start = int(range_header.removeprefix("bytes=").rstrip("-"))
            if start >= len(body):
                return httpx.Response(
                    416, headers={"content-range": f"bytes */{len(body)}"}
                )
            return httpx.Response(
                206,
                content=chunked(body[start:]),
                headers={"etag": '"v1"'},
            )
        return httpx.Response(200, content=chunked(body), headers={"etag": '"v1"'})

    return httpx.MockTransport(handler)


def make_manager(tmp_path: Path, **kwargs) -> tuple[DownloadManager, FakeWs]:
    ws = FakeWs()
    manager = DownloadManager(
        downloads_dir=tmp_path / "records",
        ws_manager=ws,
        hf_token_provider=lambda: None,
        transport=kwargs.pop("transport", transport()),
        **kwargs,
    )
    return manager, ws


def request_for(
    tmp_path: Path, job_id: str = "dl-1", model_id: str = "test-model", **kwargs
) -> StartDownloadRequest:
    return StartDownloadRequest(
        job_id=job_id,
        model_id=model_id,
        model_name="Test Model",
        repo_id="owner/repo",
        files=[DownloadFileSpec(name="model.safetensors", size=len(BODY))],
        target_dir=str(tmp_path / "models"),
        **kwargs,
    )


async def drain(manager: DownloadManager, job_id: str) -> None:
    """Wait for a job's runner task to finish."""
    state = manager.get(job_id)
    assert state is not None and state.task is not None
    await state.task


# --- Happy path -------------------------------------------------------------


def test_download_completes_and_persists_its_record(tmp_path):
    async def scenario():
        manager, ws = make_manager(tmp_path)
        await manager.start(request_for(tmp_path))
        await drain(manager, "dl-1")
        return manager, ws

    manager, ws = asyncio.run(scenario())

    state = manager.get("dl-1")
    assert state.status == "completed"
    assert state.bytes_downloaded == len(BODY)
    assert (tmp_path / "models" / "model.safetensors").read_bytes() == BODY

    record = json.loads(
        (tmp_path / "records" / "dl-1.json").read_text(encoding="utf-8")
    )
    assert record["status"] == "completed"
    # Enough to rebuild and resume the transfer without the client's help.
    assert record["repo_id"] == "owner/repo"
    assert record["files"] == [{"name": "model.safetensors", "size": len(BODY)}]

    # Progress reached the socket, ending on the terminal state.
    assert ws.sent[-1]["status"] == "completed"
    assert all(m["channel"] == "download" for m in ws.sent)


def test_writes_the_model_sidecar_on_completion(tmp_path):
    """The `.model.json` is written by the sidecar because completion may well
    happen with no browser attached."""

    async def scenario():
        manager, _ = make_manager(tmp_path)
        await manager.start(
            request_for(
                tmp_path,
                sidecar_meta={"name": "Test Model", "architecture": "sdxl"},
                sidecar_file_name="model.safetensors",
            )
        )
        await drain(manager, "dl-1")

    asyncio.run(scenario())

    meta = json.loads(
        (tmp_path / "models" / "model.safetensors.model.json").read_text(
            encoding="utf-8"
        )
    )
    assert meta["name"] == "Test Model"
    assert meta["architecture"] == "sdxl"
    # Stamped at write time, not passed in — only the sidecar knows when the
    # transfer actually finished.
    assert meta["downloadedAt"]


def test_rejects_a_second_download_of_the_same_model(tmp_path):
    """Two writers appending to the same files interleave and corrupt them."""

    async def scenario():
        manager, _ = make_manager(tmp_path)
        await manager.start(request_for(tmp_path, job_id="dl-1"))
        with pytest.raises(RuntimeError, match="already in progress"):
            await manager.start(request_for(tmp_path, job_id="dl-2"))
        await drain(manager, "dl-1")

    asyncio.run(scenario())


def test_completed_model_can_be_downloaded_again(tmp_path):
    """The duplicate guard is about live transfers, not history — re-downloading
    a model whose earlier job is terminal has to work."""

    async def scenario():
        manager, _ = make_manager(tmp_path)
        await manager.start(request_for(tmp_path, job_id="dl-1"))
        await drain(manager, "dl-1")
        await manager.start(request_for(tmp_path, job_id="dl-2"))
        await drain(manager, "dl-2")
        return manager

    manager = asyncio.run(scenario())
    assert manager.get("dl-2").status == "completed"


# --- Cancellation -----------------------------------------------------------


def test_cancel_while_queued_settles_immediately(tmp_path):
    """A queued job has nothing reading its cancel event yet, so the manager
    settles it directly — otherwise the card sits there never moving."""

    async def scenario():
        manager, _ = make_manager(tmp_path)
        await manager.start(request_for(tmp_path))
        assert await manager.cancel("dl-1")
        await drain(manager, "dl-1")
        return manager

    manager = asyncio.run(scenario())

    state = manager.get("dl-1")
    assert state.status == "cancelled"
    assert state.error == "Download cancelled"
    assert not manager.has_active


def test_cancel_mid_transfer_keeps_a_resumable_partial(tmp_path):
    """Bytes already flushed stay on disk, and reported progress matches them —
    the resume asks the server for exactly the right offset."""
    body = bytes(range(256)) * 8192  # 2 MB, past the 1 MB flush interval
    gate = asyncio.Event()

    def handler(request: httpx.Request) -> httpx.Response:
        async def gen():
            yield body[: 1536 * 1024]  # one flush lands
            await gate.wait()  # park mid-transfer until the test cancels
            yield body[1536 * 1024 :]

        return httpx.Response(200, content=gen(), headers={"etag": '"v1"'})

    async def scenario():
        manager, _ = make_manager(tmp_path, transport=httpx.MockTransport(handler))
        request = request_for(tmp_path)
        request.files[0].size = len(body)
        await manager.start(request)

        # Let the runner get as far as the parked generator.
        for _ in range(50):
            if manager.get("dl-1").bytes_downloaded > 0:
                break
            await asyncio.sleep(0)

        assert await manager.cancel("dl-1")
        gate.set()
        await drain(manager, "dl-1")
        return manager

    manager = asyncio.run(scenario())

    state = manager.get("dl-1")
    assert state.status == "cancelled"
    partial = tmp_path / "models" / "model.safetensors"
    assert 0 < partial.stat().st_size < len(body)
    assert partial.stat().st_size == state.bytes_downloaded
    # The ETag survives so the resume can validate the partial against it.
    assert (
        tmp_path / "models" / "model.safetensors.download-meta.json"
    ).exists()


def test_cancelling_an_unknown_job_reports_failure(tmp_path):
    async def scenario():
        manager, _ = make_manager(tmp_path)
        return await manager.cancel("nope")

    assert asyncio.run(scenario()) is False


# --- Restart recovery -------------------------------------------------------


def test_resumes_an_interrupted_download_on_boot(tmp_path):
    """The headline behaviour: a record the last process left mid-transfer is
    re-queued and finishes from the bytes already on disk."""
    half = len(BODY) // 2
    models = tmp_path / "models"
    models.mkdir(parents=True)
    (models / "model.safetensors").write_bytes(BODY[:half])
    (models / "model.safetensors.download-meta.json").write_text(
        json.dumps({"etag": '"v1"'})
    )

    records = tmp_path / "records"
    records.mkdir(parents=True)
    (records / "dl-1.json").write_text(
        json.dumps(
            {
                "job_id": "dl-1",
                "model_id": "test-model",
                "model_name": "Test Model",
                "status": "running",  # the process died here
                "repo_id": "owner/repo",
                "target_dir": str(models),
                "files": [{"name": "model.safetensors", "size": len(BODY)}],
                "bytes_downloaded": half,
                "total_bytes": len(BODY),
                "created_at": "2026-08-05T00:00:00+00:00",
            }
        )
    )

    ranges: list[str | None] = []

    async def scenario():
        manager, _ = make_manager(
            tmp_path,
            transport=transport(on_request=lambda r: ranges.append(r.headers.get("range"))),
        )
        manager.load_records()
        resumed = manager.resume_interrupted()
        assert resumed == ["dl-1"]
        await drain(manager, "dl-1")
        return manager

    manager = asyncio.run(scenario())

    assert manager.get("dl-1").status == "completed"
    # Resumed rather than restarted — asked for the back half only.
    assert ranges == [f"bytes={half}-"]
    assert (models / "model.safetensors").read_bytes() == BODY


def test_terminal_records_are_not_resumed(tmp_path):
    records = tmp_path / "records"
    records.mkdir(parents=True)
    (records / "dl-done.json").write_text(
        json.dumps(
            {
                "job_id": "dl-done",
                "model_id": "test-model",
                "model_name": "Test Model",
                "status": "completed",
                "repo_id": "owner/repo",
                "target_dir": str(tmp_path / "models"),
                "files": [],
                "created_at": "2026-08-05T00:00:00+00:00",
            }
        )
    )

    async def scenario():
        manager, _ = make_manager(tmp_path)
        manager.load_records()
        return manager, manager.resume_interrupted()

    manager, resumed = asyncio.run(scenario())
    assert resumed == []
    # Still listed, so the panel can show the outcome after a restart.
    assert manager.get("dl-done").status == "completed"


def test_unreadable_record_is_skipped_not_fatal(tmp_path):
    records = tmp_path / "records"
    records.mkdir(parents=True)
    (records / "broken.json").write_text("{not json")
    (records / "partial.json").write_text(json.dumps({"job_id": "x"}))

    async def scenario():
        manager, _ = make_manager(tmp_path)
        return manager.load_records()

    assert asyncio.run(scenario()) == []


# --- Clearing ---------------------------------------------------------------


def test_clear_drops_a_terminal_record_but_not_a_live_one(tmp_path):
    async def scenario():
        manager, _ = make_manager(tmp_path)
        await manager.start(request_for(tmp_path))
        # Still running — must survive a clear, or the panel would lose track
        # of a transfer that's still writing to disk.
        assert manager.clear("dl-1") is False
        await drain(manager, "dl-1")
        assert manager.clear("dl-1") is True
        return manager

    manager = asyncio.run(scenario())
    assert manager.get("dl-1") is None
    assert not (tmp_path / "records" / "dl-1.json").exists()


def test_active_model_ids_covers_queued_and_running(tmp_path):
    async def scenario():
        manager, _ = make_manager(tmp_path)
        await manager.start(request_for(tmp_path))
        during = manager.active_model_ids()
        await drain(manager, "dl-1")
        return during, manager.active_model_ids()

    during, after = asyncio.run(scenario())
    assert during == {"test-model"}
    assert after == set()


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-q"]))
