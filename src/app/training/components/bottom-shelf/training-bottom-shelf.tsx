import { ListPlusIcon, PlayIcon } from 'lucide-react';

import { Button } from '@/app/shared/button';
import { BottomShelfFrame } from '@/app/shared/shelf';
import { useAppSelector } from '@/app/store/hooks';
import { selectGpuQueueOccupied } from '@/app/store/jobs';
import { useHydrated } from '@/app/utils/use-hydrated';

type TrainingBottomShelfProps = {
  canStart: boolean;
  onStart: () => void;
};

// `canStart` derives from the training-config form, which only this page's
// own effects mutate — safe to render ungated. The queue state derives from
// the jobs slice, which layout-level effects can populate before this page
// chunk hydrates (e.g. an active run being rehydrated), so pin it to its SSR
// value until hydration completes — see useHydrated.
export const TrainingBottomShelf = ({
  canStart,
  onStart,
}: TrainingBottomShelfProps) => {
  const hydrated = useHydrated();
  const willQueue = useAppSelector(selectGpuQueueOccupied) && hydrated;

  return (
    <BottomShelfFrame>
      <div className="ml-auto flex items-center text-sm">
        <Button
          size="md"
          onClick={onStart}
          ghostDisabled
          neutralDisabled
          disabled={!canStart}
          color="teal"
        >
          {willQueue ? (
            <>
              <ListPlusIcon />
              Add to Queue
            </>
          ) : (
            <>
              <PlayIcon />
              Start Training
            </>
          )}
        </Button>
      </div>
    </BottomShelfFrame>
  );
};
