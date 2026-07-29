"""Crash-proof stdout/stderr for a process that outlives its parent.

The sidecar is spawned by Node with piped stdio but is designed to keep
running after that Node process exits (dev-server restarts, HMR). On
Windows, writing to a pipe whose read end is gone raises OSError(EINVAL),
so any bare print() after the parent dies crashes whatever code path ran
it — surfacing to the user as "[Errno 22] Invalid argument" — while
print-free code paths keep working.

install() wraps sys.stdout/sys.stderr: the first failed write flips the
wrapper to a shared fallback log file so post-orphaning diagnostics (e.g.
the ai-toolkit server startup prints) are preserved rather than lost with
the pipe. A re-spawned sidecar truncates the fallback on first use, so it
only ever holds the most recent orphaned session's output.
"""

import sys
from pathlib import Path
from typing import Optional, TextIO

_fallback_path: Optional[Path] = None
_fallback_handle: Optional[TextIO] = None
_fallback_failed = False


def _fallback() -> Optional[TextIO]:
    """Lazily open the shared fallback file. None if unavailable."""
    global _fallback_handle, _fallback_failed
    if _fallback_handle is None and not _fallback_failed:
        if _fallback_path is None:
            _fallback_failed = True
            return None
        try:
            _fallback_handle = open(_fallback_path, "w", encoding="utf-8")
        except OSError:
            _fallback_failed = True
    return _fallback_handle


class _SafeStream:
    """Delegates to the real stream until a write fails, then to the
    fallback file. Never raises from write/flush."""

    def __init__(self, stream: TextIO):
        self._stream = stream
        self._broken = False

    def _target(self) -> Optional[TextIO]:
        return _fallback() if self._broken else self._stream

    def write(self, data: str) -> int:
        target = self._target()
        if target is None:
            return len(data)
        try:
            target.write(data)
            target.flush()
        except OSError:
            if self._broken:
                # The fallback file itself failed — stop trying.
                global _fallback_failed, _fallback_handle
                _fallback_failed = True
                _fallback_handle = None
            else:
                self._broken = True
                retry = _fallback()
                if retry is not None:
                    try:
                        retry.write(data)
                        retry.flush()
                    except OSError:
                        _fallback_failed = True
                        _fallback_handle = None
        return len(data)

    def flush(self) -> None:
        target = self._target()
        if target is None:
            return
        try:
            target.flush()
        except OSError:
            self._broken = True

    def __getattr__(self, name):
        return getattr(self._stream, name)


def install(fallback_path: Optional[Path]) -> None:
    """Wrap sys.stdout/sys.stderr. Call before anything (e.g. uvicorn's
    logging config) captures a reference to the raw streams."""
    global _fallback_path
    _fallback_path = fallback_path
    sys.stdout = _SafeStream(sys.stdout)
    sys.stderr = _SafeStream(sys.stderr)
