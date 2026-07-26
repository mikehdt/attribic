"""Host CPU / memory / GPU sampling for the activity readouts.

Deliberately dependency-light. CPU and system memory come from psutil; GPU
figures come from shelling out to `nvidia-smi` rather than pynvml or
`torch.cuda`, because the base sidecar environment has no CUDA toolchain (torch
only arrives with the optional `gpu` extra) and this has to work either way.

Sampling is cached for a beat so several pollers — the global menu and the
activity panel can both be open — cost one `nvidia-smi` spawn between them.
"""

import asyncio
import shutil
import time
from typing import Optional

from models import GpuStats, SystemStats

try:
    import psutil
except ImportError:  # pragma: no cover - psutil is a declared dependency
    psutil = None  # type: ignore[assignment]

# Longest a cached sample is served before we re-measure. Comfortably under the
# UI's poll interval, so a poll almost always gets fresh figures while bursts of
# concurrent callers share one.
CACHE_TTL_SECONDS = 1.0

# `nvidia-smi` is a subprocess spawn (tens to a couple of hundred ms). Bound it
# so a wedged driver can't hang the endpoint.
NVIDIA_SMI_TIMEOUT_SECONDS = 3.0

NVIDIA_SMI_QUERY = (
    "index,name,utilization.gpu,memory.used,memory.total,temperature.gpu"
)

_cached: Optional[SystemStats] = None
_cached_at: float = 0.0
# Serialises concurrent callers onto one measurement rather than letting each
# spawn its own nvidia-smi while the first is still running.
_lock = asyncio.Lock()


def prime() -> None:
    """Prime psutil's CPU counter.

    `cpu_percent(interval=None)` reports usage since the previous call, so the
    very first one always returns 0.0. Called at startup, that throwaway read
    happens long before anything asks for stats.
    """
    if psutil is not None:
        psutil.cpu_percent(interval=None)


def _parse_float(value: str) -> Optional[float]:
    """Parse one nvidia-smi CSV cell, tolerating its `[N/A]` placeholders."""
    try:
        return float(value)
    except ValueError:
        return None


async def _read_gpus() -> list[GpuStats]:
    """Query every visible NVIDIA GPU. Returns [] when there isn't one to ask."""
    if shutil.which("nvidia-smi") is None:
        return []

    try:
        proc = await asyncio.create_subprocess_exec(
            "nvidia-smi",
            f"--query-gpu={NVIDIA_SMI_QUERY}",
            "--format=csv,noheader,nounits",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
        )
    except OSError:
        return []

    try:
        stdout, _ = await asyncio.wait_for(
            proc.communicate(), timeout=NVIDIA_SMI_TIMEOUT_SECONDS
        )
    except (asyncio.TimeoutError, OSError):
        try:
            proc.kill()
        except OSError:
            pass
        return []

    if proc.returncode != 0:
        return []

    gpus: list[GpuStats] = []
    for line in stdout.decode("utf-8", errors="replace").splitlines():
        cells = [cell.strip() for cell in line.split(",")]
        if len(cells) < 6:
            continue
        index = _parse_float(cells[0])
        gpus.append(
            GpuStats(
                index=int(index) if index is not None else len(gpus),
                name=cells[1],
                utilization=_parse_float(cells[2]),
                memory_used_mb=_parse_float(cells[3]),
                memory_total_mb=_parse_float(cells[4]),
                temperature_c=_parse_float(cells[5]),
            )
        )
    return gpus


async def collect() -> SystemStats:
    """Current host stats, re-measured at most once per `CACHE_TTL_SECONDS`."""
    global _cached, _cached_at

    now = time.monotonic()
    if _cached is not None and now - _cached_at < CACHE_TTL_SECONDS:
        return _cached

    async with _lock:
        # A caller that queued behind the lock is served the sample the holder
        # just took, rather than immediately taking another.
        now = time.monotonic()
        if _cached is not None and now - _cached_at < CACHE_TTL_SECONDS:
            return _cached

        cpu_percent: Optional[float] = None
        memory_used_mb: Optional[float] = None
        memory_total_mb: Optional[float] = None
        if psutil is not None:
            cpu_percent = psutil.cpu_percent(interval=None)
            memory = psutil.virtual_memory()
            memory_used_mb = (memory.total - memory.available) / (1024 * 1024)
            memory_total_mb = memory.total / (1024 * 1024)

        stats = SystemStats(
            cpu_percent=cpu_percent,
            memory_used_mb=memory_used_mb,
            memory_total_mb=memory_total_mb,
            gpus=await _read_gpus(),
        )
        _cached = stats
        _cached_at = time.monotonic()
        return stats
