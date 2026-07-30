/**
 * Training runtime thunks: start, cancel, hydrate.
 *
 * Talks to `/api/training/*` and opens a direct WebSocket to the sidecar
 * on `ws/progress` to stream live progress into Redux.
 */

import type {
  TrainingJobConfig,
  TrainingJobStatus,
  TrainingProgress,
  TrainingProvider,
} from '@/app/services/training/types';
import { fetchJson } from '@/app/utils/fetch-json';

import type { AppThunk, RootState } from '../index';
import {
  addJob,
  openPanel,
  removeJob,
  restoreJobs,
  updateTrainingProgress,
} from '../jobs';
import type { TrainingJob } from '../jobs/types';
import { addToast } from '../toasts/reducers';
import type { FormState } from '../training-config/types';
import {
  dismissFromPanel,
  restoreHistory,
  type TrainingHistoryEntry,
} from '../training-history';

// WebSocket handlers need a dispatch function that accepts thunks + actions.
// Inside a thunk, `dispatch` is typed with an `unknown` extra-arg slot while
// the exported AppDispatch resolves with `undefined`, so the two aren't
// assignment-compatible. Accept a loose dispatch here — we only use it to
// forward known action creators.
type ThunkDispatch = (action: unknown) => unknown;

// ---------------------------------------------------------------------------
// Sidecar progress payload (snake_case — matches training-sidecar/models.py)
// ---------------------------------------------------------------------------

type SidecarJobStatus =
  'pending' | 'preparing' | 'training' | 'completed' | 'failed' | 'cancelled';

type SidecarJobProgress = {
  job_id: string;
  status: SidecarJobStatus;
  current_step?: number;
  total_steps?: number;
  current_epoch?: number;
  total_epochs?: number;
  loss?: number | null;
  loss_history?: { step: number; loss: number }[];
  speed_history?: { step: number; sec_per_it: number }[];
  prep_speed_history?: { step: number; sec_per_it: number }[];
  learning_rate?: number | null;
  eta_seconds?: number | null;
  samples?: Array<{
    path: string;
    step: number;
    epoch: number | null;
    prompt_index: number;
    source_path?: string | null;
  }>;
  checkpoint_steps?: number[];
  sample_steps?: number[];
  saved_checkpoints?: number[];
  log_lines?: string[];
  error?: string | null;
  phase?: string | null;
  speed?: string | null;
  sample_progress?: { current: number; total: number } | null;
  training_seconds?: number;
};

// ---------------------------------------------------------------------------
// WebSocket singleton
// ---------------------------------------------------------------------------
//
// One socket per sidecar, shared by all training jobs — the sidecar now
// queues multiple training jobs and broadcasts progress for whichever is
// active. We route each inbound message to its `msg.job_id` rather than
// filtering to a single tracked job, so a just-completed job can still
// receive its terminal event while a freshly-dequeued job starts streaming.

type ThunkGetState = () => RootState;

type WsState = {
  socket: WebSocket | null;
  /** Port we connected to — used to detect when a reconnect needs a fresh URL. */
  port: number | null;
  /**
   * Store handles captured from the thunk that first opened the socket.
   * Reconnects fire from a timer, outside any thunk, so they have no dispatch
   * of their own.
   */
  dispatch: ThunkDispatch | null;
  getState: ThunkGetState | null;
  /** Consecutive drops since the last successful open — indexes the backoff. */
  reconnectAttempts: number;
  reconnectTimer: number | null;
  /** Per-job checkpoint step positions, keyed by job_id. */
  checkpointStepsByJob: Map<string, number[]>;
  /** Per-job predicted sample-generation step positions, keyed by job_id. */
  sampleStepsByJob: Map<string, number[]>;
  /** Per-job "seen locally at" timestamp, keyed by job_id. */
  startedAtByJob: Map<string, number>;
};

const ws: WsState = {
  socket: null,
  port: null,
  dispatch: null,
  getState: null,
  reconnectAttempts: 0,
  reconnectTimer: null,
  checkpointStepsByJob: new Map(),
  sampleStepsByJob: new Map(),
  startedAtByJob: new Map(),
};

/**
 * Backoff between reconnect attempts, indexed by consecutive-failure count and
 * held at the last value from then on. Starts fast because the common drop is
 * a sidecar restart that's already back, and settles at 30s so a sidecar that's
 * genuinely gone isn't hammered for the life of a multi-hour run.
 */
const RECONNECT_DELAYS_MS = [500, 1000, 2000, 5000, 10_000, 30_000];

/**
 * Drop a job's WS-router metadata. Called when a job is cleared from the
 * panel — the maps are keyed by job id and would otherwise grow for the life
 * of the page.
 */
function forgetJob(jobId: string) {
  ws.checkpointStepsByJob.delete(jobId);
  ws.sampleStepsByJob.delete(jobId);
  ws.startedAtByJob.delete(jobId);
}

