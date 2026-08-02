import {
  ArrowUpFromLineIcon,
  ChevronsDownIcon,
  CopyIcon,
  SparklesIcon,
} from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

import { MenuButton, MenuItem } from '@/app/shared/menu-button';
import { gatherTags } from '@/app/store/assets';
import { selectFilterTags } from '@/app/store/filters';
import { useAppDispatch, useAppSelector, useAppStore } from '@/app/store/hooks';
import { selectSelectedAssetsCount } from '@/app/store/selection';
import {
  selectEffectiveScopeAssetIds,
  selectNoSelectedAssetHasTags,
} from '@/app/store/selection/combinedSelectors';
import { AutoTaggerModal } from '@/app/tagging/components/auto-tagger/auto-tagger-modal';
import { useAutoTaggerLaunch } from '@/app/tagging/components/auto-tagger/use-auto-tagger-launch';

import { CopyTagsModal } from './copy-tags-modal';

export const TagActionsMenu = () => {
  const dispatch = useAppDispatch();
  const store = useAppStore();

  const [isCopyTagsModalOpen, setIsCopyTagsModalOpen] = useState(false);

  const filterTags = useAppSelector(selectFilterTags);
  const selectedAssetsCount = useAppSelector(selectSelectedAssetsCount);
  const noSelectedAssetHasTags = useAppSelector(selectNoSelectedAssetHasTags);

  const openCopyTagsModal = useCallback(() => setIsCopyTagsModalOpen(true), []);
  const closeCopyTagsModal = useCallback(
    () => setIsCopyTagsModalOpen(false),
    [],
  );

  const {
    isModalOpen: isTaggerModalOpen,
    openModal: openTaggerModal,
    closeModal: closeTaggerModal,
    assetsForTagger,
    canRun: canAutoTag,
  } = useAutoTaggerLaunch();

  const handleGatherTags = useCallback(() => {
    if (filterTags.length >= 2) {
      // Scope ids read at click time — subscribing would re-render this
      // always-mounted menu on every selection/filter change
      dispatch(
        gatherTags({
          tags: filterTags,
          assetIds: selectEffectiveScopeAssetIds(store.getState()),
        }),
      );
    }
  }, [dispatch, filterTags, store]);

  const overflowMenuItems: MenuItem[] = useMemo(
    () => [
      {
        label: 'Copy Tags',
        icon: <CopyIcon />,
        onClick: openCopyTagsModal,
        disabled: selectedAssetsCount < 2 || noSelectedAssetHasTags,
      },
      {
        label: 'Gather Tags',
        icon: <ArrowUpFromLineIcon />,
        onClick: handleGatherTags,
        disabled: filterTags.length < 2,
      },
      {
        label: 'Auto Tagger',
        icon: <SparklesIcon />,
        onClick: openTaggerModal,
        disabled: !canAutoTag,
      },
    ],
    [
      openCopyTagsModal,
      selectedAssetsCount,
      noSelectedAssetHasTags,
      handleGatherTags,
      filterTags.length,
      openTaggerModal,
      canAutoTag,
    ],
  );

  return (
    <>
      <MenuButton
        icon={<ChevronsDownIcon />}
        items={overflowMenuItems}
        position="bottom-right"
        title="More tag actions"
      />

      <CopyTagsModal
        isOpen={isCopyTagsModalOpen}
        onClose={closeCopyTagsModal}
      />

      <AutoTaggerModal
        isOpen={isTaggerModalOpen}
        onClose={closeTaggerModal}
        selectedAssets={assetsForTagger}
      />
    </>
  );
};
