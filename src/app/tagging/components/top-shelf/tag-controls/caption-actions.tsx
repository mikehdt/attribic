import { SparklesIcon, SwatchBookIcon } from 'lucide-react';
import { memo } from 'react';

import { Button } from '@/app/shared/button';
import { ResponsiveToolbarGroup } from '@/app/shared/responsive-toolbar-group';
import { ToolbarDivider } from '@/app/shared/toolbar-divider';
import { AutoTaggerModal } from '@/app/tagging/components/auto-tagger/auto-tagger-modal';
import { useAutoTaggerLaunch } from '@/app/tagging/components/auto-tagger/use-auto-tagger-launch';

import { TriggerPhrasesButton } from './trigger-phrases-modal';

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

      <AutoTaggerButton />
    </ResponsiveToolbarGroup>
  );
};

export const CaptionActions = memo(CaptionActionsComponent);
