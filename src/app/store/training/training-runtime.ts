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

import type { AppThunk, RootState } from '../index';

// WebSocket handlers need a dispatch function that accepts thunks + actions.
// Inside a thunk, `dispatch` is typed with an `unknown` extra-arg slot while
// the exported AppDispatch resolves with `undefined`, so the two aren't
// assignment-compatible. Accept a loose dispatch here — we only use it to
// forward known action creators.
type ThunkDispatch = (action: unknown) => unknown;
import { addJob, openPanel, removeJob, updateTrainingProgress } from '../jobs';
import type { TrainingJob } from '../jobs/types';
import { addToast } from '../toasts/reducers';
import type { FormState } from '../training-config/types';
import { dismissFromPanel } from '../training-history';

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
  sample_image_paths?: string[];
  checkpoint_steps?: number[];
  saved_checkpoints?: number[];
  log_lines?: string[];
  error?: string | null;
  phase?: string | null;
  speed?: string | null;
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

type WsState = {
  socket: WebSocket | null;
  /** Port we connected to — used to detect when a reconnect needs a fresh URL. */
  port: number | null;
  /** Per-job checkpoint step positions, keyed by job_id. */
  checkpointStepsByJob: Map<string, number[]>;
  /** Per-job "seen locally at" timestamp, keyed by job_id. */
  startedAtByJob: Map<string, number>;
};

const ws: WsState = {
  socket: null,
  port: null,
  checkpointStepsByJob: new Map(),
  startedAtByJob: new Map(),
};

function closeSocket() {
  if (ws.socket) {
    try {
      ws.socket.close();
    } catch {
      // Ignore close errors — we're tearing down anyway.
    }
  }
  ws.socket = null;
  ws.port = null;
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
    sampleImagePaths: msg.sample_image_paths ?? [],
    checkpointSteps,
    savedCheckpoints: msg.saved_checkpoints ?? [],
    logLines: msg.log_lines ?? [],
    error: msg.error ?? null,
    phase: msg.phase ?? null,
    speed: msg.speed ?? null,
    trainingSeconds: msg.training_seconds ?? 0,
  };
}

function ensureProgressSocket(dispatch: ThunkDispatch, port: number) {
  // If we already have a live socket on the same port, reuse it. Only
  // reopen when the port changed or the socket dropped.
  if (ws.socket && ws.port === port && ws.socket.readyState <= WebSocket.OPEN) {
    return;
  }

  closeSocket();
  ws.port = port;

  const url = `ws://127.0.0.1:${port}/ws/progress`;
  const socket = new WebSocket(url);
  ws.socket = socket;

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
    if (ws.socket === socket) {
      ws.socket = null;
    }
  });

  socket.addEventListener('error', () => {
    // Error handling: the sidecar may restart; we'll leave the job in its
    // current Redux state and let the next hydrate call recover.
    console.warn('[training-ws] Socket error — progress streaming stopped');
  });
}

// ---------------------------------------------------------------------------
// Checkpoint step derivation (UI-only — sidecar doesn't report these)
// ---------------------------------------------------------------------------

