/**
 * Sidecar process manager — spawns and monitors the Python FastAPI training server.
 *
 * This module is server-only (uses child_process, fs). Do not import from client code.
 */

import { type ChildProcess, execSync, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

import { hasNodeActivity } from '@/app/services/power/node-activity';

import { getTrainingRoot } from './training-root';

const SIDECAR_PORT = 9733;
const HEALTH_TIMEOUT_MS = 5000;
// Generous because the first `uv run` provisions the whole venv (torch is
// multiple GB). Real failures resolve early via the process exit handler —
// this ceiling only bites when startup genuinely hangs.
const READY_TIMEOUT_MS = 10 * 60 * 1000;

type SidecarState = {
  process: ChildProcess | null;
  port: number;
  status: 'stopped' | 'starting' | 'ready' | 'error';
  error: string | null;
};

// Module-level singleton — persists across API route invocations
const state: SidecarState = {
  process: null,
  port: SIDECAR_PORT,
  status: 'stopped',
  error: null,
};

function getAppRoot(): string {
  return process.cwd();
}

function getPidPath(): string {
  return path.join(getTrainingRoot(), 'sidecar.pid');
}

function getSidecarDir(): string {
  return path.join(getAppRoot(), 'training-sidecar');
}

/**
 * Check whether `uv` is available on PATH.
 * Cached since PATH won't change mid-session.
 */
let uvAvailable: boolean | null = null;
function hasUv(): boolean {
  if (uvAvailable !== null) return uvAvailable;
  try {
    execSync('uv --version', { stdio: 'ignore' });
    uvAvailable = true;
  } catch {
    uvAvailable = false;
  }
  return uvAvailable;
}

/**
 * Read the Python executable path from config.json.
 * Falls back to the venv inside training-sidecar/ if not configured.
 * Only used when uv is not available.
 */
function getPythonPath(): string {
  try {
    const configPath = path.join(getAppRoot(), 'config.json');
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      if (config.pythonPath) return config.pythonPath;
    }
  } catch {
    // Fall through to default
  }

  // Default: venv inside training-sidecar/
  const venvPython = path.join(
    getSidecarDir(),
    '.venv',
    process.platform === 'win32' ? 'Scripts' : 'bin',
    process.platform === 'win32' ? 'python.exe' : 'python',
  );
  if (fs.existsSync(venvPython)) return venvPython;

  // Last resort
  return 'python';
}

/**
 * Resolve the command to spawn the sidecar.
 * Prefers `uv run` (which auto-manages the venv from pyproject.toml),
 * falls back to invoking the venv's python directly.
 */
function getSpawnCommand(): { command: string; args: string[] } {
  const appRoot = getAppRoot();
  const mainArgs = ['main.py', '--app-root', appRoot];

  if (hasUv()) {
    // uv run auto-creates the venv and installs dependencies from pyproject.toml
    // on first invocation — no manual setup required.
    return {
      command: 'uv',
      args: ['run', 'python', '-u', ...mainArgs],
    };
  }

  // Fall back to direct python invocation (requires manual venv setup)
  return {
    command: getPythonPath(),
    args: ['-u', ...mainArgs],
  };
}

/**
 * Kill a process and its children (uv/shell wrappers spawn python as a child).
 */
function killProcessTree(proc: ChildProcess): void {
  if (!proc.pid) return;
  if (process.platform === 'win32') {
    spawnTaskkill(proc.pid);
  } else {
    proc.kill('SIGTERM');
  }
}

/**
 * `taskkill /T` on Windows — the only way to take the whole tree (the sidecar
 * spawns ai-toolkit and sd-scripts children).
 *
 * The error listener is not optional: a ChildProcess that fails to spawn emits
 * `error`, and an unhandled `error` event is a hard crash of the Node server.
 */
function spawnTaskkill(pid: number): void {
  const killer = spawn('taskkill', ['/F', '/T', '/PID', String(pid)], {
    windowsHide: true,
  });
  killer.on('error', (err) => {
    console.error(`[sidecar] taskkill failed for pid ${pid}: ${err.message}`);
  });
}

/**
 * Check if a process with the given PID is still running.
 */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0); // Signal 0 = check existence
    return true;
  } catch {
    return false;
  }
}

/**
 * Is a sidecar process alive right now? Cheap and synchronous — no health
 * request, no spawn.
 *
 * The PID file is written by the sidecar itself on boot, so this covers both a
 * sidecar we spawned and an orphan left by a Node restart. Callers use it to
 * decide who owns the on-disk job records: a non-terminal record is only a live
 * run while there's a process to own it, and Node may only write to those files
 * when there isn't (see services/training/job-records.ts).
 */
