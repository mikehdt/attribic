/**
 * Read the training system's run records straight off disk.
 *
 * `<training>/jobs/<job_id>.json` is already the durable source of truth for
 * every run — the sidecar writes it as the run progresses and reads it all back
 * at boot (`JobManager._recover_state`), so its own `/jobs` listing is just a
 * projection of these files. Node can read them too, and doing so is what lets
 * run history answer truthfully while the sidecar is down: it only spawns on
 * demand and idle-exits, so "no sidecar" is the normal state between sessions,
 * not an outage.
 *
 * Read-mostly by design. The sidecar owns these files while it is up, and the
 * one write path here (dismissal) refuses to run unless no sidecar process is
 * alive — see `dismissJobRecordsOnDisk`.
 *
 * Deliberately unmemoised: the sidecar mutates these files behind Node's back
 * (progress every few seconds, terminal transitions, `_recover_state` rewriting
 * in-flight records to FAILED on boot, dismiss, delete), so every call re-reads
 * the directory and re-parses. A process-level cache here would be the same
 * staleness bug one layer down from a cached route.
 *
 * Server-only — do not import from client components.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import { isSidecarProcessAlive } from './sidecar-manager';
import { getTrainingJobsDir } from './training-root';

/** Statuses as the sidecar writes them — `JobStatus` in training-sidecar/models.py. */
type TrainingRecordStatus =
  'pending' | 'preparing' | 'training' | 'completed' | 'failed' | 'cancelled';

const RECORD_STATUSES = new Set<string>([
  'pending',
  'preparing',
  'training',
  'completed',
  'failed',
  'cancelled',
]);

const TERMINAL_STATUSES = new Set<string>(['completed', 'failed', 'cancelled']);

/** Shown as the run's error when a record outlived the sidecar that owned it. */
const INTERRUPTED_ERROR = 'Training interrupted — the sidecar is not running';

type TrainingRecordProgress = {
  status?: TrainingRecordStatus;
  error?: string | null;
  [key: string]: unknown;
};

/**
 * One run's record, as the client consumes it.
 *
 * Only the fields this module reasons about are named; everything else the
 * sidecar stores (`config`, `project`, `form_snapshot`, `client_config`, …)
 * rides through verbatim, which is what makes a run fully reconstructable from
 * disk alone.
 */
export type TrainingJobRecord = {
  job_id: string;
  status: TrainingRecordStatus;
  started_at?: string | null;
  completed_at?: string | null;
  dismissed?: boolean;
  progress?: TrainingRecordProgress | null;
  [key: string]: unknown;
};

function isTerminal(status: string): boolean {
  return TERMINAL_STATUSES.has(status);
}

/** `<jobs>/<job_id>.json` for a record file name already known to be safe. */
function recordPath(fileName: string): string {
  return path.join(getTrainingJobsDir(), fileName);
}

/**
 * One record file → the entry shape the client reads.
 *
 * The projection being mirrored is `JobManager._status_dict` in
 * training-sidecar/job_manager.py (a `JobState` model dump, plus a
 * `queue_position` only a live sidecar can know), which the client types as
 * `SidecarJobEntry`. Keep this the single place the two shapes meet, so the
 * coupling has one name.
 *
 * Returns null for anything that isn't a usable record — the caller logs and
 * skips it. Deliberately no quarantining or renaming: the sidecar does that
 * (`_quarantine_job_file`), and a second writer here would be a bug.
 */