function closeSocket() {
  if (ws.reconnectTimer !== null) {
    window.clearTimeout(ws.reconnectTimer);
    ws.reconnectTimer = null;
  }
  if (ws.socket) {
    try {
      ws.socket.close();
    } catch {
      // Ignore close errors — we're tearing down anyway.
    }
  }
  // Nulling this first is what tells the socket's own `close` handler that the
  // teardown was ours, so it doesn't schedule a reconnect (it compares
  // identity against `ws.socket`).
  ws.socket = null;
  ws.port = null;
  ws.reconnectAttempts = 0;
}

/**
 * Is there a training job we still expect to hear about? Reconnects are gated
 * on this: chasing a sidecar forever when every run has finished is pure noise,
 * and the sidecar shuts *itself* down once Node stops heartbeating and the
 * queue is empty — so a closed socket with nothing live is the normal end
 * state, not a fault.
 *
 * Deliberately generous about what counts as live. A job stuck at `pending`
 * locally may well have started (or finished) while the stream was down —
 * missing exactly those transitions is what a drop looks like — so it keeps
 * the retry alive until a resync says otherwise.
 */
function hasLiveTrainingJob(getState: ThunkGetState): boolean {
  return Object.values(getState().jobs.jobs).some(
    (job) =>
      job.type === 'training' &&
      (job.status === 'pending' ||
        job.status === 'preparing' ||
        job.status === 'running'),
  );
}

/** Message text for a toast — bare, without the `Error:` class prefix. */
function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function mapStatus(s: SidecarJobStatus): TrainingJobStatus {
  // Types are identical but keep the indirection explicit in case they
  // drift in future.
  return s;
}

function buildProgress(
  jobId: string,
  msg: SidecarJobProgress,
): TrainingProgress {
  const currentStep = msg.current_step ?? 0;
  // Prefer sidecar-computed predictions (persisted with the job, so they
  // survive page refresh); fall back to the locally-derived map for older
  // sidecar payloads. Full predicted list — consumers decide how to render
  // upcoming vs reached positions.
  const checkpointSteps =
    msg.checkpoint_steps ?? ws.checkpointStepsByJob.get(jobId) ?? [];
  const sampleSteps = msg.sample_steps ?? ws.sampleStepsByJob.get(jobId) ?? [];
  const status = mapStatus(msg.status);
  const terminal =
    status === 'completed' || status === 'failed' || status === 'cancelled';

  return {
    jobId,
    status,
    startedAt: ws.startedAtByJob.get(jobId) ?? Date.now(),
    completedAt: terminal ? Date.now() : null,
    currentStep,
    totalSteps: msg.total_steps ?? 0,
    currentEpoch: msg.current_epoch ?? 0,
    totalEpochs: msg.total_epochs ?? 0,
    loss: msg.loss ?? null,
    lossHistory: msg.loss_history ?? [],
    speedHistory: (msg.speed_history ?? []).map((p) => ({
      step: p.step,
      secPerIt: p.sec_per_it,
    })),
    prepSpeedHistory: (msg.prep_speed_history ?? []).map((p) => ({
      step: p.step,
      secPerIt: p.sec_per_it,
    })),
    learningRate: msg.learning_rate ?? null,
    etaSeconds: msg.eta_seconds ?? null,
    samples: (msg.samples ?? []).map((s) => ({
      path: s.path,
      step: s.step,
      epoch: s.epoch,
      promptIndex: s.prompt_index,
      sourcePath: s.source_path ?? null,
    })),
    checkpointSteps,
    sampleSteps,
    savedCheckpoints: msg.saved_checkpoints ?? [],
    logLines: msg.log_lines ?? [],
    error: msg.error ?? null,
    phase: msg.phase ?? null,
    speed: msg.speed ?? null,
    // Absent on every tick but the sampler's own bar — the omission is what
    // clears the in-flight cell's bar when generation ends.
    sampleProgress: msg.sample_progress ?? null,
    trainingSeconds: msg.training_seconds ?? 0,
  };
}

/**
 * The sidecar's own record of one training job (snake_case, as it stores it).
 *
 * This is the durable record — `<training>/jobs/<job_id>.json` — and the source
 * of truth for every run the client shows. `project` and `form_snapshot` are
 * client-owned fields the sidecar stores verbatim, which is what makes a run
 * fully reconstructable from disk alone.
 */
type SidecarJobEntry = {
  job_id: string;
  status: SidecarJobStatus;
  config?: Record<string, unknown>;
  progress?: SidecarJobProgress;
  started_at?: string;
  completed_at?: string | null;
  project?: { id?: string; name: string; version: number } | null;
  form_snapshot?: FormState | null;
  /** The client's own config summary, stored verbatim at launch. */
  client_config?: TrainingJobConfig | null;
  /** Cleared from the activity panel; still present in run history. */
  dismissed?: boolean;
};

/**
 * `/api/training/jobs` answer. Note the route reports "couldn't reach the
 * sidecar" as a 200 with an empty list plus `sidecar_status`/`error`, so an
 * empty `jobs` alone does NOT mean there are no runs.
 */
