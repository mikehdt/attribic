"""HuggingFace file downloader.

Ported from the Node engine this replaces (`src/app/services/model-manager/
download-engine.ts`), deliberately keeping its on-disk contract byte for byte:

- `<file>.download-meta.json` holds the ETag a partial came from, so a resume
  can validate with `If-Range` instead of appending a new revision's bytes onto
  an old one's.
- `<model_id>.manifest.json` records actual on-disk sizes. It is the source of
  truth for the Node status checker (`status-checker.ts`), because the declared
  sizes in the model registry are frequently estimates.
- Partials are left in place on cancel/error so the next attempt resumes.

That compatibility is the point: models already on disk, and the Node code that
reads them, must not notice the engine moved process.
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import httpx

# Progress is reported (and the write buffer flushed) about this often. Bytes
# are only counted once they've reached the file, so a cancelled download's
# reported progress still matches what a resume will find on disk.
_FLUSH_INTERVAL_BYTES = 1024 * 1024

# Per-chunk read timeout. Generous: HF's CDN can stall briefly mid-transfer on
# a large file, and killing a multi-gigabyte download over one slow chunk is
# far worse than waiting.
_TIMEOUT = httpx.Timeout(120.0, connect=30.0)


@dataclass
class DownloadFile:
    name: str
    # Expected size in bytes. 0 means "unknown" — no size check, and no resume
    # (we can't tell a complete file from a partial one).
    size: int = 0


@dataclass
class DownloadSpec:
    model_id: str
    repo_id: str
    files: list[DownloadFile]
    target_dir: Path
    hf_token: Optional[str] = None


class DownloadCancelled(Exception):
    """Raised internally when the caller's cancel event fires mid-transfer."""


def _meta_path_for(file_path: Path) -> Path:
    return file_path.with_name(f"{file_path.name}.download-meta.json")


