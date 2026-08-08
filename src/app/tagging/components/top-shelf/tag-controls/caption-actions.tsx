import { ReplaceIcon, SparklesIcon, SwatchBookIcon } from 'lucide-react';
import { memo, useCallback, useState } from 'react';

import { Button } from '@/app/shared/button';
import { ResponsiveToolbarGroup } from '@/app/shared/responsive-toolbar-group';
import { ToolbarDivider } from '@/app/shared/toolbar-divider';
import { AutoTaggerModal } from '@/app/tagging/components/auto-tagger/auto-tagger-modal';
import { useAutoTaggerLaunch } from '@/app/tagging/components/auto-tagger/use-auto-tagger-launch';

import { SearchReplaceModal } from './search-replace-modal/search-replace-modal';
import { TriggerPhrasesButton } from './trigger-phrases-modal';

/** Search & Replace — the only bulk caption edit, so first-class here */
const SearchReplaceButton = () => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const openModal = useCallback(() => setIsModalOpen(true), []);
  const closeModal = useCallback(() => setIsModalOpen(false), []);

  return (
    <>
      <Button
        variant="ghost"
        size="toolbar"
        onClick={openModal}
        title="Search and replace across captions"
      >
        <ReplaceIcon />
        <span className="max-lg:hidden">Search &amp; Replace</span>
      </Button>

      <SearchReplaceModal isOpen={isModalOpen} onClose={closeModal} />
    </>
  );
};

/** Auto Tagger button — first-class in caption mode */
const AutoTaggerButton = () => {
  const {
    isModalOpen,
    openModal,
    closeModal,
    assetsForTagger,
    hasReadyModel,
    selectedAssetsCount,
    filteredAssetsCount,
    canRun,
  } = useAutoTaggerLaunch();

  return (
    <>
      <Button
        variant="ghost"
        size="toolbar"
        onClick={openModal}
        disabled={!canRun}
        title={
          !hasReadyModel
            ? 'No tagger model ready'
            : selectedAssetsCount > 0
              ? `Auto-tag ${selectedAssetsCount} selected`
              : `Auto-tag ${filteredAssetsCount} filtered`
        }
      >
        <SparklesIcon />
        <span className="max-lg:hidden">Auto Tag</span>
      </Button>

      <AutoTaggerModal
        isOpen={isModalOpen}
        onClose={closeModal}
        selectedAssets={assetsForTagger}
      />
    </>
  );
};

const CaptionActionsComponent = () => {
  return (
    <ResponsiveToolbarGroup
      icon={<SwatchBookIcon className="h-4 w-4" />}
      title="Captions"
      position="right"
    >
      <TriggerPhrasesButton />

      <ToolbarDivider />

      <SearchReplaceButton />

      <ToolbarDivider />

      <AutoTaggerButton />
    </ResponsiveToolbarGroup>
  );
};

export const CaptionActions = memo(CaptionActionsComponent);