type SidecarJobsResponse = {
  jobs?: SidecarJobEntry[];
  sidecar_status?: string;
  error?: string;
};

/**
 * The sidecar's own record of every training job, or `null` when it couldn't be
 * asked.
 *
 * Callers have to tell those apart: "no runs" and "runs we failed to read" want
 * opposite handling — one is an answer, the other is a retry.
 */
async function fetchSidecarJobs(): Promise<SidecarJobEntry[] | null> {
  try {
    const data = await fetchJson<SidecarJobsResponse>('/api/training/jobs');
    if (data.sidecar_status || data.error) return null;
    return data.jobs ?? [];
  } catch (err) {
    // Logged here because this is the only place the underlying error exists;
    // callers add what the failure costs them.
    console.warn('[training] Could not read the sidecar job list', err);
    return null;
  }
}

/**
 * Rebuild a training job the client has no record of from the sidecar's own
 * view of it, and add it to the store.
 *
 * Shared by the mount-time hydrate and the post-reconnect resync: both
 * discover runs this page has never seen — one started in another tab, or one
 * that began while the progress stream was down — and both have only the
 * sidecar's persisted request dump to reconstruct from, so the result is a
 * minimal skeleton carrying just the fields the job card renders.
 *
 * Never seeds a run the user has dismissed. `/jobs` lists dismissed runs — run
 * history still shows them — so without this guard a reconnect would put every
 * cleared card straight back into the activity panel.
 *
 * Also no-ops for a terminal run already in Run History, which is the fuller
 * record: re-seeding would have it re-recorded over that snapshot.
 */
function seedJobFromSidecar(
  dispatch: ThunkDispatch,
  getState: ThunkGetState,
  entry: SidecarJobEntry,
) {
  if (entry.dismissed) return;

  const seededAt = entry.started_at ? Date.parse(entry.started_at) : Date.now();
  ws.startedAtByJob.set(entry.job_id, seededAt);

  const isTerminal =
    entry.status === 'completed' ||
    entry.status === 'failed' ||
    entry.status === 'cancelled';
  if (isTerminal && getState().trainingHistory.entries[entry.job_id]) return;

  dispatch(addJob(trainingJobFromSidecar(entry)));
}

/**
 * Build a `TrainingJob` from the sidecar's stored record of it.
 *
 * The sidecar's record is the source of truth for every run, so this is the one
 * translation from its shape into the client's — used both to seed a job the
 * page has never seen and to rebuild the whole run history on load.
 *
 * Prefers the client's own config summary, stored on the record at launch, so a
 * run redisplays exactly as it did live. Records predating that field fall back
 * to rebuilding the config from the persisted launch request, which is lossy —
 * no datasets, a single resolution, no expert settings.
 *
 * The project the run belongs to and the launch form are likewise carried on
 * the record rather than derived, precisely so they survive this trip.
 */
function trainingJobFromSidecar(entry: SidecarJobEntry): TrainingJob {
  const seededAt = entry.started_at ? Date.parse(entry.started_at) : Date.now();
  const completedAt = entry.completed_at ? Date.parse(entry.completed_at) : null;

  // `buildProgress` dates a terminal tick to now, which is right for a live
  // stream and wrong for a record read back off disk — a run that finished last
  // week would report as having just ended, and the detail view's duration is
  // the gap between these two. Restamp both from the record.
  const progress = entry.progress
    ? {
        ...buildProgress(entry.job_id, entry.progress),
        startedAt: seededAt,
        completedAt,
      }
    : null;

  // Sidecar config is snake_case — pick out the fields used for rendering.
  const cfg = entry.config ?? {};
  const hp = (cfg.hyperparameters as Record<string, unknown>) ?? {};
  const provider =
    (cfg.provider as TrainingProvider) ??
    (cfg.provider_type as TrainingProvider) ??
    'ai-toolkit';

  return {
    id: entry.job_id,
    type: 'training',
    status:
      entry.status === 'training' || entry.status === 'preparing'
        ? 'running'
        : entry.status,
    createdAt: seededAt,
    startedAt: seededAt,
    completedAt,
    error: entry.progress?.error ?? null,
    // Carried on the record rather than derived: the project is what the
    // project menu filters its run list on, and its absence is what used to
    // make recovered runs vanish from that menu.
    project: entry.project ?? undefined,
    formSnapshot: entry.form_snapshot ?? undefined,
    config: entry.client_config ?? {
      projectPath: (cfg.project_path as string) ?? '',
      provider,
      baseModel: (cfg.base_model as string) ?? '',
      modelPaths: {},
      outputPath: (cfg.output_path as string) ?? '',
      outputName: (cfg.output_name as string) ?? 'unnamed-lora',
      datasets: [],
      hyperparameters: {
        learningRate: (hp.lr as number) ?? 1e-4,
        epochs: (hp.epochs as number) ?? 0,
        batchSize: (hp.batch_size as number) ?? 1,
        resolution: 1024,
        networkDim: (hp.network_dim as number) ?? 16,
        networkAlpha: (hp.network_alpha as number) ?? 16,
        optimizer: (hp.optimizer as string) ?? 'adamw8bit',
        scheduler: (hp.scheduler as string) ?? 'constant',
        warmupSteps: (hp.warmup_steps as number) ?? 0,
        saveEveryNEpochs: 1,
        sampleEveryNSteps: 250,
        gradientAccumulationSteps: 1,
        mixedPrecision: 'bf16',
        extra: {
          numRestarts: (hp.num_restarts as number) ?? 1,
          maxSavesToKeep: (hp.max_saves_to_keep as number) ?? 0,
        },
      },
      // The persisted request carries the prompts — they drive the samples
      // grid's column headers after a refresh.
      samplePrompts: (cfg.sample_prompts as string[]) ?? [],
    },
    progress,
  };
}

