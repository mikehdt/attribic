"""Host power management — keep the machine awake while work is in flight.

The OS will happily idle-sleep out from under a multi-hour training run. The
run itself survives (it resumes when the machine wakes) but hours of wall clock
are lost, and a download mid-transfer usually loses its connection outright.
While the user has opted in AND there's actually work running, we ask the OS
not to idle-sleep.

Deliberately *system* sleep only, never display: nobody wants the monitor held
on all night for a six-hour run. The screensaver and display timeout still fire
on every platform here — only the machine dropping into suspend is blocked. An
explicit "Sleep" from the user is likewise still honoured everywhere; this only
suppresses the idle timer.

Two mechanisms, one interface:

* Windows — `SetThreadExecutionState`, a flag on the *calling thread*. It stays
  asserted until cleared or the thread dies, which is why every call here must
  come from the same long-lived thread (the asyncio loop's). Calling it from a
  `to_thread` worker would assert the flag on a pool thread that then exits,
  silently dropping the lock.
* macOS / Linux — a held child process (`caffeinate` / `systemd-inhibit`).
  There's no in-process flag to set, so the inhibition lasts exactly as long as
  the helper does. Both helpers are also tied back to this PID so a hard kill
  of the sidecar can't strand one holding the machine awake forever.
"""

import ctypes
import os
import subprocess
import sys
from typing import Optional

# --- Windows execution-state flags (winbase.h) ---
ES_CONTINUOUS = 0x80000000
ES_SYSTEM_REQUIRED = 0x00000001

_IS_WINDOWS = sys.platform == "win32"

# Whether we currently believe the lock is held.
_active = False
# The held helper process on macOS/Linux. None on Windows (no helper needed).
_helper: Optional[subprocess.Popen] = None
# Set after we've reported a failure, so a platform that simply can't do this
# doesn't reprint the same line every tick for the life of the process.
_warned = False


def _log(message: str) -> None:
    print(f"[power] {message}", flush=True)


def _warn_once(message: str) -> None:
    global _warned
    if _warned:
        return
    _warned = True
    _log(message)


def _helper_command() -> Optional[list[str]]:
    """The command whose lifetime holds the lock, or None on this platform."""
    pid = os.getpid()

    if sys.platform == "darwin":
        # -i inhibits idle *system* sleep and leaves display sleep alone.
        # -w makes caffeinate exit when this PID does.
        return ["caffeinate", "-i", "-w", str(pid)]

    if sys.platform.startswith("linux"):
        # --what=idle blocks only the idle-triggered suspend, matching what
        # Windows and macOS do here; --what=sleep would also veto a deliberate
        # suspend, which isn't ours to override. logind kills the inhibitor
        # with the process that holds it, so the `sleep` is the lock.
        return [
            "systemd-inhibit",
            "--what=idle",
            "--who=img-tagger",
            "--why=Training, captioning or downloading in progress",
            "--mode=block",
            "sleep",
            "infinity",
        ]

    return None


def _windows_set(flags: int) -> bool:
    try:
        kernel32 = ctypes.windll.kernel32
        kernel32.SetThreadExecutionState.argtypes = [ctypes.c_uint]
        kernel32.SetThreadExecutionState.restype = ctypes.c_uint
        # Returns the previous state, or 0 on failure — never 0 on success,
        # since ES_CONTINUOUS is always part of a valid previous state.
        return kernel32.SetThreadExecutionState(flags) != 0
    except (AttributeError, OSError) as err:
        _warn_once(f"SetThreadExecutionState unavailable: {err}")
        return False


def _acquire() -> bool:
    global _helper, _warned

    if _IS_WINDOWS:
        if not _windows_set(ES_CONTINUOUS | ES_SYSTEM_REQUIRED):
            return False
        _warned = False
        return True

    command = _helper_command()
    if command is None:
        _warn_once(
            f"No sleep-inhibition mechanism known for platform {sys.platform!r} "
            "— the machine may sleep during long runs."
        )
        return False

    try:
        _helper = subprocess.Popen(
            command,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    except (OSError, ValueError) as err:
        _warn_once(f"Could not start {command[0]} to inhibit sleep: {err}")
        return False

    _warned = False
    return True


def _release() -> None:
    global _helper

    if _IS_WINDOWS:
        # Dropping ES_SYSTEM_REQUIRED while keeping ES_CONTINUOUS is the
        # documented way to clear a continuous assertion.
        _windows_set(ES_CONTINUOUS)
        return

    helper, _helper = _helper, None
    if helper is None or helper.poll() is not None:
        return
    helper.terminate()
    try:
        helper.wait(timeout=5)
    except subprocess.TimeoutExpired:
        helper.kill()


def _still_held() -> bool:
    """Whether the lock we think we hold is genuinely still in effect."""
    if _IS_WINDOWS:
        # A thread-level flag can't lapse on its own while this thread lives.
        return True
    return _helper is not None and _helper.poll() is None


def set_keep_awake(active: bool) -> None:
    """Assert or release the sleep inhibition. Safe to call every tick.

    Idempotent, and self-healing: a helper process that died (killed by hand,
    or by an OOM sweep) is noticed here and respawned rather than leaving the
    machine quietly free to sleep mid-run.

    Windows note: must always be called from the same thread — see the module
    docstring.
    """
    global _active

    if active:
        if _active and _still_held():
            return
        _active = _acquire()
        if _active:
            _log("Holding the machine awake while work is in flight.")
        return

    if not _active:
        return
    _release()
    _active = False
    _log("Released the sleep inhibition — nothing left running.")


def is_keep_awake_active() -> bool:
    """Whether the inhibition is currently held. Surfaced on /health so the
    behaviour is checkable without reading OS power state by hand."""
    return _active and _still_held()