export function isSidecarProcessAlive(): boolean {
  if (state.process?.pid && isProcessAlive(state.process.pid)) return true;
  try {
    const pidPath = getPidPath();
    if (!fs.existsSync(pidPath)) return false;
    const pid = parseInt(fs.readFileSync(pidPath, 'utf-8').trim(), 10);
    return !Number.isNaN(pid) && isProcessAlive(pid);
  } catch {
    // Unreadable PID file — treat as no sidecar rather than guessing.
    return false;
  }
}

/**
 * Try to reconnect to an existing sidecar (e.g. after Node.js restart).
 */
async function tryReconnect(): Promise<boolean> {
  const pidPath = getPidPath();
  if (!fs.existsSync(pidPath)) return false;

  try {
    const pid = parseInt(fs.readFileSync(pidPath, 'utf-8').trim(), 10);
    if (!isProcessAlive(pid)) {
      fs.unlinkSync(pidPath);
      return false;
    }

    // Process is alive — check health
    const healthy = await checkHealth();
    if (healthy) {
      state.status = 'ready';
      state.error = null;
      startHeartbeat();
      return true;
    }
  } catch {
    // Stale PID file
  }

  return false;
}

/**
 * Check if the sidecar is responding to health requests.
 */
async function checkHealth(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);

    const res = await fetch(`http://127.0.0.1:${state.port}/health`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    return res.ok;
  } catch {
    return false;
  }
}

// --- Heartbeat -------------------------------------------------------------
//
// While Node is alive we ping the sidecar's /heartbeat so it knows a client is
// present. When Node exits (or crashes) the pings stop, and the sidecar's idle
// watchdog shuts it down once nothing is running — so a detached sidecar isn't
// left orphaned. The interval is unref'd so it never keeps Node alive by itself.
//
// The same ping carries Node's own busy state, which the sidecar's keep-awake
// ticker counts as work in flight (see services/power/node-activity.ts).
const HEARTBEAT_INTERVAL_MS = 30_000;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