/**
 * Pull the sidecar's own view of every training job and fold it back in.
 *
 * The progress socket is a pure delta stream — it only carries what changed
 * while someone was listening — so a drop silently strands whatever moved
 * during the gap: a run that finished, the queued job that took its place.
 * Reconciling against `/api/training/jobs` (the whole queue, not just the
 * sidecar's single "focus" job) is what makes a reconnect actually recover.
 *
 * Best-effort — a failure leaves the stale state in place and the next live
 * tick corrects whatever is still running.
 */
async function resyncJobs(dispatch: ThunkDispatch, getState: ThunkGetState) {
  const entries = await fetchSidecarJobs();
  if (!entries) {
    console.warn(
      '[training-ws] Resync failed — job state may be stale until the next tick',
    );
    return;
  }

  for (const entry of entries) {
    if (!entry.job_id) continue;
    const existing = getState().jobs.jobs[entry.job_id];
    if (!existing) {
      // A run this page has never seen (started in another tab, or begun
      // while we were disconnected) — rebuild it from the sidecar's record.
      seedJobFromSidecar(dispatch, getState, entry);
      continue;
    }
    // Already finished locally: the sidecar has nothing left to tell us, and
    // re-applying its progress would stamp a fresh `completedAt` (buildProgress
    // dates terminal ticks to now), defeating the history middleware's
    // idempotency guard and re-archiving the run on every reconnect.
    if (
      existing.status === 'completed' ||
      existing.status === 'failed' ||
      existing.status === 'cancelled' ||
      existing.status === 'interrupted'
    ) {
      continue;
    }
    if (entry.progress) {
      // `buildProgress` dates a run from what this page happens to remember —
      // the local start stamp, and "now" for a terminal tick. Both are wrong for
      // a record read back off the queue: a run that finished during an
      // overnight disconnect would report as having just ended, inflating its
      // duration (and the history snapshot's) by the length of the gap. The
      // entry carries the real timings, so prefer them.
      if (entry.started_at && !ws.startedAtByJob.has(entry.job_id)) {
        ws.startedAtByJob.set(entry.job_id, Date.parse(entry.started_at));
      }
      const progress = buildProgress(entry.job_id, entry.progress);
      if (entry.completed_at) {
        progress.completedAt = Date.parse(entry.completed_at);
      }
      dispatch(updateTrainingProgress({ id: entry.job_id, progress }));
    }
  }
}

/**
 * Schedule a reconnect after a drop, unless there's nothing left to hear about
 * or an attempt is already pending. Each consecutive failure walks further
 * down `RECONNECT_DELAYS_MS`; a successful open resets the count.
 */
function scheduleReconnect() {
  if (ws.reconnectTimer !== null || ws.socket) return;

  const { dispatch, getState, port } = ws;
  if (!dispatch || !getState || port === null) return;

  if (!hasLiveTrainingJob(getState)) {
    ws.reconnectAttempts = 0;
    return;
  }

  const delay =
    RECONNECT_DELAYS_MS[
      Math.min(ws.reconnectAttempts, RECONNECT_DELAYS_MS.length - 1)
    ]!;
  ws.reconnectAttempts += 1;

  ws.reconnectTimer = window.setTimeout(() => {
    ws.reconnectTimer = null;
    openProgressSocket(dispatch, getState, port);
  }, delay);
}

function openProgressSocket(
  dispatch: ThunkDispatch,
  getState: ThunkGetState,
  port: number,
) {
  ws.port = port;

  const url = `ws://127.0.0.1:${port}/ws/progress`;
  const socket = new WebSocket(url);
  ws.socket = socket;

  socket.addEventListener('open', () => {
    if (ws.socket !== socket) return;
    ws.reconnectAttempts = 0;
    void resyncJobs(dispatch, getState);
  });

  socket.addEventListener('message', (event) => {
    try {
      const msg = JSON.parse(event.data as string) as SidecarJobProgress;
      // Route by msg.job_id — the sidecar can broadcast progress for any
      // of its queued/running training jobs on this single channel. A job
      // whose id we don't recognise is a no-op in the reducer.
      if (!msg.job_id) return;
      const progress = buildProgress(msg.job_id, msg);
      dispatch(updateTrainingProgress({ id: msg.job_id, progress }));
    } catch (err) {
      console.warn('[training-ws] Failed to parse message:', err);
    }
  });

  socket.addEventListener('close', () => {
    // A socket we already replaced (or tore down deliberately, which nulls
    // `ws.socket` first) — its close is not a drop.
    if (ws.socket !== socket) return;
    ws.socket = null;
    scheduleReconnect();
  });

  socket.addEventListener('error', () => {
    // Always followed by `close`, which owns the retry — nothing to do here
    // but say so, since a silent console is indistinguishable from a healthy
    // stream that simply has nothing to report.
    console.warn('[training-ws] Socket error — will retry if a run is live');
  });
}

