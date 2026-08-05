"""Tests for the model download engine.

The interesting behaviour is all in resume: the engine has to tell a complete
file from a partial, validate a partial against the revision it came from, and
survive a server that ignores its Range header. Each of those threw away real
multi-gigabyte downloads at some point in the Node engine this was ported from,
so they're pinned here.

Requests are served by an httpx MockTransport rather than HuggingFace.
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path

import httpx
import pytest

from downloads.engine import (
    DownloadFile,
    DownloadSpec,
    download_model_files,
)

BODY = bytes(range(256)) * 40  # 10,240 bytes of non-repeating-ish content


def make_spec(tmp_path: Path, files: list[DownloadFile]) -> DownloadSpec:
    return DownloadSpec(
        model_id="test-model",
        repo_id="owner/repo",
        files=files,
        target_dir=tmp_path,
    )


def chunked(body: bytes, size: int = 64 * 1024):
    """Serve a body the way a real transfer arrives — in pieces, so the
    engine's buffer/flush path and its mid-transfer cancel check are actually
    exercised rather than handed the whole file in one chunk."""

    async def gen():
        for offset in range(0, len(body), size):
            yield body[offset : offset + size]

    return gen()


def serve(body: bytes = BODY, etag: str = '"v1"'):
    """A transport that honours Range requests the way HF's CDN does."""

    def handler(request: httpx.Request) -> httpx.Response:
        range_header = request.headers.get("range")
        if_range = request.headers.get("if-range")

        # A stale If-Range means the partial came from a different revision —
        # serve the whole file so the caller overwrites rather than appends.
        if range_header and if_range and if_range != etag:
            return httpx.Response(200, content=chunked(body), headers={"etag": etag})

        if range_header:
            start = int(range_header.removeprefix("bytes=").rstrip("-"))
            if start >= len(body):
                return httpx.Response(
                    416, headers={"content-range": f"bytes */{len(body)}"}
                )
            return httpx.Response(
                206,
                content=chunked(body[start:]),
                headers={
                    "etag": etag,
                    "content-range": f"bytes {start}-{len(body) - 1}/{len(body)}",
                },
            )

        return httpx.Response(200, content=chunked(body), headers={"etag": etag})

    return httpx.MockTransport(handler)


async def run(spec: DownloadSpec, transport, cancel_after: int | None = None):
    """Drive the engine to completion, returning every event it yielded."""
    events = []
    cancel = asyncio.Event()
    async for event in download_model_files(spec, "dl-1", cancel, transport):
        events.append(event)
        if cancel_after is not None and len(events) >= cancel_after:
            cancel.set()
    return events


def meta_path(tmp_path: Path, name: str) -> Path:
    return tmp_path / f"{name}.download-meta.json"


# --- Fresh downloads --------------------------------------------------------


def test_downloads_files_and_writes_manifest(tmp_path):
    spec = make_spec(
        tmp_path,
        [
            DownloadFile("model.safetensors", len(BODY)),
            DownloadFile("nested/config.json", len(BODY)),
        ],
    )

    events = asyncio.run(run(spec, serve()))

    assert events[-1]["status"] == "ready"
    assert (tmp_path / "model.safetensors").read_bytes() == BODY
    # Subdirectories in a file name are created, not flattened.
    assert (tmp_path / "nested" / "config.json").read_bytes() == BODY

    manifest = json.loads(
        (tmp_path / "test-model.manifest.json").read_text(encoding="utf-8")
    )
    assert manifest["files"] == [
        {"name": "model.safetensors", "size": len(BODY)},
        {"name": "nested/config.json", "size": len(BODY)},
    ]
    # The resume-validation meta is cleaned up once a file completes.
    assert not meta_path(tmp_path, "model.safetensors").exists()


def test_skips_file_already_at_expected_size(tmp_path):
    (tmp_path / "model.safetensors").write_bytes(BODY)
    spec = make_spec(tmp_path, [DownloadFile("model.safetensors", len(BODY))])

    def handler(request: httpx.Request) -> httpx.Response:
        raise AssertionError("should not have been re-fetched")

    events = asyncio.run(run(spec, httpx.MockTransport(handler)))

    assert events[-1]["status"] == "ready"
    assert (tmp_path / "model.safetensors").read_bytes() == BODY


# --- Resume -----------------------------------------------------------------


def test_resumes_partial_file_from_disk(tmp_path):
    half = len(BODY) // 2
    (tmp_path / "model.safetensors").write_bytes(BODY[:half])
    meta_path(tmp_path, "model.safetensors").write_text(json.dumps({"etag": '"v1"'}))

    spec = make_spec(tmp_path, [DownloadFile("model.safetensors", len(BODY))])
    events = asyncio.run(run(spec, serve()))

    assert events[-1]["status"] == "ready"
    # Appended, not restarted — the bytes have to line up exactly.
    assert (tmp_path / "model.safetensors").read_bytes() == BODY


