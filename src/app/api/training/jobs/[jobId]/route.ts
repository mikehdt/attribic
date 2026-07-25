import fs from 'node:fs';
import path from 'node:path';

import { NextResponse } from 'next/server';

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
 * provider's toml/yaml plus sample-prompt txt) and the crash-recovery state
 * snapshot (`<jobId>.json`).
 *
 * Fired fire-and-forget when a run leaves Run History, alongside the archived
 * sample deletion. Idempotent: nonexistent paths still succeed. Only ever
 * called for terminal runs — a live job's config is still in use by its
 * training subprocess.
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

    // force:true makes missing paths a no-op, so deletion is idempotent.
    fs.rmSync(configDir, { recursive: true, force: true });
    fs.rmSync(stateFile, { force: true });

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error('Error deleting training job files:', error);
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}
