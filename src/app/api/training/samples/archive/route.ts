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
 * Best-effort delete of a trainer's original for a sample the sidecar already
 * copied into the archive. Confined to the loras root like everything else; a
 * failure just leaves a duplicate behind, which is why nothing is reported.
 */
const sweepSource = (root: string, sourcePath: unknown): void => {
  if (typeof sourcePath !== 'string' || sourcePath === '') return;
  const source = path.resolve(root, sourcePath);
  if (!isWithin(root, source)) return;
  try {
    fs.rmSync(source, { force: true });
  } catch {
    // Locked / already gone — a leftover duplicate is harmless.
  }
};

/**
 * POST /api/training/samples/archive — make sure a terminal run's training
 * samples live in a per-run archive folder, so Run History owns them and
 * Kohya's shared `sample/` dir stays clean.
 *
 * The sidecar now copies each sample into `<root>/.run-samples/<jobId>/` as
 * soon as it sees it, so the common case here is the tidy-up: the entry is
 * already archived and we delete the trainer's original (`sourcePath`). The
 * move path below still runs for runs collected before that existed, and for
 * any sample whose live copy failed.
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

      let source = path.resolve(root, sample.path);
      if (!isWithin(root, source)) continue; // failed confinement → skip

      if (!fs.existsSync(source)) {
        // The recorded file is gone. If the sidecar copied this sample and the
        // copy is what vanished, the trainer's original may still be there —
        // fall back to it and archive it the long way below.
        const fallback =
          typeof sample.sourcePath === 'string' && sample.sourcePath !== ''
            ? path.resolve(root, sample.sourcePath)
            : null;
        if (
          !fallback ||
          !isWithin(root, fallback) ||
          !fs.existsSync(fallback)
        ) {
          continue; // genuinely missing (e.g. predates restart) → skip
        }
        source = fallback;
      }

      // Already inside this run's archive folder — the normal case now that
      // the sidecar copies samples as it collects them. Keep it exactly where
      // and as it is, and sweep the trainer's original, which is the whole
      // reason this route still runs at terminal.
      if (path.dirname(source) === archiveDir) {
        sweepSource(root, sample.sourcePath);
        archived.push({
          path: `.run-samples/${jobId}/${path.basename(source)}`,
          step: sample.step,
          epoch: sample.epoch,
          promptIndex: sample.promptIndex,
          sourcePath: null,
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
            sourcePath: sample.sourcePath ?? null,
          });
          continue;
        }
      }

      // The move consumed whichever file we started from, so nothing is left
      // to sweep later.
      archived.push({
        path: `.run-samples/${jobId}/${name}`,
        step: sample.step,
        epoch: sample.epoch,
        promptIndex: sample.promptIndex,
        sourcePath: null,
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