function ensureProgressSocket(
  dispatch: ThunkDispatch,
  getState: ThunkGetState,
  port: number,
) {
  // Kept for reconnects, which fire from a timer with no thunk context.
  ws.dispatch = dispatch;
  ws.getState = getState;

  // If we already have a live socket on the same port, reuse it. Only
  // reopen when the port changed or the socket dropped.
  if (ws.socket && ws.port === port && ws.socket.readyState <= WebSocket.OPEN) {
    return;
  }

  closeSocket();
  openProgressSocket(dispatch, getState, port);
}

// ---------------------------------------------------------------------------
// Checkpoint step derivation (UI-only — sidecar doesn't report these)
// ---------------------------------------------------------------------------

/**
 * Step positions a repeating cadence lands on across a run. Saving and
 * sampling both express their cadence as "every N epochs" or "every N steps"
 * over the same timeline, so they share this: only the config keys and the
 * enablement rule differ.
 */
function deriveCadenceSteps({
  mode,
  everyEpochs,
  everySteps,
  totalSteps,
  epochs,
}: {
  mode: string;
  everyEpochs: number;
  everySteps: number;
  totalSteps: number;
  epochs: number;
}): number[] {
  const out: number[] = [];
  if (mode === 'epochs' && everyEpochs > 0 && epochs > 0) {
    const stepsPerEpoch = Math.max(1, Math.ceil(totalSteps / epochs));
    for (let e = everyEpochs; e <= epochs; e += everyEpochs) {
      out.push(Math.min(e * stepsPerEpoch, totalSteps));
    }
  } else if (mode === 'steps' && everySteps > 0) {
    for (let s = everySteps; s <= totalSteps; s += everySteps) {
      out.push(s);
    }
  }
  return out;
}

function deriveCheckpointSteps(config: Record<string, unknown>): number[] {
  if (!((config.saveEnabled as boolean) ?? false)) return [];

  return deriveCadenceSteps({
    mode: (config.saveMode as string) ?? 'epochs',
    everyEpochs: (config.saveEveryEpochs as number) ?? 1,
    everySteps: (config.saveEverySteps as number) ?? 100,
    totalSteps: (config.steps as number) || 0,
    epochs: (config.epochs as number) || 0,
  });
}

/**
 * Predicted sample-generation step positions from the form config — the
 * fallback twin of `deriveCheckpointSteps` for sidecar payloads predating
 * `sample_steps`. Gated on prompts because that's what actually enables
 * sampling in the providers.
 */
function deriveSampleSteps(config: Record<string, unknown>): number[] {
  const samplingEnabled = (config.samplingEnabled as boolean) ?? false;
  const prompts = ((config.samplePrompts as string[]) ?? []).filter((p) =>
    p.trim(),
  );
  if (!samplingEnabled || prompts.length === 0) return [];

  return deriveCadenceSteps({
    mode: (config.sampleMode as string) ?? 'steps',
    everyEpochs: (config.sampleEveryEpochs as number) ?? 1,
    everySteps: (config.sampleEverySteps as number) ?? 250,
    totalSteps: (config.steps as number) || 0,
    epochs: (config.epochs as number) || 0,
  });
}

// ---------------------------------------------------------------------------
// Config snapshot for the Redux TrainingJob
// ---------------------------------------------------------------------------

function snapshotClientConfig(
  config: Record<string, unknown>,
): TrainingJobConfig {
  return {
    projectPath: '',
    provider: (config.provider as TrainingProvider) ?? 'ai-toolkit',
    baseModel: (config.modelId as string) ?? '',
    modelPaths: (config.modelPaths as Record<string, string>) ?? {},
    outputPath: '',
    outputName: (config.outputName as string) ?? 'unnamed-lora',
    datasets: [],
    hyperparameters: {
      learningRate: (config.learningRate as number) ?? 1e-4,
      epochs: (config.epochs as number) ?? 20,
      batchSize: (config.batchSize as number) ?? 1,
      resolution: Array.isArray(config.resolution)
        ? ((config.resolution as number[])[0] ?? 1024)
        : ((config.resolution as number) ?? 1024),
      networkDim: (config.networkDim as number) ?? 16,
      networkAlpha: (config.networkAlpha as number) ?? 16,
      optimizer: (config.optimizer as string) ?? 'adamw8bit',
      scheduler: (config.scheduler as string) ?? 'constant',
      warmupSteps: (config.warmupSteps as number) ?? 0,
      saveEveryNEpochs: (config.saveEveryEpochs as number) ?? 1,
      sampleEveryNSteps: (config.sampleEverySteps as number) ?? 250,
      gradientAccumulationSteps:
        (config.gradientAccumulationSteps as number) ?? 1,
      mixedPrecision: (config.mixedPrecision as 'bf16' | 'fp16') ?? 'bf16',
      extra: {
        numRestarts: (config.numRestarts as number) ?? 1,
        maxSavesToKeep: (config.maxSavesToKeep as number) ?? 0,
      },
    },
    samplePrompts: (config.samplePrompts as string[]) ?? [],
  };
}

