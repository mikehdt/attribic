'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import type { TrainingProjectSummary } from '@/app/services/training-projects/disk-schema';
import { fetchProjectList } from '@/app/store/training-config/thunks';

/**
 * Fetch the saved training projects for a menu or modal, keeping "the list is
 * empty" and "the list didn't load" apart.
 *
 * Every consumer of this list used to swallow fetch failures into an empty
 * array, so an unreachable endpoint rendered as *you have no saved projects* —
 * indistinguishable from having lost them, and with no way back short of a
 * restart. Callers get an explicit `status` and a `reload` instead, and must
 * render the failure rather than a blank list.
 */
type TrainingProjectListStatus = 'loading' | 'ready' | 'error';

export type TrainingProjectList = {
  projects: TrainingProjectSummary[];
  status: TrainingProjectListStatus;
  /** Message from the last failed fetch — null unless `status` is 'error'. */
  error: string | null;
  reload: () => void;
};

export function useTrainingProjectList(enabled: boolean): TrainingProjectList {
  const [projects, setProjects] = useState<TrainingProjectSummary[]>([]);
  const [status, setStatus] = useState<TrainingProjectListStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  // Only the newest request may write. Reopening a modal (or hitting Retry)
  // while an earlier fetch is still in flight would otherwise let the stale
  // one land last.
  const latestRequest = useRef(0);

  const reload = useCallback(() => {
    setStatus('loading');
    setError(null);
    setAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const request = ++latestRequest.current;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Intentional: a fresh open re-enters the loading state before fetching
    setStatus('loading');

    fetchProjectList()
      .then((list) => {
        if (request !== latestRequest.current) return;
        setProjects(list);
        setError(null);
        setStatus('ready');
      })
      .catch((err: unknown) => {
        if (request !== latestRequest.current) return;
        setError(err instanceof Error ? err.message : String(err));
        setStatus('error');
      });
  }, [enabled, attempt]);

  return { projects, status, error, reload };
}