def _read_download_meta(file_path: Path) -> Optional[dict]:
    try:
        return json.loads(_meta_path_for(file_path).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def _remove_quietly(path: Path) -> None:
    try:
        path.unlink()
    except OSError:
        # Already gone — fine.
        pass


def _size_on_disk(path: Path) -> int:
    try:
        return path.stat().st_size
    except OSError:
        return 0


def _previous_manifest_files(manifest_path: Path) -> list[str]:
    """File names from a previous download of this model, for the post-download
    sweep. Left in place they shadow the new layout at model load time (e.g.
    after switching quantisation variants)."""
    try:
        data = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    entries = data.get("files") or []
    return [e["name"] for e in entries if isinstance(e, dict) and "name" in e]


def _progress(
    spec: DownloadSpec,
    download_id: str,
    status: str,
    *,
    bytes_downloaded: int,
    total_bytes: int,
    current_file: Optional[str] = None,
    file_index: Optional[int] = None,
    total_files: Optional[int] = None,
    error: Optional[str] = None,
) -> dict:
    return {
        "download_id": download_id,
        "model_id": spec.model_id,
        "status": status,
        "current_file": current_file,
        "file_index": file_index,
        "total_files": total_files,
        "bytes_downloaded": bytes_downloaded,
        "total_bytes": total_bytes,
        "error": error,
    }


async def download_model_files(
    spec: DownloadSpec,
    download_id: str,
    cancel_event: asyncio.Event,
    transport: Optional[httpx.AsyncBaseTransport] = None,
) -> AsyncIterator[dict]:
    """Download `spec.files` into `spec.target_dir`, yielding progress dicts.

    Yields a terminal `ready` or `error` event, or simply stops iterating when
    `cancel_event` fires (an intentional stop is not an error — the caller
    decides what to record).

    `transport` exists so tests can serve the range/ETag/416 responses this
    engine's resume logic turns on without reaching HuggingFace.
    """
    target_dir = spec.target_dir
    target_dir.mkdir(parents=True, exist_ok=True)

    manifest_path = target_dir / f"{spec.model_id}.manifest.json"
    previous_files = _previous_manifest_files(manifest_path)

    total_bytes = sum(f.size for f in spec.files)
    total_files = len(spec.files)
    bytes_downloaded = 0

    auth_headers: dict[str, str] = (
        {"Authorization": f"Bearer {spec.hf_token}"} if spec.hf_token else {}
    )

    async with httpx.AsyncClient(
        follow_redirects=True, timeout=_TIMEOUT, transport=transport
    ) as client:
        for file_idx, file in enumerate(spec.files):
            file_index = file_idx + 1  # 1-based for display
            file_path = target_dir / file.name
            # file.name may contain subdirectories (e.g.
            # "transformer/shard.safetensors" for diffusers pipeline repos).
            file_path.parent.mkdir(parents=True, exist_ok=True)

            existing_size = _size_on_disk(file_path)

            # Already complete — skip and credit toward overall progress.
            if existing_size > 0 and file.size > 0 and existing_size == file.size:
                bytes_downloaded += existing_size
                yield _progress(
                    spec,
                    download_id,
                    "downloading",
                    current_file=file.name,
                    file_index=file_index,
                    total_files=total_files,
                    bytes_downloaded=bytes_downloaded,
                    total_bytes=total_bytes,
                )
                continue

            # NOTE: exceeding the manifest's expected size does NOT mean the
            # file is corrupt. Several registry sizes are deliberate estimates
            # and a fully downloaded file can legitimately be larger — eagerly
            # deleting here used to throw away good multi-gigabyte downloads.
            # The resume path below decides instead: a Range request from
            # `existing_size` returns 416 when the file is already complete.

            # With no expected size we can't safely resume — start fresh.
            can_resume = file.size > 0 and existing_size > 0

            url = f"https://huggingface.co/{spec.repo_id}/resolve/main/{file.name}"

            # Credit already-on-disk bytes before we start writing.
            bytes_downloaded += existing_size

            yield _progress(
                spec,
                download_id,
                "downloading",
                current_file=file.name,
                file_index=file_index,
                total_files=total_files,
                bytes_downloaded=bytes_downloaded,
                total_bytes=total_bytes,
            )

            try:
                async for event in _download_one(
                    client=client,
                    spec=spec,
                    download_id=download_id,
                    file=file,
                    file_path=file_path,
                    file_index=file_index,
                    total_files=total_files,
                    url=url,
                    auth_headers=auth_headers,
                    can_resume=can_resume,
                    existing_size=existing_size,
                    bytes_before=bytes_downloaded,
                    total_bytes=total_bytes,
                    cancel_event=cancel_event,
                ):
                    kind, payload = event
                    if kind == "progress":
                        bytes_downloaded = payload
                        yield _progress(
                            spec,
                            download_id,
                            "downloading",
                            current_file=file.name,
                            file_index=file_index,
                            total_files=total_files,
                            bytes_downloaded=bytes_downloaded,
                            total_bytes=total_bytes,
                        )
                    elif kind == "settled":
                        bytes_downloaded = payload
            except DownloadCancelled:
                # Intentional — the caller records the cancellation. The
                # partial stays on disk for the next attempt to resume.
                return
            except Exception as err:  # noqa: BLE001 — surfaced as an error event
                yield _progress(
                    spec,
                    download_id,
                    "error",
                    current_file=file.name,
                    file_index=file_index,
                    total_files=total_files,
                    bytes_downloaded=bytes_downloaded,
                    total_bytes=total_bytes,
                    error=f"Failed to download {file.name}: {err}",
                )
                return

    _finalise(spec, manifest_path, previous_files)

    yield _progress(
        spec,
        download_id,
        "ready",
        bytes_downloaded=total_bytes,
        total_bytes=total_bytes,
    )


async def _download_one(
    *,
    client: httpx.AsyncClient,
    spec: DownloadSpec,
    download_id: str,
    file: DownloadFile,
    file_path: Path,
    file_index: int,
    total_files: int,
    url: str,
    auth_headers: dict[str, str],
    can_resume: bool,
    existing_size: int,
    bytes_before: int,
    total_bytes: int,
    cancel_event: asyncio.Event,
) -> AsyncIterator[tuple[str, int]]:
    """Fetch one file, yielding ("progress", bytes_total_so_far) roughly every
    megabyte and a final ("settled", bytes_total_so_far).

    `bytes_before` already includes `existing_size`; if the server ignores our
    Range that credit is withdrawn, which is what the "settled" event carries.
    """
    # Validate resumes with If-Range: if the repo's file changed since the
    # partial was written, the server ignores the Range and returns the full
    # file (200), which the reset path below handles. Without it, a resume
    # appends new-revision bytes onto old-revision bytes and the corruption
    # passes every later size check. Weak ETags aren't valid for If-Range;
    # fall back to an unvalidated resume.
    resume_etag = None
    if can_resume:
        resume_etag = (_read_download_meta(file_path) or {}).get("etag")

    headers = dict(auth_headers)
    if can_resume:
        headers["Range"] = f"bytes={existing_size}-"
    if resume_etag and not resume_etag.startswith("W/"):
        headers["If-Range"] = resume_etag

    async with client.stream("GET", url, headers=headers) as response:
        if response.status_code >= 400:
            await _raise_for_status(
                response, spec, file_path, existing_size, can_resume
            )
            # _raise_for_status returns normally only for the "416 means the
            # file is already complete" case.
            yield ("settled", bytes_before)
            return

        # 206 Partial Content = server honoured the range, append. 200 OK with
        # a Range header = server ignored it, rewrite from scratch.
        is_resuming = can_resume and response.status_code == 206
        running_total = bytes_before
        if can_resume and not is_resuming:
            # Undo the optimistic credit and overwrite.
            running_total -= existing_size

        # Starting (or restarting) from byte 0 — persist the entity tag so a
        # later resume of this file can validate the partial against it.
        if not is_resuming:
            etag = response.headers.get("etag")
            try:
                if etag:
                    _meta_path_for(file_path).write_text(
                        json.dumps({"etag": etag}), encoding="utf-8"
                    )
                else:
                    _remove_quietly(_meta_path_for(file_path))
            except OSError:
                # Best-effort — a resume just falls back to unvalidated.
                pass

        mode = "ab" if is_resuming else "wb"
        buffer = bytearray()
        handle = open(file_path, mode)
        try:
            async for chunk in response.aiter_bytes():
                if cancel_event.is_set():
                    raise DownloadCancelled()
                buffer.extend(chunk)
                if len(buffer) >= _FLUSH_INTERVAL_BYTES:
                    # Bytes are only counted once they're on disk, so a cancel
                    # mid-file leaves reported progress matching the partial.
                    await asyncio.to_thread(handle.write, bytes(buffer))
                    running_total += len(buffer)
                    buffer.clear()
                    yield ("progress", running_total)
            if buffer:
                await asyncio.to_thread(handle.write, bytes(buffer))
                running_total += len(buffer)
                buffer.clear()
        finally:
            # Close before anything else can open this path: a fast Resume
            # click must not get a second writer while this one is still
            # flushing, or the two interleave their bytes and corrupt the
            # partial.
            await asyncio.to_thread(handle.close)

    # File is complete — the resume-validation meta is no longer needed.
    _remove_quietly(_meta_path_for(file_path))
    yield ("settled", running_total)


async def _raise_for_status(
    response: httpx.Response,
    spec: DownloadSpec,
    file_path: Path,
    existing_size: int,
    can_resume: bool,
) -> None:
    """Turn an error response into a helpful exception.

    Returns normally in exactly one case: a 416 whose Content-Range shows the
    file on disk is already the whole thing.
    """
    status = response.status_code

    if status in (401, 403):
        if spec.hf_token:
            raise RuntimeError(
                f"Access denied ({status}). This repo is gated — accept the "
                f"license at https://huggingface.co/{spec.repo_id}"
            )
        raise RuntimeError(
            f"Access denied ({status}). This repo may be gated. Set a "
            "HuggingFace token in Model Manager → Settings, and accept the "
            f"license at https://huggingface.co/{spec.repo_id}"
        )

    # 416 = range not satisfiable. Its Content-Range is "bytes */<total>"; if
    # our on-disk size already matches the total, the file is complete and only
    # the registry's size estimate was wrong. Deleting it here (the old
    # behaviour) threw away good multi-gigabyte downloads.
    if status == 416:
        content_range = response.headers.get("content-range", "")
        _, _, declared = content_range.partition("*/")
        if declared.strip().isdigit() and int(declared.strip()) == existing_size:
            _remove_quietly(_meta_path_for(file_path))
            return
        _remove_quietly(file_path)
        _remove_quietly(_meta_path_for(file_path))
        raise RuntimeError("Existing partial file is unusable. Try again.")

    raise RuntimeError(f"HTTP {status}: {response.reason_phrase}")


def _finalise(
    spec: DownloadSpec, manifest_path: Path, previous_files: list[str]
) -> None:
    """Write the per-model manifest and sweep files the new layout dropped.

    Keyed by model id because multiple models can share a target dir (every
    SDXL checkpoint lives under `<models>/sdxl/`), and a shared manifest would
    make each model report its neighbour's files as its own.
    """
    try:
        entries = []
        for file in spec.files:
            file_path = spec.target_dir / file.name
            if file_path.exists():
                entries.append(
                    {"name": file.name, "size": file_path.stat().st_size}
                )
        manifest_path.write_text(
            json.dumps({"files": entries}, indent=2), encoding="utf-8"
        )

        current_names = {f.name for f in spec.files}
        for old_name in previous_files:
            if old_name in current_names:
                continue
            old_path = spec.target_dir / old_name
            _remove_quietly(old_path)
            _remove_quietly(old_path.with_name(f"{old_path.name}.model.json"))
            _remove_quietly(_meta_path_for(old_path))
    except OSError:
        # Manifest write is best-effort; the status check falls back to the
        # registry's declared sizes.
        pass
