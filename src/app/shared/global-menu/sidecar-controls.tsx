import { PlayIcon, PowerIcon, RefreshCwIcon } from 'lucide-react';

import { MenuItem } from '@/app/shared/menu-item';
import { Stats } from '@/app/shared/stats/stats';
import {
  type SidecarStatus,
  useSidecarStatus,
} from '@/app/shared/use-sidecar-status';

const STATUS_META: Record<SidecarStatus, { label: string; dot: string }> = {
  ready: { label: 'Running', dot: 'bg-emerald-500' },
  starting: { label: 'Starting…', dot: 'bg-amber-400 animate-pulse' },
  error: { label: 'Error', dot: 'bg-rose-500' },
  stopped: { label: 'Stopped', dot: 'bg-slate-400' },
  unknown: { label: 'Checking…', dot: 'bg-slate-300 dark:bg-slate-600' },
};

type SidecarControlsProps = {
  /** Whether the containing menu is open — gates status polling. */
  enabled: boolean;
};

/**
 * The Sidecar section of the global menu: a live status readout plus
 * start / restart / shut-down actions appropriate to the current status.
 */
export const SidecarControls = ({ enabled }: SidecarControlsProps) => {
  const { status, action, start, restart, shutdown } =
    useSidecarStatus(enabled);

  const meta = STATUS_META[status];
  const running = status === 'ready' || status === 'starting';
  const canStart = status === 'stopped' || status === 'error';
  const isBusy = action !== null;

  return (
    <div>
      <div className="flex items-center gap-2 px-3 py-2 text-xs font-medium tracking-wide text-slate-400 uppercase dark:text-slate-500">
        <span className={`h-2 w-2 shrink-0 rounded-full ${meta.dot}`} />
        Sidecar &middot; {meta.label}
      </div>

      {/* Host load — only worth polling while the menu is open AND there's a
          sidecar to ask; a stopped one has nothing to report. */}
      {status === 'ready' && (
        <div className="px-3 pb-2">
          <Stats enabled={enabled && status === 'ready'} />
        </div>
      )}

      {canStart && (
        <MenuItem
          icon={<PlayIcon className="h-5 w-5" />}
          label={action === 'starting' ? 'Starting sidecar…' : 'Start Sidecar'}
          onClick={start}
          disabled={isBusy}
        />
      )}

      {running && (
        <>
          <MenuItem
            icon={
              <RefreshCwIcon
                className={`h-5 w-5 ${action === 'restarting' ? 'animate-spin' : ''}`}
              />
            }
            label={
              action === 'restarting'
                ? 'Restarting sidecar…'
                : 'Restart Sidecar'
            }
            onClick={restart}
            disabled={isBusy}
          />
          <MenuItem
            icon={<PowerIcon className="h-5 w-5" />}
            label={
              action === 'shutting-down'
                ? 'Shutting down…'
                : 'Shut Down Sidecar'
            }
            onClick={shutdown}
            disabled={isBusy}
          />
        </>
      )}
    </div>
  );
};