function toJobRecord(
  raw: unknown,
  sidecarAlive: boolean,
): TrainingJobRecord | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = raw as TrainingJobRecord;
  if (typeof record.job_id !== 'string' || record.job_id === '') return null;
  if (
    typeof record.status !== 'string' ||
    !RECORD_STATUSES.has(record.status)
  ) {
    return null;
  }
  if (sidecarAlive || isTerminal(record.status)) return record;

  // A pending/preparing/training record only describes a live run while there's
  // a sidecar process to own it: the trainer runs as that process's child, so
  // with no sidecar the run died with it and the record is simply stale.
  //
  // Presentation only — nothing is written back. The sidecar makes the same
  // correction durably in `_recover_state` when it next boots, and that is what
  // keeps these files single-writer. `completed_at` is left as it is rather than
  // stamped with now: a run interrupted last week would otherwise report as
  // having just ended, inflating its duration by however long the gap was.
  return {
    ...record,
    status: 'failed',
    progress: record.progress
      ? {
          ...record.progress,
          status: 'failed',
          error: record.progress.error ?? INTERRUPTED_ERROR,
        }
      : record.progress,
  };
}

/**
 * Every run on record, oldest submission first.
 *
 * Ordering matches the sidecar's `list_status()` (which sorts on `started_at`)
 * so the two sources are interchangeable to the client.
 */
export async function listJobRecords(): Promise<TrainingJobRecord[]> {
  const jobsDir = getTrainingJobsDir();

  let names: string[];
  try {
    names = await fs.readdir(jobsDir);
  } catch {
    // No jobs folder — nothing has ever been trained here.
    return [];
  }

  const sidecarAlive = isSidecarProcessAlive();
  // Each entry is either `<id>.json` (a record) or `<id>/` (the run's working
  // dir). `.json.tmp` is a persist caught mid-flight and `.json.corrupt` one the
  // sidecar quarantined; neither ends in `.json`, so both fall out here.
  const files = names.filter((name) => name.endsWith('.json'));

  const parsed = await Promise.all(
    files.map(async (name) => {
      try {
        const text = await fs.readFile(recordPath(name), 'utf-8');
        const record = toJobRecord(JSON.parse(text), sidecarAlive);
        if (!record) {
          console.warn(`[training] Ignoring malformed job record ${name}`);
        }
        return record;
      } catch (err) {
        console.warn(`[training] Could not read job record ${name}:`, err);
        return null;
      }
    }),
  );

  return parsed
    .filter((record): record is TrainingJobRecord => record !== null)
    .sort((a, b) => (a.started_at ?? '').localeCompare(b.started_at ?? ''));
}

/**
 * The single run a status view shows, or null when there are none.
 *
 * Mirrors `JobManager._focus_job`: an in-flight run first, else the newest
 * terminal run the user hasn't dismissed (offering a dismissed one would put
 * its card straight back into the activity panel on the next hydrate). The
 * sidecar tells running from queued via its registry; on disk there's no such
 * distinction, so the oldest in-flight record wins — the same job either way,
 * since a run only starts once everything ahead of it has finished.
 *
 * Expects `listJobRecords` ordering (oldest first).
 */
export function selectFocusJobRecord(
  records: TrainingJobRecord[],
): TrainingJobRecord | null {
  const inFlight = records.find((record) => !isTerminal(record.status));
  if (inFlight) return inFlight;

  return records
    .filter((record) => isTerminal(record.status) && !record.dismissed)
    .reduce<TrainingJobRecord | null>(
      (newest, record) =>
        newest === null ||
        (record.completed_at ?? '') > (newest.completed_at ?? '')
          ? record
          : newest,
      null,
    );
}