/**
 * Has run history been read from a sidecar that actually answered? Mount-time
 * hydration commonly runs against a sidecar that isn't up (it only spawns on
 * demand), so this is what lets a later "the sidecar is up now" moment know the
 * archive is still unread. Session-scoped — a reload starts over.
 */
let historyHydrated = false;

// ---------------------------------------------------------------------------
// startTraining — replaces the old mock thunk.
// ---------------------------------------------------------------------------

export function startTraining(
  config: Record<string, unknown>,
  formSnapshot?: FormState,
): AppThunk {
  return async (dispatch, getState) => {
    // Snapshot the loaded project up front, before any await: the user can
    // load or clear a project while the sidecar handshake is in flight, and
    // the run belongs to whatever was loaded when they pressed start.
    const loadedProject = getState().trainingConfig.loadedProject;
    // Built once and used twice: it's both what this session's job card renders
    // and what the sidecar stores, so a reloaded run redisplays identically.
    const clientConfig = snapshotClientConfig(config);

    // No client-side GPU-busy gate — the sidecar owns a shared queue
    // across training + tagging, so additional jobs enqueue behind whatever
    // is currently running rather than being rejected.

    // Ensure the sidecar is running before we POST /api/training/start.
    // The route answers 503 when the spawn failed, so a non-ready sidecar
    // arrives here as a throw carrying the sidecar's own error text.
    let sidecarPort = 9733;
    try {
      const data = await fetchJson<{ port: number }>('/api/training/sidecar', {
        method: 'POST',
      });
      sidecarPort = data.port;
    } catch (err) {
      dispatch(
        addToast({
          variant: 'error',
          children: `Could not start the training sidecar: ${errorText(err)}`,
        }),
      );
      return;
    }

    // The handshake above is the app's one dependable "the sidecar is up now"
    // signal, and starting a run is what spawns it. If the page loaded with the
    // sidecar down, run history is still empty and unread — read it now rather
    // than leaving the panel and Run History blank until the next reload.
    if (!historyHydrated) void dispatch(hydrateTrainingHistory());

    // POST /api/training/start — server translates to sidecar shape.
    let jobId: string;
    try {
      const data = await fetchJson<{
        job_id?: string;
        sidecar_port?: number;
      }>('/api/training/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // The project and the launch form ride along with the config so the
        // sidecar can store them on the run's record. They're what lets a run
        // recovered from disk rejoin the project menu's list and reload its
        // settings — neither is derivable from the config alone.
        body: JSON.stringify({
          ...config,
          project: loadedProject
            ? {
                id: loadedProject.id,
                name: loadedProject.name,
                version: loadedProject.version,
              }
            : undefined,
          formSnapshot,
          clientConfig,
        }),
      });
      if (!data.job_id) {
        dispatch(
          addToast({
            variant: 'error',
            children: 'Training failed to start: no job id returned',
          }),
        );
        return;
      }
      jobId = data.job_id;
      if (data.sidecar_port) sidecarPort = data.sidecar_port;
    } catch (err) {
      dispatch(
        addToast({
          variant: 'error',
          children: `Failed to start training: ${errorText(err)}`,
        }),
      );
      return;
    }

    // Stash per-job metadata used by the WS progress router.
    ws.checkpointStepsByJob.set(jobId, deriveCheckpointSteps(config));
    ws.sampleStepsByJob.set(jobId, deriveSampleSteps(config));
    ws.startedAtByJob.set(jobId, Date.now());

    const job: TrainingJob = {
      id: jobId,
      type: 'training',
      status: 'pending',
      createdAt: Date.now(),
      startedAt: null,
      completedAt: null,
      error: null,
      config: clientConfig,
      progress: null,
      project: loadedProject
        ? {
            id: loadedProject.id,
            name: loadedProject.name,
            version: loadedProject.version,
          }
        : undefined,
      formSnapshot,
    };
    dispatch(addJob(job));
    dispatch(openPanel());

    ensureProgressSocket(dispatch, getState, sidecarPort);
  };
}

// ---------------------------------------------------------------------------
// Dismissal delivery
// ---------------------------------------------------------------------------

/** Gap before the single dismiss retry — long enough for a sidecar handshake. */
const DISMISS_RETRY_DELAY_MS = 1500;

