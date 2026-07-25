import fs from 'node:fs';
import path from 'node:path';

import { NextResponse } from 'next/server';

import { getLoraOutputRoot } from '@/app/services/training/training-root';
import type { SampleImage } from '@/app/services/training/types';

/** True if `target` resolves to a path at or below `root`. */
const isWithin = (root: string, target: string): boolean => {
  const rel = path.relative(root, target);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
};

/** A single safe path segment: no separators/traversal, not empty, not all dots. */
const isSafeJobId = (id: string): boolean =>
  /^[A-Za-z0-9._-]+$/.test(id) && !/^\.+$/.test(id);

/**
 * Normalised archive filename `s{step:06d}-p{promptIndex:02d}[-e{epoch}].{ext}`.
 * All metadata survives in the name (no manifest); the epoch segment appears
 * only when the run is epoch-driven.
 */
const archiveName = (sample: SampleImage, ext: string): string => {
  const step = String(sample.step).padStart(6, '0');
  const prompt = String(sample.promptIndex).padStart(2, '0');
  const epoch = sample.epoch != null ? `-e${sample.epoch}` : '';
  return `s${step}-p${prompt}${epoch}${ext}`;
};

/**
 * POST /api/training/samples/archive — move a terminal run's training samples
 * into a per-run archive folder so Run History owns them and Kohya's shared
 * `sample/` dir stays clean.
 *
 * Body: `{ jobId, samples }` (camelCase — client↔Next). Each sample is confined
 * to the loras root, then moved into `<root>/.run-samples/<jobId>/` with a
 * normalised name. Missing sources and confinement failures are omitted from
 * the response; a file that exists but can't be moved (e.g. a transient AV
 * lock) keeps its original entry so the sample isn't dropped from the run.
 * Responds with the entries the run still owns (relative paths, POSIX
 * separators).
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      jobId?: unknown;
      samples?: unknown;
    };

    if (typeof body.jobId !== 'string' || !isSafeJobId(body.jobId)) {
      return NextResponse.json({ error: 'Invalid jobId' }, { status: 400 });
    }
    if (!Array.isArray(body.samples)) {
      return NextResponse.json({ error: 'Invalid samples' }, { status: 400 });
    }

    const jobId = body.jobId;
    const samples = body.samples as SampleImage[];

    // Same resolver the serving/GET route uses, so the archive lands under the
    // exact root those paths are later resolved against.
    const root = path.resolve(getLoraOutputRoot());

    const archiveDir = path.resolve(root, '.run-samples', jobId);
    // Created lazily on the first actual move, so a request whose samples are
    // all missing/skipped doesn't litter the disk with empty folders.
    let dirReady = false;

    const archived: SampleImage[] = [];

    for (const sample of samples) {
      if (!sample || typeof sample.path !== 'string') continue;

      const source = path.resolve(root, sample.path);
      if (!isWithin(root, source)) continue; // failed confinement → skip
      if (!fs.existsSync(source)) continue; // missing (e.g. predates restart) → skip

      // Already inside this run's archive folder (a re-archive of a moved
      // run) — keep it exactly where and as it is.
      if (path.dirname(source) === archiveDir) {
        archived.push({
          path: `.run-samples/${jobId}/${path.basename(source)}`,
          step: sample.step,
          epoch: sample.epoch,
          promptIndex: sample.promptIndex,
        });
        continue;
      }

      if (!dirReady) {
        fs.mkdirSync(archiveDir, { recursive: true });
        dirReady = true;
      }

      const ext = path.extname(source).toLowerCase();
      const baseName = archiveName(sample, ext);
      const stem = ext ? baseName.slice(0, -ext.length) : baseName;
      // Same-name collision (e.g. two samples whose step couldn't be parsed
      // both normalise to s000000) — disambiguate, never silently overwrite.
      let name = baseName;
      for (let n = 2; fs.existsSync(path.join(archiveDir, name)); n++) {
        name = `${stem}-${n}${ext}`;
      }
      const dest = path.join(archiveDir, name);

      try {
        fs.renameSync(source, dest); // same volume — cheap
      } catch {
        // Cross-volume (EXDEV) or other rename failure → copy + unlink.
        try {
          fs.copyFileSync(source, dest);
          fs.unlinkSync(source);
        } catch {
          // Couldn't move but the file exists (e.g. a transient lock) — keep
          // the original entry so the sample isn't dropped from the run.
          archived.push({
            path: sample.path,
            step: sample.step,
            epoch: sample.epoch,
            promptIndex: sample.promptIndex,
          });
          continue;
        }
      }

      archived.push({
        path: `.run-samples/${jobId}/${name}`,
        step: sample.step,
        epoch: sample.epoch,
        promptIndex: sample.promptIndex,
      });
    }

    return NextResponse.json({ samples: archived });
  } catch (error) {
    console.error('Error archiving training samples:', error);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 },
    );
  }
}