function deriveCheckpointSteps(config: Record<string, unknown>): number[] {
  const saveEnabled = (config.saveEnabled as boolean) ?? false;
  if (!saveEnabled) return [];

  const totalSteps = (config.steps as number) || 0;
  const epochs = (config.epochs as number) || 0;
  const saveMode = (config.saveMode as string) ?? 'epochs';
  const saveEveryEpochs = (config.saveEveryEpochs as number) ?? 1;
  const saveEverySteps = (config.saveEverySteps as number) ?? 100;

  const out: number[] = [];
  if (saveMode === 'epochs' && saveEveryEpochs > 0 && epochs > 0) {
    const stepsPerEpoch = Math.max(1, Math.ceil(totalSteps / epochs));
    for (let e = saveEveryEpochs; e <= epochs; e += saveEveryEpochs) {
      out.push(Math.min(e * stepsPerEpoch, totalSteps));
    }
  } else if (saveMode === 'steps' && saveEverySteps > 0) {
    for (let s = saveEverySteps; s <= totalSteps; s += saveEverySteps) {
      out.push(s);
    }
  }
  return out;
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

// ---------------------------------------------------------------------------
// startTraining — replaces the old mock thunk.
// ---------------------------------------------------------------------------

export function startTraining(
  config: Record<string, unknown>,
  formSnapshot?: FormState,
): AppThunk {
  return async (dispatch) => {
    // No client-side GPU-busy gate — the sidecar owns a shared queue
    // across training + tagging, so additional jobs enqueue behind whatever
    // is currently running rather than being rejected.

    // Ensure the sidecar is running before we POST /api/training/start.
    let sidecarPort = 9733;
    try {
      const res = await fetch('/api/training/sidecar', { method: 'POST' });
      const data = (await res.json()) as {
        status: string;
        port: number;
        error: string | null;
      };
      if (data.status !== 'ready') {
        dispatch(
          addToast({
            variant: 'error',
            children: `Training sidecar failed to start: ${data.error ?? 'unknown error'}`,
          }),
        );
        return;
      }
      sidecarPort = data.port;
    } catch (err) {
      dispatch(
        addToast({
          variant: 'error',
          children: `Could not reach training sidecar: ${err}`,
        }),
      );
      return;
    }

    // POST /api/training/start — server translates to sidecar shape.
    let jobId: string;
    try {
      const res = await fetch('/api/training/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      const data = (await res.json()) as {
        job_id?: string;
        error?: string;
        sidecar_port?: number;
      };
      if (!res.ok || !data.job_id) {
        dispatch(
          addToast({
            variant: 'error',
            children: `Training failed to start: ${data.error ?? 'unknown error'}`,
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
          children: `Failed to start training: ${err}`,
        }),
      );
      return;
    }

    // Stash per-job metadata used by the WS progress router.
    ws.checkpointStepsByJob.set(jobId, deriveCheckpointSteps(config));
    ws.startedAtByJob.set(jobId, Date.now());

    const job: TrainingJob = {
      id: jobId,
      type: 'training',
      status: 'pending',
      createdAt: Date.now(),
      startedAt: null,
      completedAt: null,
      error: null,
      config: snapshotClientConfig(config),
      progress: null,
      formSnapshot,
    };
    dispatch(addJob(job));
    dispatch(openPanel());

    ensureProgressSocket(dispatch, sidecarPort);
  };
}

// ---------------------------------------------------------------------------
// cancelTraining
// ---------------------------------------------------------------------------

export function cancelTraining(jobId: string): AppThunk {
  return async (dispatch) => {
    try {
      await fetch('/api/training/cancel', { method: 'POST' });
    } catch (err) {
      console.warn('[training] cancel failed:', err);
    }
    // The sidecar will broadcast a final 'cancelled' progress event, which
    // updates job state. If the WS is dead, remove the job optimistically.
    if (!ws.socket) {
      dispatch(removeJob(jobId));
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
    // Terminal runs live in the durable history archive, which the activity
    // panel re-seeds from on refresh. Mark this one dismissed so it stays out
    // of the panel (it remains in the Run History view).
    dispatch(dismissFromPanel(jobId));
    try {
      await fetch('/api/training/clear', { method: 'POST' });
    } catch (err) {
      console.warn('[training] clear failed:', err);
    }
  };
}

// ---------------------------------------------------------------------------
// hydrateActiveTraining — recover an in-flight job after page refresh.
// ---------------------------------------------------------------------------

export function hydrateActiveTraining(): AppThunk {
  return async (dispatch, getState) => {
    // If we already have a socket open, nothing to do.
    if (ws.socket && ws.socket.readyState <= WebSocket.OPEN) return;

    let active: {
      job_id: string;
      status: SidecarJobStatus;
      config?: Record<string, unknown>;
      progress?: SidecarJobProgress;
      started_at?: string;
    } | null = null;
    let sidecarPort = 9733;

    try {
      const [statusRes, sidecarRes] = await Promise.all([
        fetch('/api/training/status'),
        fetch('/api/training/sidecar'),
      ]);
      const statusData = (await statusRes.json()) as {
        active: boolean;
        job_id?: string;
        status?: SidecarJobStatus;
        config?: Record<string, unknown>;
        progress?: SidecarJobProgress;
        started_at?: string;
      };
      const sidecarData = (await sidecarRes.json()) as { port?: number };
      if (sidecarData.port) sidecarPort = sidecarData.port;

      if (statusData.active && statusData.job_id && statusData.status) {
        active = {
          job_id: statusData.job_id,
          status: statusData.status,
          config: statusData.config,
          progress: statusData.progress,
          started_at: statusData.started_at,
        };
      }
    } catch (err) {
      console.warn('[training] hydrate failed:', err);
      return;
    }

    if (!active) return;

    // Don't re-seed if this job is already in Redux — the middleware may
    // have persisted it, in which case we only need to reattach the WS.
    const existing = (getState() as RootState).jobs.jobs[active.job_id];
    const seededAt = active.started_at
      ? Date.parse(active.started_at)
      : Date.now();
    ws.startedAtByJob.set(active.job_id, seededAt);
    if (!existing) {
      // Reconstruct a minimal TrainingJob. Sidecar config is snake_case —
      // pick out the fields used for rendering the job card.
      const cfg = active.config ?? {};
      const provider =
        (cfg.provider as TrainingProvider) ??
        (cfg.provider_type as TrainingProvider) ??
        'ai-toolkit';
      const job: TrainingJob = {
        id: active.job_id,
        type: 'training',
        status:
          active.status === 'training' || active.status === 'preparing'
            ? 'running'
            : active.status,
        createdAt: seededAt,
        startedAt: seededAt,
        completedAt: null,
        error: active.progress?.error ?? null,
        config: {
          projectPath: (cfg.project_path as string) ?? '',
          provider,
          baseModel: (cfg.base_model as string) ?? '',
          modelPaths: {},
          outputPath: (cfg.output_path as string) ?? '',
          outputName: (cfg.output_name as string) ?? 'unnamed-lora',
          datasets: [],
          hyperparameters: {
            learningRate:
              ((cfg.hyperparameters as Record<string, unknown>)
                ?.lr as number) ?? 1e-4,
            epochs:
              ((cfg.hyperparameters as Record<string, unknown>)
                ?.epochs as number) ?? 0,
            batchSize:
              ((cfg.hyperparameters as Record<string, unknown>)
                ?.batch_size as number) ?? 1,
            resolution: 1024,
            networkDim:
              ((cfg.hyperparameters as Record<string, unknown>)
                ?.network_dim as number) ?? 16,
            networkAlpha:
              ((cfg.hyperparameters as Record<string, unknown>)
                ?.network_alpha as number) ?? 16,
            optimizer:
              ((cfg.hyperparameters as Record<string, unknown>)
                ?.optimizer as string) ?? 'adamw8bit',
            scheduler:
              ((cfg.hyperparameters as Record<string, unknown>)
                ?.scheduler as string) ?? 'constant',
            warmupSteps:
              ((cfg.hyperparameters as Record<string, unknown>)
                ?.warmup_steps as number) ?? 0,
            saveEveryNEpochs: 1,
            sampleEveryNSteps: 250,
            gradientAccumulationSteps: 1,
            mixedPrecision: 'bf16',
            extra: {
              numRestarts:
                ((cfg.hyperparameters as Record<string, unknown>)
                  ?.num_restarts as number) ?? 1,
              maxSavesToKeep:
                ((cfg.hyperparameters as Record<string, unknown>)
                  ?.max_saves_to_keep as number) ?? 0,
            },
          },
          samplePrompts: [],
        },
        progress: active.progress
          ? buildProgress(active.job_id, active.progress)
          : null,
      };
      dispatch(addJob(job));
    } else if (existing.startedAt) {
      ws.startedAtByJob.set(active.job_id, existing.startedAt);
    }

    // Only attach a WS if the job is still in-flight.
    if (active.status === 'training' || active.status === 'preparing') {
      ensureProgressSocket(dispatch, sidecarPort);
      // Surface the activity panel so the refresh doesn't silently drop it.
      dispatch(openPanel());
    }
  };
}