/** One attempt at the dismiss call. `false` means it did not land. */
async function postDismiss(jobId?: string): Promise<boolean> {
  const query = jobId ? `?job_id=${encodeURIComponent(jobId)}` : '';
  try {
    const res = await fetch(`/api/training/clear${query}`, { method: 'POST' });
    if (!res.ok) return false;
    const data = (await res.json().catch(() => null)) as {
      status?: string;
    } | null;
    // The route answers 200 `unreachable` when there's no sidecar to tell —
    // shaped like a success, but nothing was recorded.
    return data?.status !== 'unreachable';
  } catch {
    return false;
  }
}

/**
 * Tell the sidecar a terminal run (every one of them, with no id) has been
 * cleared from the activity panel.
 *
 * The dismissed flag on the durable record is the only thing keeping a cleared
 * card out of the panel after a reload, so a call that quietly fails is a card
 * that comes back from the dead. Retried once — the realistic failure is a
 * sidecar mid-restart — and then warned about rather than queued: this is a
 * single-user local app, and the honest outcome of a lost dismiss is the card
 * reappearing on the next reload.
 */
export async function dismissTrainingJobs(jobId?: string): Promise<void> {
  if (await postDismiss(jobId)) return;
  await new Promise((resolve) => setTimeout(resolve, DISMISS_RETRY_DELAY_MS));
  if (await postDismiss(jobId)) return;
  console.warn(
    '[training] Could not tell the sidecar the run was cleared — ' +
      `the card may reappear after a reload (${jobId ?? 'all terminal runs'}).`,
  );
}

// ---------------------------------------------------------------------------
// cancelTraining
// ---------------------------------------------------------------------------

export function cancelTraining(jobId: string): AppThunk {
  return async (dispatch) => {
    try {
      // Cancel this job specifically. The sidecar falls back to its "focus"
      // job (running one, else oldest queued) when no id is given, which
      // cancels the wrong run as soon as more than one is queued.
      await fetch(`/api/training/cancel?job_id=${encodeURIComponent(jobId)}`, {
        method: 'POST',
      });
    } catch (err) {
      console.warn('[training] cancel failed:', err);
    }
    // The sidecar will broadcast a final 'cancelled' progress event, which
    // updates job state. If the WS is dead, remove the job optimistically —
    // and dismiss it sidecar-side too, exactly as clearing a card does: the
    // cancel leaves a terminal record with `dismissed: false`, which the next
    // hydrate would otherwise seed straight back into the panel.
    if (!ws.socket) {
      dispatch(removeJob(jobId));
      forgetJob(jobId);
      void dismissTrainingJobs(jobId);
    }
  };
}

// ---------------------------------------------------------------------------
// clearTrainingJob — remove a terminal job locally AND tell the sidecar to
// drop it from `active_job` so it doesn't reappear on the next hydrate.
// ---------------------------------------------------------------------------

export function clearTrainingJob(jobId: string): AppThunk {
  return async (dispatch) => {
    dispatch(removeJob(jobId));
    forgetJob(jobId);
    // Terminal runs live in the durable history archive, which the activity
    // panel re-seeds from on refresh. Mark this one dismissed so it stays out
    // of the panel (it remains in the Run History view).
    dispatch(dismissFromPanel(jobId));
    // Scoped to this job — omitting the id clears every terminal job the
    // sidecar is holding, taking unrelated finished runs with it.
    await dismissTrainingJobs(jobId);
  };
}

// ---------------------------------------------------------------------------
// hydrateActiveTraining — recover an in-flight job after page refresh.
// ---------------------------------------------------------------------------

/**
 * Delays between hydrate attempts. Hydrate fires once, on app mount, against a
 * server that may still be warming up — a dev server compiling these routes for
 * the first time, or a sidecar mid-handshake. A single attempt that gives up
 * permanently leaves the activity panel empty for the life of the page even
 * though the run is perfectly healthy, so failures are retried a few times
 * before we accept them.
 */
const HYDRATE_RETRY_DELAYS_MS = [500, 2000, 5000];

/**
 * `/api/training/status` answer: the sidecar's whole record for its focus job
 * — the same `JobState` dump `/jobs` lists each entry as — with an `active`
 * flag in front of it.
 */
type ActiveJobResponse = Partial<SidecarJobEntry> & { active: boolean };