async function sendHeartbeat(): Promise<void> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
    await fetch(`http://127.0.0.1:${state.port}/heartbeat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ busy: hasNodeActivity() }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
  } catch {
    // Sidecar down or restarting — nothing to do; the watchdog only acts
    // after a couple of minutes of silence anyway.
  }
}

/**
 * Push a heartbeat now rather than at the next interval. Called when Node's
 * busy state flips, so a tagging batch doesn't spend up to 30s looking idle to
 * the sidecar's keep-awake ticker. A no-op when there's no sidecar to tell.
 */
export function pingSidecarActivity(): void {
  if (!heartbeatTimer) return;
  void sendHeartbeat();
}

/** Begin heartbeating the sidecar (idempotent). */
function startHeartbeat(): void {
  if (heartbeatTimer) return;
  heartbeatTimer = setInterval(() => {
    void sendHeartbeat();
  }, HEARTBEAT_INTERVAL_MS);
  heartbeatTimer.unref?.();
  // Send one immediately so the watchdog arms without waiting a full interval.
  void sendHeartbeat();
}

/**
 * Stop heartbeating. Called when we deliberately shut the sidecar down, so the
 * timer isn't left pinging a dead port every 30s for the life of the server —
 * and so a later spawn gets a fresh immediate ping rather than waiting out the
 * current interval.
 */
function stopHeartbeat(): void {
  if (!heartbeatTimer) return;
  clearInterval(heartbeatTimer);
  heartbeatTimer = null;
}

// In-flight startup, shared so concurrent callers await the same spawn
// instead of the second one seeing 'starting' and bailing with a
// spurious "not ready" error.
let startingPromise: Promise<void> | null = null;

/**
 * Spawn the Python sidecar process. Concurrent calls share one attempt.
 */
function spawnSidecar(): Promise<void> {
  if (startingPromise) return startingPromise;
  startingPromise = doSpawnSidecar().finally(() => {
    startingPromise = null;
  });
  return startingPromise;
}

async function doSpawnSidecar(): Promise<void> {
  state.status = 'starting';
  state.error = null;

  const sidecarDir = getSidecarDir();
  const { command, args } = getSpawnCommand();

  // Ensure the training root exists — the sidecar writes its PID file there
  // as soon as it boots.
  const trainingDir = getTrainingRoot();
  if (!fs.existsSync(trainingDir)) {
    fs.mkdirSync(trainingDir, { recursive: true });
  }

  console.log(`[sidecar] Spawning: ${command} ${args.join(' ')}`);

  const proc = spawn(command, args, {
    cwd: sidecarDir,
    env: { ...process.env, PYTHONUNBUFFERED: '1' },
    stdio: ['pipe', 'pipe', 'pipe'],
    // On POSIX, detach into its own process group so the sidecar survives
    // Node.js HMR restarts. Windows children already outlive the parent by
    // default, and detaching there would open a console window.
    detached: process.platform !== 'win32',
    // Use shell on Windows so `uv` resolves via PATH (uv is a .exe/.cmd shim)
    shell: process.platform === 'win32' && command === 'uv',
    // Prevent a console window flashing/stealing focus on Windows when we
    // spawn through a .cmd shim — stdio pipes still work without a console.
    windowsHide: true,
  });

  state.process = proc;

  // Wait for the SIDECAR_READY signal on stdout
  const ready = await new Promise<boolean>((resolve) => {
    const timeout = setTimeout(() => {
      // Kill the hung process — leaving it running meant the next spawn
      // attempt lost the port race to an orphan we'd given up on.
      console.error('[sidecar] Timed out waiting for ready — killing process');
      killProcessTree(proc);
      resolve(false);
    }, READY_TIMEOUT_MS);

    let stdoutBuffer = '';

    // Detached once the handshake lands: this buffer accumulates everything the
    // sidecar ever prints, so leaving the listener attached for a multi-hour
    // training run grows it without bound (and re-scans it per chunk).
    const onStdout = (chunk: Buffer) => {
      stdoutBuffer += chunk.toString();

      if (stdoutBuffer.includes('SIDECAR_READY')) {
        clearTimeout(timeout);
        // Parse port from the ready message
        const match = stdoutBuffer.match(/SIDECAR_READY port=(\d+)/);
        if (match) {
          state.port = parseInt(match[1], 10);
        }
        proc.stdout?.off('data', onStdout);
        stdoutBuffer = '';
        // Nothing reads stdout from here on, but an unconsumed pipe fills up
        // and blocks the child's writes — keep it flowing (and discarded).
        proc.stdout?.resume();
        resolve(true);
      }
    };
    proc.stdout?.on('data', onStdout);

    proc.stderr?.on('data', (chunk: Buffer) => {
      // Log stderr but don't treat it as fatal (uvicorn logs to stderr)
      const text = chunk.toString().trim();
      if (text) {
        console.log(`[sidecar] ${text}`);
      }
    });

    proc.on('exit', (code, signal) => {
      clearTimeout(timeout);
      console.log(`[sidecar] Process exited (code=${code}, signal=${signal})`);
      state.process = null;
      if (state.status === 'ready' || state.status === 'stopped') {
        // A sidecar we'd already brought up going away isn't a failure to
        // start: either it idle-exited, or we killed it and `killSidecarAndWait`
        // set 'stopped' before this event landed. Reading the exit code as an
        // error there left every deliberate shutdown reporting "Sidecar exited
        // with code 1" in the menu.
        state.status = 'stopped';
      } else {
        state.status = 'error';
        state.error = `Sidecar exited with code ${code}`;
      }
      // Safe to resolve unconditionally — the ready path has already resolved
      // true, so this only settles a start that died on the way up (including
      // one killed by a shutdown racing it, which would otherwise sit here
      // until the ready timeout).
      resolve(false);
    });

    proc.on('error', (err) => {
      clearTimeout(timeout);
      console.error(`[sidecar] Failed to spawn: ${err.message}`);
      state.process = null;
      state.status = 'error';
      state.error = err.message;
      resolve(false);
    });
  });

  if (ready) {
    state.status = 'ready';
    state.error = null;
    startHeartbeat();
  } else if (state.status === 'starting') {
    state.status = 'error';
    state.error = state.error || 'Sidecar failed to start within timeout';
  }
}

/**
 * Ensure the sidecar is running, starting it if necessary.
 */
export async function ensureSidecar(): Promise<{
  status: 'ready' | 'error';
  port: number;
  error: string | null;
}> {
  // Already running?
  if (state.status === 'ready') {
    const healthy = await checkHealth();
    if (healthy) {
      startHeartbeat();
      return { status: 'ready', port: state.port, error: null };
    }
    // Stale state — reset
    state.status = 'stopped';
    state.process = null;
  }

  // Try reconnecting to an orphaned sidecar
  if (await tryReconnect()) {
    return { status: 'ready', port: state.port, error: null };
  }

  // Spawn fresh
  await spawnSidecar();

  // Re-read state after spawn (spawnSidecar mutates it)
  const currentStatus = state.status as string;
  return {
    status: currentStatus === 'ready' ? ('ready' as const) : ('error' as const),
    port: state.port,
    error: state.error,
  };
}

/**
 * Get the current sidecar status without starting it.
 */
export function getSidecarStatus(): {
  status: string;
  port: number;
  error: string | null;
} {
  return {
    status: state.status,
    port: state.port,
    error: state.error,
  };
}

/**
 * Connect to a sidecar that's already running (including reconnecting to
 * one orphaned by a Node.js restart) WITHOUT spawning a new one. Use this
 * for read/cancel paths — booting a whole Python server as a side effect
 * of a status poll or a cancel click is never what the user meant.
 */
export async function connectSidecar(): Promise<{
  status: 'ready' | 'unavailable';
  port: number;
}> {
  if (state.status === 'ready') {
    if (await checkHealth()) {
      startHeartbeat();
      return { status: 'ready', port: state.port };
    }
    // Stale state — reset so the next ensureSidecar spawns fresh
    state.status = 'stopped';
    state.process = null;
  }

  if (await tryReconnect()) {
    return { status: 'ready', port: state.port };
  }

  return { status: 'unavailable', port: state.port };
}

/**
 * Shut down the sidecar and wait until its port is free. Kills both the process
 * we spawned and any orphan recorded in the PID file (which is all we have after
 * reconnecting across a Node restart). Unlike {@link restartSidecar}, it does
 * not re-spawn — the next action that needs the sidecar will start it on demand
 * via {@link ensureSidecar}.
 */
export async function shutdownSidecar(): Promise<{
  status: string;
  port: number;
  error: string | null;
}> {
  await killSidecarAndWait();
  return getSidecarStatus();
}

/**
 * Ask the running sidecar which job is active (best-effort). Returns the job
 * id, or null when idle or unreachable. Used to guard a restart against
 * nuking an in-flight training run.
 */
export async function getSidecarActiveJob(): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
    const res = await fetch(`http://127.0.0.1:${state.port}/health`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const data = (await res.json()) as { active_job?: string | null };
    return data.active_job ?? null;
  } catch {
    return null;
  }
}

