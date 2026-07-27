'use client';

import { useMemo } from 'react';

import { useAppSelector } from '@/app/store/hooks';
import {
  type JobStatus,
  selectTrainingJobs,
  type TrainingJob,
} from '@/app/store/jobs';
import type { LoadedProject } from '@/app/store/training-config/types';
import { selectTrainingHistory } from '@/app/store/training-history';

export type RecentRun = {
  id: string;
  /** The LoRA the run was writing — how the user names a run to themselves. */
  name: string;
  status: JobStatus;
  /** The project version the run was launched from. */
  version: number | null;
  /** When it finished, or failing that when it started. */
  at: number;
  /** Still in flight — the row reads "Running" rather than a timestamp. */
  isActive: boolean;
  /**
   * Where the run can be opened from. Jobs the panel still holds have a live
   * Redux entry and open in the activity panel's detail modal; everything else
   * only exists as an archived snapshot, which the run-history modal renders.
   */
  source: 'job' | 'archive';
};

const ACTIVE_STATUSES: JobStatus[] = ['pending', 'preparing', 'running'];

/**
 * Whether a run was launched from the given project.
 *
 * The snapshot on the job is a copy taken at launch, so it can disagree with
 * the project as it stands now. Matching on id keeps a renamed project's runs
 * attached to it; runs archived before the id was snapshotted can only be
 * matched on the name they were launched under, which a rename does break.
 */
function belongsToProject(job: TrainingJob, project: LoadedProject): boolean {
  const snapshot = job.project;
  if (!snapshot) return false;
  return snapshot.id
    ? snapshot.id === project.id
    : snapshot.name === project.name;
}

function toRecentRun(job: TrainingJob, source: RecentRun['source']): RecentRun {
  return {
    id: job.id,
    name: job.config?.outputName || 'Training run',
    status: job.status,
    version: job.project?.version ?? null,
    at: job.completedAt ?? job.startedAt ?? job.createdAt,
    isActive: ACTIVE_STATUSES.includes(job.status),
    source,
  };
}

/**
 * Every training run launched from the current project, newest first.
 *
 * Drawn from both stores runs can live in: the jobs slice (which holds
 * anything in flight, plus terminal runs the panel hasn't been cleared of) and
 * the durable history archive. A run in both is taken from the jobs slice so
 * an in-flight one keeps updating; the archive fills in everything the panel
 * has since dropped. Callers cap the list — the count matters to them, so the
 * whole set is returned rather than a pre-truncated one.
 */
export function useRecentRuns(project: LoadedProject | null): RecentRun[] {
  const jobs = useAppSelector(selectTrainingJobs);
  const history = useAppSelector(selectTrainingHistory);

  return useMemo(() => {
    if (!project) return [];

    const byId = new Map<string, RecentRun>();
    for (const entry of history) {
      if (belongsToProject(entry, project)) {
        byId.set(entry.id, toRecentRun(entry, 'archive'));
      }
    }
    for (const job of jobs) {
      if (belongsToProject(job, project)) {
        byId.set(job.id, toRecentRun(job, 'job'));
      }
    }

    // Anything in flight leads, however long ago it started — a run that is
    // happening now outranks one that merely finished more recently.
    return [...byId.values()].sort((a, b) => {
      if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
      return b.at - a.at;
    });
  }, [jobs, history, project]);
}