export function hydrateActiveTraining(): AppThunk {
  return async (dispatch, getState) => {
    // If we already have a socket open, nothing to do.
    if (ws.socket && ws.socket.readyState <= WebSocket.OPEN) return;

    let active: SidecarJobEntry | null = null;
    let sidecarPort = 9733;

    for (let attempt = 0; ; attempt++) {
      try {
        const [statusData, sidecarData] = await Promise.all([
          fetchJson<ActiveJobResponse>('/api/training/status'),
          fetchJson<{ port?: number }>('/api/training/sidecar'),
        ]);
        if (sidecarData.port) sidecarPort = sidecarData.port;

        if (statusData.active && statusData.job_id && statusData.status) {
          // Keep the record whole rather than copying a handful of fields out
          // of it: `project`, `form_snapshot`, `client_config` and
          // `completed_at` are all on this payload, and a run rebuilt without
          // them is a skeleton that history hydration then refuses to overwrite
          // (`restoreHistory` only fills gaps) — so the degraded copy would
          // stick for the session, missing from the project menu's run list and
          // unable to reload its form.
          active = statusData as SidecarJobEntry;
        }
        break;
      } catch (err) {
        const delay = HYDRATE_RETRY_DELAYS_MS[attempt];
        if (delay === undefined) {
          console.warn(
            `[training] hydrate failed after ${HYDRATE_RETRY_DELAYS_MS.length + 1} attempts — ` +
              'an in-flight run will not show in the activity panel until reload.',
            err,
          );
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    // A socket may have opened while we were retrying — a start dispatched
    // from the same mount already owns the stream.
    if (ws.socket && ws.socket.readyState <= WebSocket.OPEN) return;

    if (!active) return;

    // Don't re-seed if this job is already in Redux — the middleware may
    // have persisted it, in which case we only need to reattach the WS.
    const existing = getState().jobs.jobs[active.job_id];
    if (existing) {
      ws.startedAtByJob.set(
        active.job_id,
        existing.startedAt ??
          (active.started_at ? Date.parse(active.started_at) : Date.now()),
      );
    } else {
      seedJobFromSidecar(dispatch, getState, active);
    }

    // Only attach a WS if the job is still in-flight. `pending` counts: the
    // sidecar's focus job is only queued when nothing is running, and a socket
    // attached now is what shows it starting rather than leaving the panel
    // frozen on "queued" until the next reload.
    if (
      active.status === 'training' ||
      active.status === 'preparing' ||
      active.status === 'pending'
    ) {
      ensureProgressSocket(dispatch, getState, sidecarPort);
      // Surface the activity panel so the refresh doesn't silently drop it.
      dispatch(openPanel());
    }
  };
}

// ---------------------------------------------------------------------------
// hydrateTrainingHistory — rebuild past runs from the sidecar's records.
// ---------------------------------------------------------------------------

/** Terminal statuses as the sidecar reports them. */
function isTerminalEntry(entry: SidecarJobEntry): boolean {
  return (
    entry.status === 'completed' ||
    entry.status === 'failed' ||
    entry.status === 'cancelled'
  );
}

/**
 * Load every finished run the sidecar has on record into the history archive
 * and the activity panel.
 *
 * The sidecar's `<training>/jobs/*.json` files are the single source of truth
 * for run history. This used to be a localStorage archive, which drifted from
 * disk in both directions — runs survived in the browser after their files were
 * deleted, and vanished when the browser store was cleared or a different
 * browser was used, despite every run's samples and outputs still sitting on
 * disk. Reading the runs back from the sidecar removes the second copy that
 * drift needs.
 *
 * `dismissed` on the record is what keeps a run out of the activity panel while
 * leaving it in run history, so a card the user cleared stays cleared across
 * reloads without the run being lost.
 *
 * Resolves to whether the sidecar actually answered, which is the whole
 * difference between "there is no history" and "we couldn't read the history":
 * the sidecar only spawns on demand and idle-exits, so a cold start reads an
 * empty list from a sidecar that isn't there, and a caller that latched on that
 * would show an empty Run History for the life of the page. Callers retry on
 * `false` — the panel unlatches its once-per-mount guard, `startTraining`
 * re-fires once the sidecar is up, and opening Run History re-reads.
 *
 * Idempotent, so all of those are free to overlap: nothing is written back to
 * the sidecar, and both `restoreHistory` and `restoreJobs` only fill gaps —
 * a run already known from this session keeps its live, fuller snapshot.
 */
export function hydrateTrainingHistory(): AppThunk<Promise<boolean>> {
  return async (dispatch) => {
    for (let attempt = 0; ; attempt++) {
      const entries = await fetchSidecarJobs();

      if (entries) {
        const archived: TrainingHistoryEntry[] = entries
          .filter(isTerminalEntry)
          .map((entry) => ({
            ...trainingJobFromSidecar(entry),
            dismissedFromPanel: entry.dismissed ?? false,
          }));
        if (archived.length > 0) {
          // History first: recording a run that finishes this session reads the
          // archive to decide whether it's already known, so it must be
          // populated before any terminal transition can fire.
          dispatch(restoreHistory(archived));
          // The panel shows the ones the user hasn't cleared. `restoreJobs`
          // merges without overwriting, so a live job already in the store is
          // left alone.
          dispatch(
            restoreJobs(archived.filter((entry) => !entry.dismissedFromPanel)),
          );
        }
        historyHydrated = true;
        return true;
      }

      const delay = HYDRATE_RETRY_DELAYS_MS[attempt];
      if (delay === undefined) {
        console.warn(
          '[training] Could not load run history from the sidecar — ' +
            'past runs will appear once it is reachable.',
        );
        return false;
      }
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  };
}