def test_stale_etag_rewrites_instead_of_appending(tmp_path):
    """A partial from an older revision must be overwritten.

    Appending onto it produces a file of the right size made of two different
    revisions, and every later size check passes it as good.
    """
    half = len(BODY) // 2
    (tmp_path / "model.safetensors").write_bytes(b"\x00" * half)
    meta_path(tmp_path, "model.safetensors").write_text(
        json.dumps({"etag": '"old-revision"'})
    )

    spec = make_spec(tmp_path, [DownloadFile("model.safetensors", len(BODY))])
    events = asyncio.run(run(spec, serve()))

    assert events[-1]["status"] == "ready"
    assert (tmp_path / "model.safetensors").read_bytes() == BODY
    # The optimistic credit for the discarded partial is withdrawn, so the
    # final byte count is the file's real size and not half as much again.
    assert events[-1]["bytes_downloaded"] == len(BODY)


def test_416_on_complete_file_keeps_it(tmp_path):
    """A file larger than its registry estimate is complete, not corrupt.

    Several registry sizes are deliberate estimates. Deleting on 416 (the old
    behaviour) threw away finished multi-gigabyte downloads.
    """
    (tmp_path / "model.safetensors").write_bytes(BODY)
    meta_path(tmp_path, "model.safetensors").write_text(json.dumps({"etag": '"v1"'}))

    # Registry under-declares the size, so the engine tries to resume.
    spec = make_spec(tmp_path, [DownloadFile("model.safetensors", len(BODY) - 500)])
    events = asyncio.run(run(spec, serve()))

    assert events[-1]["status"] == "ready"
    assert (tmp_path / "model.safetensors").read_bytes() == BODY
    assert not meta_path(tmp_path, "model.safetensors").exists()


def test_unknown_size_never_resumes(tmp_path):
    """size=0 means the manifest can't tell complete from partial, so the only
    safe move is a fresh fetch."""
    (tmp_path / "model.safetensors").write_bytes(b"\x00" * 99)
    seen: list[str | None] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request.headers.get("range"))
        return httpx.Response(200, content=BODY, headers={"etag": '"v1"'})

    spec = make_spec(tmp_path, [DownloadFile("model.safetensors", 0)])
    events = asyncio.run(run(spec, httpx.MockTransport(handler)))

    assert seen == [None]
    assert events[-1]["status"] == "ready"
    assert (tmp_path / "model.safetensors").read_bytes() == BODY


# --- Failures and cancellation ----------------------------------------------


def test_gated_repo_error_names_the_repo(tmp_path):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(403)

    spec = make_spec(tmp_path, [DownloadFile("model.safetensors", len(BODY))])
    events = asyncio.run(run(spec, httpx.MockTransport(handler)))

    assert events[-1]["status"] == "error"
    assert "huggingface.co/owner/repo" in events[-1]["error"]
    # No manifest for a download that never finished.
    assert not (tmp_path / "test-model.manifest.json").exists()


def test_cancel_leaves_a_resumable_partial(tmp_path):
    big = BODY * 300  # comfortably past the 1 MB flush interval
    spec = make_spec(tmp_path, [DownloadFile("model.safetensors", len(big))])

    events = asyncio.run(run(spec, serve(big), cancel_after=2))

    # Cancelled, so no terminal event — the manager records the cancellation.
    assert events[-1]["status"] == "downloading"
    partial = tmp_path / "model.safetensors"
    assert partial.exists()
    # Reported progress must match what's actually on disk, or the resume
    # would ask the server for the wrong offset.
    assert partial.stat().st_size == events[-1]["bytes_downloaded"]
    assert partial.stat().st_size < len(big)
    # The ETag was recorded, so the resume can validate the partial.
    assert json.loads(meta_path(tmp_path, "model.safetensors").read_text())["etag"]


# --- Variant switching ------------------------------------------------------


def test_sweeps_files_the_new_layout_dropped(tmp_path):
    """Switching quantisation variant must not leave the old weights behind —
    they shadow the new layout at model load time."""
    (tmp_path / "model-fp16.safetensors").write_bytes(BODY)
    (tmp_path / "model-fp16.safetensors.model.json").write_text("{}")
    (tmp_path / "test-model.manifest.json").write_text(
        json.dumps({"files": [{"name": "model-fp16.safetensors", "size": len(BODY)}]})
    )

    spec = make_spec(tmp_path, [DownloadFile("model-fp8.safetensors", len(BODY))])
    events = asyncio.run(run(spec, serve()))

    assert events[-1]["status"] == "ready"
    assert (tmp_path / "model-fp8.safetensors").exists()
    assert not (tmp_path / "model-fp16.safetensors").exists()
    assert not (tmp_path / "model-fp16.safetensors.model.json").exists()


def test_sweep_leaves_other_models_in_a_shared_dir_alone(tmp_path):
    """Manifests are per-model because several models share a target dir (every
    SDXL checkpoint lives under <models>/sdxl/)."""
    (tmp_path / "neighbour.safetensors").write_bytes(BODY)
    (tmp_path / "other-model.manifest.json").write_text(
        json.dumps({"files": [{"name": "neighbour.safetensors", "size": len(BODY)}]})
    )

    spec = make_spec(tmp_path, [DownloadFile("mine.safetensors", len(BODY))])
    asyncio.run(run(spec, serve()))

    assert (tmp_path / "neighbour.safetensors").exists()
    assert (tmp_path / "other-model.manifest.json").exists()


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-q"]))