/** Write a record back, via the same tmp-then-rename the sidecar uses. */
async function writeRecord(
  fileName: string,
  data: Record<string, unknown>,
): Promise<void> {
  const target = recordPath(fileName);
  const tmp = `${target}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf-8');
  await fs.rename(tmp, target);
}

/** Did `dismissed: true` actually land? Read the file back and see. */
async function isDismissedOnDisk(fileName: string): Promise<boolean> {
  try {
    const text = await fs.readFile(recordPath(fileName), 'utf-8');
    return (JSON.parse(text) as Record<string, unknown>).dismissed === true;
  } catch {
    return false;
  }
}

/**
 * Mark records dismissed on disk — the fallback for when there is no sidecar to
 * tell. Omit `jobId` to dismiss every run on record, matching
 * `dismiss_completed`. Resolves to how many records this call newly dismissed,
 * or null when the write was refused or couldn't be confirmed.
 *
 * Unlike the sidecar's version this does *not* skip non-terminal records, and
 * that difference is deliberate. With no sidecar alive an in-flight record
 * describes a run that died with the process, which is exactly why
 * `toJobRecord` shows it as failed — and a card the user can see as finished is
 * a card they can clear. Refusing here on the raw status made those cards
 * unclearable: the dismissal bounced, or worse, reported success and let the
 * card return on the next reload. Writing the flag is safe because
 * `_recover_state` rebuilds each record from its file (so `dismissed` survives
 * recovery) and independently fails in-flight runs on boot; the two agree.
 *
 * MIXED-WRITER GUARD: this is only safe with no sidecar process alive. A live
 * sidecar holds every job in `self._jobs` and rewrites the whole file from
 * memory on its next `_persist_state`, so anything written here would be
 * silently reverted. Rather than write a change that won't stick, we refuse and
 * let the caller report the dismissal as undelivered.
 *
 * The guard is re-checked per record and every write is verified by reading the
 * file back, which is as tight as this can be made. The residual race can't be
 * closed from here: a sidecar spawning *while* a write is in flight reads the
 * files in `_recover_state` at boot, so a write that lands before that read is
 * picked up, while one landing during it is overwritten from the sidecar's fresh
 * copy. Bounded to the records still unwritten at that instant, and visible —
 * they come back unverified, so the caller reports the dismissal as undelivered
 * rather than claiming a change that isn't there.
 */
export async function dismissJobRecordsOnDisk(
  jobId?: string,
): Promise<number | null> {
  if (isSidecarProcessAlive()) return null;

  const jobsDir = getTrainingJobsDir();
  let names: string[];
  try {
    names = await fs.readdir(jobsDir);
  } catch {
    return 0;
  }

  const files = jobId
    ? names.filter((name) => name === `${jobId}.json`)
    : names.filter((name) => name.endsWith('.json'));

  let dismissed = 0;
  let unconfirmed = 0;
  for (const name of files) {
    // A sidecar that came up mid-loop owns the rest of the files from here on.
    if (isSidecarProcessAlive()) {
      unconfirmed += 1;
      break;
    }
    try {
      const text = await fs.readFile(recordPath(name), 'utf-8');
      // Re-parsed raw rather than reusing `listJobRecords`: what goes back to
      // disk must be the file as the sidecar wrote it, never the interrupted
      // projection `toJobRecord` applies for presentation.
      const raw = JSON.parse(text) as Record<string, unknown>;
      // Not a record we understand, so not a card that can come back: leave the
      // file alone rather than writing a flag into arbitrary JSON. `listJobRecords`
      // ignores it for the same reason, and the sidecar quarantines it.
      if (typeof raw.job_id !== 'string' || raw.job_id === '') continue;
      // Already in the state we want — nothing to write, nothing to report.
      if (raw.dismissed === true) continue;

      await writeRecord(name, { ...raw, dismissed: true });
      if (await isDismissedOnDisk(name)) {
        dismissed += 1;
      } else {
        unconfirmed += 1;
      }
    } catch (err) {
      // Deleted between the listing and the write — there's no card left for it
      // to bring back, so nothing failed.
      if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') continue;
      console.warn(`[training] Could not dismiss job record ${name}:`, err);
      unconfirmed += 1;
    }
  }

  // Delivery-checked on both paths, not just the single-run one: a "Clear all"
  // that reported the count it managed let the records it missed come back as
  // cards on the next reload, having already told the client it was done.
  // Undelivered is the honest answer — the caller re-reads and shows the truth.
  if (unconfirmed > 0) return null;

  return dismissed;
}
