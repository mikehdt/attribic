import {
  ArrowUpFromLineIcon,
  ChevronsDownIcon,
  CopyIcon,
  HighlighterIcon,
  SparklesIcon,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { MenuButton, MenuItem } from '@/app/shared/menu-button';
import type { ImageAsset } from '@/app/store/assets';
import { gatherTags } from '@/app/store/assets';
import { selectFilteredAssets } from '@/app/store/assets';
import {
  selectHasReadyModel,
  selectIsInitialised,
  setModelsAndProviders,
} from '@/app/store/auto-tagger';
import { selectFilterTags } from '@/app/store/filters';
import {
  useAppDispatch,
  useAppSelector,
  useAppStore,
} from '@/app/store/hooks';
import { selectSelectedAssetsCount } from '@/app/store/selection';
import {
  selectAssetsWithActiveFiltersCount,
  selectEffectiveScopeAssetIds,
  selectNoSelectedAssetHasTags,
  selectSelectedAssetsData,
} from '@/app/store/selection/combinedSelectors';
import { AutoTaggerModal } from '@/app/tagging/components/auto-tagger';

import { CopyTagsModal } from './copy-tags-modal';
import { TriggerPhrasesModal } from './trigger-phrases-modal';

// Stable sentinel returned while the tagger modal is closed, so this
// always-mounted toolbar doesn't subscribe to full asset arrays it isn't using
const NO_ASSETS: ImageAsset[] = [];

export const TagActionsMenu = () => {
  const dispatch = useAppDispatch();
  const store = useAppStore();

  const [isCopyTagsModalOpen, setIsCopyTagsModalOpen] = useState(false);
  // Never auto-opens: a batch running for this project (one the user started
  // elsewhere, or one reattached to on return) shows in the activity panel,
  // which is where its progress lives now.
  const [isTaggerModalOpen, setIsTaggerModalOpen] = useState(false);
  const [isTriggersModalOpen, setIsTriggersModalOpen] = useState(false);

  const filterTags = useAppSelector(selectFilterTags);
  const selectedAssetsCount = useAppSelector(selectSelectedAssetsCount);

  const openCopyTagsModal = useCallback(() => setIsCopyTagsModalOpen(true), []);
  const closeCopyTagsModal = useCallback(
    () => setIsCopyTagsModalOpen(false),
    [],
  );

  // Full asset arrays are only subscribed while the tagger modal is open;
  // menu enablement runs off counts and booleans so store churn while the
  // menu idles doesn't re-render it.
  const selectedAssetsData = useAppSelector((state) =>
    isTaggerModalOpen ? selectSelectedAssetsData(state) : NO_ASSETS,
  );
  const filteredAssets = useAppSelector((state) =>
    isTaggerModalOpen ? selectFilteredAssets(state) : NO_ASSETS,
  );
  const filteredAssetsCount = useAppSelector(
    selectAssetsWithActiveFiltersCount,
  );
  const noSelectedAssetHasTags = useAppSelector(selectNoSelectedAssetHasTags);
  const hasReadyModel = useAppSelector(selectHasReadyModel);
  const isAutoTaggerInitialised = useAppSelector(selectIsInitialised);

  // Fetch auto-tagger models on mount to determine if any are ready.
  // Retries with backoff to handle Turbopack cold-compilation races where
  // the API route may 404 for several seconds on a fresh dev server.
  useEffect(() => {
    if (isAutoTaggerInitialised) return;

    const retryDelaysMs = [1000, 3000, 6000];
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const fetchModels = (attempt: number) => {
      fetch('/api/auto-tagger/models')
        .then((res) => {
          if (!res.ok) throw new Error(`${res.status}`);
          return res.json();
        })
        .then((data) => {
          if (!cancelled) dispatch(setModelsAndProviders(data));
        })
        .catch((err) => {
          if (cancelled) return;
          if (attempt < retryDelaysMs.length) {
            timeoutId = setTimeout(
              () => fetchModels(attempt + 1),
              retryDelaysMs[attempt],
            );
          } else {
            console.error('Failed to fetch auto-tagger models:', err);
          }
        });
    };
    fetchModels(0);

    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [isAutoTaggerInitialised, dispatch]);

  // Whether there are any assets available for auto-tagging (cheap count check)
  const hasAssetsForTagger = selectedAssetsCount > 0 || filteredAssetsCount > 0;

  // Prepare assets for auto-tagger: only compute the full mapped array when modal is open.
  // Videos are included — the ONNX batch route extracts a poster frame per video.
  const assetsForTagger = useMemo(() => {
    if (!isTaggerModalOpen) return [];
    const source =
      selectedAssetsData.length > 0 ? selectedAssetsData : filteredAssets;
    return source.map((asset) => ({
      fileId: asset.fileId,
      fileExtension: asset.fileExtension,
    }));
  }, [isTaggerModalOpen, selectedAssetsData, filteredAssets]);

  const openTaggerModal = useCallback(() => setIsTaggerModalOpen(true), []);
  const closeTaggerModal = useCallback(() => setIsTaggerModalOpen(false), []);

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

  const openTriggersModal = useCallback(() => setIsTriggersModalOpen(true), []);
  const closeTriggersModal = useCallback(
    () => setIsTriggersModalOpen(false),
    [],
  );

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
        disabled: !hasReadyModel || !hasAssetsForTagger,
      },
      {
        label: 'Trigger Phrases',
        icon: <HighlighterIcon />,
        onClick: openTriggersModal,
      },
    ],
    [
      openCopyTagsModal,
      selectedAssetsCount,
      noSelectedAssetHasTags,
      handleGatherTags,
      filterTags.length,
      openTaggerModal,
      hasReadyModel,
      hasAssetsForTagger,
      openTriggersModal,
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

      <TriggerPhrasesModal
        isOpen={isTriggersModalOpen}
        onClose={closeTriggersModal}
      />
    </>
  );
};
