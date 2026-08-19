/**
 * Node-side client for the sidecar's download endpoints.
 *
 * Downloads live in the Python sidecar because it outlives both the browser
 * tab and the Node process (detached spawn + heartbeat), so a refresh or an
 * HMR restart no longer kills a multi-gigabyte transfer mid-file. This module
 * is the only place that talks to those endpoints.
 *
 * Read paths use `connectSidecar`, which reclaims an already-running sidecar
 * but never spawns one — booting a Python server as a side effect of a status
 * poll is never what the caller meant. Only starting a download uses
 * `ensureSidecar`.
 *
 * Server-only — do not import from client components.
 */

import {
  connectSidecar,
  ensureSidecar,
} from '@/app/services/training/sidecar-manager';

import type { ModelFile, ModelSidecar } from './types';

/** A fully-resolved download, as the sidecar wants it. */
export type SidecarDownloadSpec = {
  jobId: string;
  modelId: string;
  modelName: string;
  repoId: string;
  files: ModelFile[];
  targetDir: string;
  /**
   * Written as `<sidecarFileName>.model.json` on completion. Training only.
   * `downloadedAt` is stamped by the sidecar at write time — only it knows
   * when the transfer actually finished.
   */
  sidecarMeta?: Omit<ModelSidecar, 'downloadedAt'>;
  sidecarFileName?: string;
};

export type SidecarDownload = {
  job_id: string;
  model_id: string;
  model_name: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  bytes_downloaded: number;
  total_bytes: number;
  current_file: string | null;
  file_index: number | null;
  total_files: number | null;
  error: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  /** Measured live by the sidecar; null until it has a usable sample span. */
  speed_bps: number | null;
  eta_seconds: number | null;
};

const TIMEOUT_MS = 10_000;

async function sidecarFetch(
  port: number,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(`http://127.0.0.1:${port}${path}`, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Hand a resolved download to the sidecar, starting it if necessary.
 *
 * This is the one path that may spawn the sidecar: the user has explicitly
 * asked for a download, and there's nowhere else for it to run.
 */
export async function startSidecarDownload(
  spec: SidecarDownloadSpec,
): Promise<
  { ok: true; jobId: string } | { ok: false; error: string; status: number }
> {
  const sidecar = await ensureSidecar();
  if (sidecar.status !== 'ready') {
    return {
      ok: false,
      status: 503,
      error: `Downloads run in the training sidecar, which failed to start: ${
        sidecar.error ?? 'unknown error'
      }`,
    };
  }

  try {
    const res = await sidecarFetch(sidecar.port, '/downloads/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        job_id: spec.jobId,
        model_id: spec.modelId,
        model_name: spec.modelName,
        repo_id: spec.repoId,
        files: spec.files.map((f) => ({ name: f.name, size: f.size })),
        target_dir: spec.targetDir,
        sidecar_meta: spec.sidecarMeta ?? null,
        sidecar_file_name: spec.sidecarFileName ?? null,
      }),
    });

    const data = (await res.json()) as { job_id?: string; error?: string };
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: data.error ?? 'Failed to start download',
      };
    }
    return { ok: true, jobId: data.job_id ?? spec.jobId };
  } catch (error) {
    return {
      ok: false,
      status: 500,
      error: `Failed to reach the sidecar: ${error}`,
    };
  }
}

/**
 * Every download the sidecar is tracking.
 *
 * `available` distinguishes "the sidecar says there are no downloads" from
 * "the sidecar isn't there to ask", which are very different answers for the
 * client: the first means its cards are finished, the second means whatever it
 * was showing has stopped moving and should say so.
 */
export async function listSidecarDownloads(): Promise<{
  available: boolean;
  downloads: SidecarDownload[];
}> {
  const sidecar = await connectSidecar();
  if (sidecar.status !== 'ready') return { available: false, downloads: [] };

  try {
    const res = await sidecarFetch(sidecar.port, '/downloads');
    if (!res.ok) return { available: false, downloads: [] };
    const data = (await res.json()) as { downloads?: SidecarDownload[] };
    return { available: true, downloads: data.downloads ?? [] };
  } catch {
    return { available: false, downloads: [] };
  }
}

/**
 * Model ids with bytes landing right now.
 *
 * Two readers depend on this: the status routes, so a model being written
 * reports `downloading` rather than `partial` and siblings don't offer Delete
 * or Resume against a live write; and the delete route, which must refuse to
 * unlink a file the sidecar has open (on Windows the unlink fails and leaves a
 * half-wiped model).
 */
export async function activeDownloadModelIds(): Promise<Set<string>> {
  const { downloads } = await listSidecarDownloads();
  return new Set(
    downloads
      .filter((d) => d.status === 'queued' || d.status === 'running')
      .map((d) => d.model_id),
  );
}

/** Ask the sidecar to stop a download. Partial files are left to resume. */
export async function cancelSidecarDownload(
  jobId: string,
): Promise<{ ok: boolean; status: number; error?: string }> {
  const sidecar = await connectSidecar();
  if (sidecar.status !== 'ready') {
    return { ok: false, status: 409, error: 'Sidecar is not running' };
  }

  try {
    const res = await sidecarFetch(
      sidecar.port,
      `/downloads/${encodeURIComponent(jobId)}/cancel`,
      { method: 'POST' },
    );
    if (res.ok) return { ok: true, status: res.status };
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: false, status: res.status, error: data.error };
  } catch (error) {
    return { ok: false, status: 500, error: `${error}` };
  }
}

/**
 * Drop a terminal download's record so its card leaves the activity panel for
 * good. Files on disk are untouched — that's DELETE /api/model-manager/download.
 */
export async function clearSidecarDownload(jobId: string): Promise<boolean> {
  const sidecar = await connectSidecar();
  if (sidecar.status !== 'ready') return false;

  try {
    const res = await sidecarFetch(
      sidecar.port,
      `/downloads/${encodeURIComponent(jobId)}/clear`,
      { method: 'POST' },
    );
    return res.ok;
  } catch {
    return false;
  }
}
