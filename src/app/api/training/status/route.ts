import { NextResponse } from 'next/server';

import {
  listJobRecords,
  selectFocusJobRecord,
} from '@/app/services/training/job-records';
import { connectSidecar } from '@/app/services/training/sidecar-manager';

/**
 * GET /api/training/status — the single run worth showing right now.
 *
 * Sidecar-first, unlike `/api/training/jobs`: this answers "what is running",
 * which is genuinely live state — queue position, the current step, the log
 * tail — and only the sidecar holds it. Read-only, though: it connects to a
 * running sidecar (or reconnects to an orphan) but never spawns one, because
 * polling a status endpoint shouldn't boot a Python server.
 *
 * With no sidecar to ask, it falls back to the same on-disk records
 * `/api/training/jobs` serves, picking the focus run the way the sidecar does
 * and marking anything left mid-flight as interrupted. A cold start therefore
 * answers with the last real run rather than a bare "nothing here".
 */
/**
 * Never cached — this answers "right now", and its fallback path is a bare `fs`
 * read that Next would otherwise be free to evaluate once. See the same note on
 * `/api/training/jobs`.
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  const sidecar = await connectSidecar();
  if (sidecar.status === 'ready') {
    try {
      const res = await fetch(`http://127.0.0.1:${sidecar.port}/jobs/status`);
      if (res.ok) return NextResponse.json(await res.json());
    } catch {
      // Sidecar went away mid-request — fall through to the disk records.
    }
  }

  const focus = selectFocusJobRecord(await listJobRecords());
  if (!focus) return NextResponse.json({ active: false });
  // `active` mirrors the sidecar's own answer: it means "there is a focus run",
  // not "it is still going" — callers read the run's own status for that.
  return NextResponse.json({ active: true, ...focus });
}
