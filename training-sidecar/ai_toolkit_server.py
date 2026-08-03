"""Lifecycle manager for ai-toolkit's bundled web UI / API server.

ai-toolkit ships a Next.js + cron-worker app under `<toolkit>/ui` that
exposes the HTTP API we use to drive training (POST /api/jobs, etc.).
Rather than depend on the user starting it manually, this module
ensures it's running whenever we need it — detecting an existing
instance on the configured port, otherwise spawning `npm run start`
from the ui directory and waiting for readiness.

We track only servers we spawned ourselves so we don't kill a user's
manually-started instance on shutdown.
"""

from __future__ import annotations

import asyncio
import os
import shutil
import signal
import subprocess
import sys
from pathlib import Path
from typing import Optional

import httpx
import psutil


class AiToolkitServer:
    """Manages a (possibly external) ai-toolkit web server on `localhost:port`."""

    def __init__(
        self,
        toolkit_path: Path,
        port: int = 8675,
        log_path: Optional[Path] = None,
    ):
        self._toolkit_path = Path(toolkit_path)
        self._port = port
        self._process: Optional[asyncio.subprocess.Process] = None
        # True if we spawned the server (we own its lifecycle); False if
        # we attached to a pre-existing one (don't kill it on shutdown).
        self._owns_process = False
        self._log_path = log_path
        self._log_handle = None

    @property
    def port(self) -> int:
        return self._port

    @property
    def log_path(self) -> Optional[Path]:
        """Path to the ai-toolkit server log we tee stdout/stderr into (where
        the worker's tracebacks land). None if no log path was configured."""
        return self._log_path

    @property
    def base_url(self) -> str:
        return f"http://localhost:{self._port}"

    async def ensure_running(self, timeout: float = 180.0) -> None:
        """Make sure the ai-toolkit server is responding. Spawns one if needed.

        Self-heals a wedged instance: if the port is held by a server that
        responds with 5xx (or holds the port without answering HTTP at all —
        e.g. a schema-drifted DB 500ing every query), that tree is killed and
        a fresh, schema-synced server is spawned in its place.

        Raises RuntimeError on failure.
        """
        status = await self._probe()
        if status == "healthy":
            return
        # A single failed probe can be a transient blip on a healthy-but-busy
        # server we don't want to kill. Confirm before doing anything drastic.
        await asyncio.sleep(1.0)
        status = await self._probe()
        if status == "healthy":
            return

        ui_dir = self._toolkit_path / "ui"
        if not ui_dir.exists():
            raise RuntimeError(
                f"ai-toolkit ui directory not found at {ui_dir}. "
                "Make sure the trainingBackends['ai-toolkit'] path in config.json "
                "points at the AI-Toolkit folder (not its parent)."
            )

        npm = shutil.which("npm")
        if npm is None:
            raise RuntimeError(
                "`npm` not found on PATH. ai-toolkit's UI server is a Node app "
                "and needs Node.js installed to run."
            )

        # If a wedged server is holding the port, a fresh `npm run start`
        # can't bind and we'd fail. Reclaim it first. We only reach here after
        # two failed probes, so an "unhealthy" (5xx) or a non-answering process
        # still holding the port is genuinely broken — killing it is the point.
        if status == "unhealthy" or self._listener_pids():
            print(
                f"[aitk-server] ai-toolkit on {self.base_url} is not healthy "
                f"(status={status}); reclaiming the port and respawning."
            )
            await self._reclaim_port()

        env = self._build_clean_env()

        # Open a log file we can tail so the user can actually see what
        # ai-toolkit's worker / Next server is doing — silent failures
        # in the worker process were previously invisible (the queue
        # would just sit "stopped" with no clue why). Opened before the DB
        # sync so its output is captured too.
        if self._log_path is not None:
            self._log_path.parent.mkdir(parents=True, exist_ok=True)
            self._log_handle = open(self._log_path, "w", encoding="utf-8")
            print(
                f"[aitk-server] Starting ai-toolkit UI server in {ui_dir} "
                f"(log: {self._log_path})"
            )
        else:
            print(
                f"[aitk-server] Starting ai-toolkit UI server in {ui_dir} "
                f"(this may take a moment on first run)..."
            )

        # Keep aitk_db.db in step with ai-toolkit's Prisma schema before
        # starting. ai-toolkit only applies column additions via `update_db`
        # (which its build_and_start runs) — a bare `npm run start` skips it,
        # so a drifted DB 500s every query and wedges the server.
        await self._sync_db(npm, ui_dir, env)

        # Prevent npm.cmd from opening a visible console that steals focus
        # on Windows; stdio is piped to our log file either way.
        creationflags = subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0

        self._process = await asyncio.create_subprocess_exec(
            npm,
            "run",
            "start",
            cwd=str(ui_dir),
            env=env,
            stdout=self._log_handle if self._log_handle else asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.STDOUT
            if self._log_handle
            else asyncio.subprocess.DEVNULL,
            creationflags=creationflags,
        )
        self._owns_process = True

        await self._wait_for_ready(timeout)
        print(f"[aitk-server] ai-toolkit UI ready at {self.base_url}")

    async def stop(self) -> None:
        """Shut down the server — only if we spawned it."""
        if not self._owns_process or self._process is None:
            return

        try:
            if sys.platform == "win32":
                # Kill the npm process tree (npm spawns workers + Next).
                # Spawned rather than os.system() so the kill doesn't block
                # the event loop (and with it every other job's progress)
                # while it runs — mirrors the pattern already used for
                # cancelling a Kohya run in providers/kohya.py.
                killer = await asyncio.create_subprocess_exec(
                    "taskkill",
                    "/F",
                    "/T",
                    "/PID",
                    str(self._process.pid),
                    stdout=asyncio.subprocess.DEVNULL,
                    stderr=asyncio.subprocess.DEVNULL,
                )
                await killer.wait()
            else:
                self._process.terminate()
            try:
                await asyncio.wait_for(self._process.wait(), timeout=10)
            except asyncio.TimeoutError:
                self._process.kill()
        except ProcessLookupError:
            pass

        self._process = None
        self._owns_process = False

        if self._log_handle is not None:
            try:
                self._log_handle.close()
            except OSError:
                pass
            self._log_handle = None

    # ----- internals -----

    async def _probe(self) -> str:
        """Classify the server on our port: 'healthy' | 'unhealthy' | 'down'.

        - healthy: answers /api/jobs with < 500
        - unhealthy: answers, but with a 5xx (e.g. schema-drifted DB → P2022)
        - down: nothing answering (connection refused / timeout)
        """
        try:
            async with httpx.AsyncClient(timeout=3.0) as client:
                # /api/jobs is cheap (just a SELECT * FROM Job) and exists
                # in every recent ai-toolkit build.
                res = await client.get(f"{self.base_url}/api/jobs")
                return "healthy" if res.status_code < 500 else "unhealthy"
        except (httpx.HTTPError, OSError):
            return "down"

    async def _is_responding(self) -> bool:
        return await self._probe() == "healthy"

    async def _sync_db(self, npm: str, ui_dir: Path, env: dict[str, str]) -> None:
        """Run ai-toolkit's `update_db` (prisma generate + db push).

        Brings aitk_db.db in step with ai-toolkit's Prisma schema so newly
        added columns exist before the server queries them. Best-effort: on
        failure we log and continue, since the server may still start.
        """
        creationflags = subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0
        try:
            proc = await asyncio.create_subprocess_exec(
                npm,
                "run",
                "update_db",
                cwd=str(ui_dir),
                env=env,
                stdout=self._log_handle
                if self._log_handle
                else asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.STDOUT
                if self._log_handle
                else asyncio.subprocess.DEVNULL,
                creationflags=creationflags,
            )
            await asyncio.wait_for(proc.wait(), timeout=120)
            if proc.returncode == 0:
                print("[aitk-server] DB schema synced (prisma db push).")
            else:
                print(
                    f"[aitk-server] update_db exited {proc.returncode}; "
                    "continuing (server may still start)."
                )
        except (asyncio.TimeoutError, OSError) as exc:
            print(f"[aitk-server] update_db failed ({exc}); continuing.")

    def _listener_pids(self) -> list[int]:
        """PIDs of processes LISTENING on our port (both IPv4 and IPv6)."""
        needle = f":{self._port}"
        pids: set[int] = set()
        try:
            if sys.platform == "win32":
                out = subprocess.run(
                    ["netstat", "-ano", "-p", "TCP"],
                    capture_output=True,
                    text=True,
                    timeout=5,
                ).stdout
                for line in out.splitlines():
                    if "LISTENING" not in line:
                        continue
                    parts = line.split()
                    # cols: Proto  Local  Foreign  State  PID
                    if len(parts) >= 5 and parts[1].endswith(needle):
                        if parts[-1].isdigit():
                            pids.add(int(parts[-1]))
            else:
                out = subprocess.run(
                    ["lsof", "-ti", f"tcp:{self._port}", "-sTCP:LISTEN"],
                    capture_output=True,
                    text=True,
                    timeout=5,
                ).stdout
                pids.update(int(x) for x in out.split() if x.strip().isdigit())
        except (OSError, subprocess.SubprocessError, ValueError):
            pass
        return list(pids)

    def _is_reclaimable(self, pid: int) -> bool:
        """Best-effort guard so we only kill processes that look like our own
        ai-toolkit UI server — not some unrelated app that happens to be
        listening on the configured port.

        A process is considered ours if its cmdline references our toolkit
        path, or it's a node/next process (npm's tree is `npm` → `node`
        running `next start` + the cron worker). Anything else is refused.
        If the process is already gone or we can't inspect it (permissions),
        we treat it as reclaimable rather than block port reuse forever over
        a pid that may not even exist anymore.
        """
        try:
            proc = psutil.Process(pid)
            name = (proc.name() or "").lower()
            cmdline = " ".join(proc.cmdline()).lower()
        except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
            return True

        toolkit_needle = str(self._toolkit_path).lower()
        if toolkit_needle and toolkit_needle in cmdline:
            return True
        if "node" in name or "next" in cmdline or "npm" in name:
            return True

        print(
            f"[aitk-server] Port {self._port} is held by an unrelated process "
            f"({name!r}, pid {pid}) — not killing it. Change 'aiToolkitPort' "
            "in config.json or free the port manually.",
            flush=True,
        )
        return False

    async def _reclaim_port(self) -> None:
        """Kill whatever is listening on our port, tree-wide, and wait for it
        to free. Resets our own ownership flags so the next spawn is clean.

        Refuses to kill a listener that doesn't look like our own ai-toolkit
        UI server (see `_is_reclaimable`) — raises instead, so an unrelated
        process holding the port fails loudly rather than getting killed.
        """
        pids = self._listener_pids()
        blocked = [pid for pid in pids if not self._is_reclaimable(pid)]
        killable = [pid for pid in pids if pid not in blocked]

        for pid in killable:
            try:
                if sys.platform == "win32":
                    # /T kills the whole tree (npm → concurrently → worker+next).
                    # Spawned rather than os.system() so this doesn't block the
                    # event loop while it runs.
                    killer = await asyncio.create_subprocess_exec(
                        "taskkill",
                        "/F",
                        "/T",
                        "/PID",
                        str(pid),
                        stdout=asyncio.subprocess.DEVNULL,
                        stderr=asyncio.subprocess.DEVNULL,
                    )
                    await killer.wait()
                else:
                    # Kills the whole process group in one go. Left as SIGKILL
                    # (rather than SIGTERM-then-SIGKILL) — the `_is_reclaimable`
                    # guard above already limits this to processes that look
                    # like our own ai-toolkit tree, and graceful shutdown isn't
                    # this path's job (this only runs when the server is
                    # already unhealthy or wedged).
                    os.killpg(os.getpgid(pid), signal.SIGKILL)
            except (OSError, ProcessLookupError):
                pass

        if blocked:
            raise RuntimeError(
                f"Port {self._port} is held by a process that doesn't look "
                "like ai-toolkit's UI server, so it wasn't killed. Change "
                "'aiToolkitPort' in config.json or free the port manually."
            )

        # Any handle we held points at a now-dead tree.
        self._process = None
        self._owns_process = False

        # Wait for the LISTEN socket to actually clear before we try to bind.
        for _ in range(40):
            if not self._listener_pids():
                return
            await asyncio.sleep(0.25)

    async def _wait_for_ready(self, timeout: float) -> None:
        deadline = asyncio.get_event_loop().time() + timeout
        while asyncio.get_event_loop().time() < deadline:
            if await self._is_responding():
                return
            # If our subprocess died early, fail fast
            if self._process and self._process.returncode is not None:
                raise RuntimeError(
                    f"ai-toolkit UI server exited unexpectedly with code "
                    f"{self._process.returncode}. Try running "
                    f"`npm run start` from {self._toolkit_path / 'ui'} manually "
                    "to see the error."
                )
            await asyncio.sleep(1.0)
        raise RuntimeError(
            f"ai-toolkit UI server did not become ready on {self.base_url} "
            f"within {timeout:.0f}s."
        )

    def _build_clean_env(self) -> dict[str, str]:
        """Match the env-clearing the upstream Start-AI-Toolkit.bat does.

        These vars can confuse the embedded Python the UI's child workers
        use when invoking run.py.
        """
        env = dict(os.environ)
        env["GIT_LFS_SKIP_SMUDGE"] = "1"
        for key in (
            "PYTHONPATH",
            "PYTHONHOME",
            "PYTHON",
            "PYTHONSTARTUP",
            "PYTHONUSERBASE",
            "PIP_CONFIG_FILE",
            "PIP_REQUIRE_VIRTUALENV",
            "VIRTUAL_ENV",
            "CONDA_PREFIX",
            "CONDA_DEFAULT_ENV",
            "PYENV_ROOT",
            "PYENV_VERSION",
        ):
            env.pop(key, None)

        # Prepend python_embeded so the UI's worker can find its own python.
        embed = self._toolkit_path.parent / "python_embeded"
        if embed.exists():
            scripts = embed / "Scripts"
            extra = f"{embed};{scripts}" if sys.platform == "win32" else str(embed)
            env["PATH"] = extra + os.pathsep + env.get("PATH", "")

        return env