/**
 * Host CPU / memory / GPU load from the sidecar, or null when it isn't
 * reachable. Never starts one — this backs a UI poll, and booting a Python
 * server as a side effect of drawing a stats readout is never what was meant.
 */
export async function getSidecarSystemStats(): Promise<unknown | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
    const res = await fetch(`http://127.0.0.1:${state.port}/system/stats`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Kill the running sidecar — both the process we spawned and any orphan
 * recorded in the PID file (which is what we have after reconnecting across a
 * Node restart) — then wait until its port is free so a fresh spawn can bind.
 */
async function killSidecarAndWait(): Promise<void> {
  // Stop pinging first: a heartbeat landing mid-kill tells the sidecar's
  // watchdog a client is still present, and after the kill it would just be
  // fetching a dead port every 30s.
  stopHeartbeat();

  if (state.process) {
    killProcessTree(state.process);
    state.process = null;
  }

  try {
    const pidPath = getPidPath();
    if (fs.existsSync(pidPath)) {
      const pid = parseInt(fs.readFileSync(pidPath, 'utf-8').trim(), 10);
      if (!Number.isNaN(pid) && isProcessAlive(pid)) {
        if (process.platform === 'win32') {
          spawnTaskkill(pid);
        } else {
          try {
            process.kill(pid, 'SIGTERM');
          } catch {
            // Already gone.
          }
        }
      }
      fs.unlinkSync(pidPath);
    }
  } catch {
    // Best-effort — a stale/unreadable PID file shouldn't block the restart.
  }

  state.status = 'stopped';

  // Poll until the old server stops answering (its port is released), so the
  // new uvicorn can bind. Bounded so a wedged process can't hang the restart.
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (!(await checkHealth())) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

/**
 * Restart the sidecar: kill the current process (freeing its port) and spawn a
 * fresh one. Used to pick up sidecar code changes during development. The
 * caller is responsible for guarding against restarting mid-job — see the
 * restart route's active-job check.
 */
export async function restartSidecar(): Promise<{
  status: 'ready' | 'error';
  port: number;
  error: string | null;
}> {
  await killSidecarAndWait();
  await spawnSidecar();

  const currentStatus = state.status as string;
  return {
    status: currentStatus === 'ready' ? ('ready' as const) : ('error' as const),
    port: state.port,
    error: state.error,
  };
}
