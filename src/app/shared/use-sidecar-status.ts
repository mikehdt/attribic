'use client';

import { useCallback, useEffect, useState } from 'react';

import { useToast } from '@/app/shared/toast/hooks/use-toast';
import { useAppSelector } from '@/app/store/hooks';
import { selectGpuBusyReason } from '@/app/store/jobs';

export type SidecarStatus =
  'stopped' | 'starting' | 'ready' | 'error' | 'unknown';

export type SidecarAction = 'starting' | 'restarting' | 'shutting-down';

const POLL_INTERVAL_MS = 4000;

const errMessage = (err: unknown) =>
  err instanceof Error ? err.message : 'unknown error';

/**
 * Ask the server to bring the sidecar up, spawning it if it isn't already
 * running. Standalone (rather than only living inside {@link useSidecarStatus})
 * so callers that have no status readout to drive — the app-launch warm-up in
 * `AppProvider` — can start one without mounting the hook. Never throws; a
 * failure comes back as `error` with the reason.
 *
 * The warm-up passes `trigger: 'app-launch'` so the server can honour the
 * start-on-launch setting; a veto comes back as `skipped` rather than an
 * error. Manual starts pass nothing and always spawn.
 */
export const requestSidecarStart = async (options?: {
  trigger?: 'app-launch';
}): Promise<{
  status: SidecarStatus;
  error?: string;
  skipped?: boolean;
}> => {
  try {
    const res = await fetch('/api/training/sidecar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        options?.trigger ? { trigger: options.trigger } : {},
      ),
    });
    const data = await res.json().catch(() => ({}));
    if (data.skipped) {
      return {
        status: (data.status as SidecarStatus) ?? 'stopped',
        skipped: true,
      };
    }
    if (res.ok && data.status === 'ready') return { status: 'ready' };
    return { status: 'error', error: data.error ?? 'unknown error' };
  } catch (err) {
    return { status: 'error', error: errMessage(err) };
  }
};

/**
 * Drives the sidecar section of the global menu: a live status readout plus
 * start / restart / shut-down actions. Sidecar status is server-side module
 * state (no Redux slice), so we poll the status route — but only while the menu
 * is open (`enabled`), to avoid any always-on background polling.
 */
export const useSidecarStatus = (enabled: boolean) => {
  const gpuBusyReason = useAppSelector(selectGpuBusyReason);
  const { showToast, showErrorToast } = useToast();

  const [status, setStatus] = useState<SidecarStatus>('unknown');
  const [action, setAction] = useState<SidecarAction | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/training/sidecar');
      if (!res.ok) return;
      const data = await res.json();
      setStatus((data.status as SidecarStatus) ?? 'unknown');
    } catch {
      // Best-effort — keep the last known status on a transient failure.
    }
  }, []);

  // Poll while the menu is open, with an immediate fetch on open.
  useEffect(() => {
    if (!enabled) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async status poll; setState runs after the fetch resolves
    refresh();
    const id = window.setInterval(refresh, POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [enabled, refresh]);

  const start = useCallback(async () => {
    if (action) return;
    setAction('starting');
    setStatus('starting');
    const result = await requestSidecarStart();
    setStatus(result.status);
    if (result.status === 'ready') {
      showToast('Sidecar started.');
    } else {
      showErrorToast(`Sidecar failed to start: ${result.error}`);
    }
    setAction(null);
  }, [action, showToast, showErrorToast]);

  const restart = useCallback(async () => {
    if (action) return;

    // Restarting kills whatever the sidecar is doing. If we know a GPU job is
    // running, make the user confirm before we force it.
    const force = gpuBusyReason !== null;
    if (
      force &&
      !window.confirm(
        `A ${gpuBusyReason} job is running on the sidecar. Restarting will stop it. Continue?`,
      )
    ) {
      return;
    }

    setAction('restarting');
    try {
      const res = await fetch('/api/training/sidecar/restart', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force }),
      });
      const data = await res.json().catch(() => ({}));

      if (res.status === 409) {
        // A job started between our check and the click — surface it rather
        // than silently killing it.
        showErrorToast(
          'A job is running on the sidecar — restart cancelled. Cancel the job first, or retry to force.',
        );
        return;
      }
      if (res.ok && data.status === 'ready') {
        setStatus('ready');
        showToast('Sidecar restarted.');
      } else {
        setStatus('error');
        showErrorToast(
          `Sidecar restart failed: ${data.error ?? 'unknown error'}`,
        );
      }
    } catch (err) {
      showErrorToast(`Sidecar restart failed: ${errMessage(err)}`);
    } finally {
      setAction(null);
    }
  }, [action, gpuBusyReason, showToast, showErrorToast]);

  const shutdown = useCallback(async () => {
    if (action) return;

    const force = gpuBusyReason !== null;
    if (
      force &&
      !window.confirm(
        `A ${gpuBusyReason} job is running on the sidecar. Shutting down will stop it. Continue?`,
      )
    ) {
      return;
    }

    setAction('shutting-down');
    try {
      const res = await fetch('/api/training/sidecar/shutdown', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force }),
      });
      const data = await res.json().catch(() => ({}));

      if (res.status === 409) {
        showErrorToast(
          'A job is running on the sidecar — shutdown cancelled. Cancel the job first, or retry to force.',
        );
        return;
      }
      if (res.ok) {
        setStatus('stopped');
        showToast('Sidecar shut down.');
      } else {
        showErrorToast(
          `Sidecar shutdown failed: ${data.error ?? 'unknown error'}`,
        );
      }
    } catch (err) {
      showErrorToast(`Sidecar shutdown failed: ${errMessage(err)}`);
    } finally {
      setAction(null);
    }
  }, [action, gpuBusyReason, showToast, showErrorToast]);

  return { status, action, start, restart, shutdown, refresh };
};
