import fs from 'node:fs';
import path from 'node:path';

import { NextResponse } from 'next/server';

import { connectSidecar } from '@/app/services/training/sidecar-manager';
import { getTrainingJobsDir } from '@/app/services/training/training-root';

/** True if `target` resolves to a path at or below `root`. */
const isWithin = (root: string, target: string): boolean => {
  const rel = path.relative(root, target);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
};

/** A single safe path segment: no separators/traversal, not empty, not all dots. */
const isSafeJobId = (id: string): boolean =>
  /^[A-Za-z0-9._-]+$/.test(id) && !/^\.+$/.test(id);

/**
 * DELETE /api/training/jobs/<jobId> — remove a run's working files from
 * `.training/jobs`: the generated config folder (`<jobId>/`, holding the
 * provider's toml/yaml, sample-prompt txt, and the run's archived `samples/`)
 * and the crash-recovery state snapshot (`<jobId>.json`).
 *
 * Since samples are archived into the job folder, this recursive delete takes
 * a run's images with it — the sample deletion fired alongside is the narrower
 * `samples/`-only path, and whichever lands first makes the other a no-op.
 *
 * Also tells the sidecar to forget the run. That call is what makes the delete
 * stick: the sidecar holds every run in memory and serves them from `/jobs`, so
 * removing only the files would let the next listing write the record straight
 * back — the run would return from the dead on the next sidecar restart.
 *
 * Fired fire-and-forget when a run leaves Run History, which is the only path
 * that destroys a run; clearing a card from the activity panel merely dismisses
 * it. Idempotent: nonexistent paths still succeed. Only ever called for terminal
 * runs — a live job's config is still in use by its training subprocess.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  try {
    const { jobId } = await params;

    if (!isSafeJobId(jobId)) {
      return new NextResponse('Bad request', { status: 400 });
    }

    const jobsDir = path.resolve(getTrainingJobsDir());
    const configDir = path.resolve(jobsDir, jobId);
    const stateFile = path.resolve(jobsDir, `${jobId}.json`);

    if (!isWithin(jobsDir, configDir) || !isWithin(jobsDir, stateFile)) {
      return new NextResponse('Access denied', { status: 403 });
    }

    // Drop the sidecar's in-memory copy first. If this fails we still remove
    // the files — a stale entry the user can dismiss beats leaving the run's
    // samples on disk with no way to reach them.
    const sidecar = await connectSidecar();
    if (sidecar.status === 'ready') {
      try {
        await fetch(
          `http://127.0.0.1:${sidecar.port}/jobs/${encodeURIComponent(jobId)}`,
          { method: 'DELETE' },
        );
      } catch {
        // Sidecar unreachable mid-call — fall through to the file removal.
      }
    }

    // force:true makes missing paths a no-op, so deletion is idempotent.
    fs.rmSync(configDir, { recursive: true, force: true });
    fs.rmSync(stateFile, { force: true });

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error('Error deleting training job files:', error);
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}
