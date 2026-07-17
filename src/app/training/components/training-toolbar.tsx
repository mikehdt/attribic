'use client';

import { RotateCcwIcon, SaveIcon } from 'lucide-react';
import { memo, useCallback, useState } from 'react';

import { Button } from '@/app/shared/button';
import { SegmentedControl } from '@/app/shared/segmented-control/segmented-control';
import { ToolbarDivider } from '@/app/shared/toolbar-divider';
import { useAppDispatch, useAppSelector } from '@/app/store/hooks';
import {
  setTrainingViewMode,
  type TrainingViewMode,
} from '@/app/store/preferences';
import {
  resetToSuggestedDefaults,
  revertToBaseline,
  selectCanReset,
  selectForm,
  selectIsDirty,
  selectLoadedProject,
} from '@/app/store/training-config';
import { saveCurrentVersion } from '@/app/store/training-config/thunks';
import { useHydrated } from '@/app/utils/use-hydrated';

import { DeleteProjectModal } from './project-toolbar/delete-project-modal';
import { LoadProjectModal } from './project-toolbar/load-project-modal';
import { ProjectSelector } from './project-toolbar/project-selector';
import { SaveAsModal } from './project-toolbar/save-as-modal';
import { useTrainingViewMode } from './use-training-view-mode';

const VIEW_MODE_OPTIONS: { value: TrainingViewMode; label: string }[] = [
  { value: 'simple', label: 'Simple' },
  { value: 'intermediate', label: 'Intermediate' },
  { value: 'advanced', label: 'Advanced' },
  { value: 'expert', label: 'Expert' },
];

const TrainingToolbarComponent = () => {
  const dispatch = useAppDispatch();
  const viewMode = useTrainingViewMode();
  const hydrated = useHydrated();

  // This shelf lives in the layout, so other boundaries (the jobs effects,
  // and the training page itself with its config-fetch effects that dispatch
  // setAppModelDefaults/applyAppDefaults) can hydrate and mutate the store
  // before this component's hydration render. Pin every store-derived prop
  // to its SSR value until hydration completes — see useHydrated.
  const loadedProjectValue = useAppSelector(selectLoadedProject);
  const isDirtyValue = useAppSelector(selectIsDirty);
  const canResetValue = useAppSelector(selectCanReset);
  const form = useAppSelector(selectForm);

  const loadedProject = hydrated ? loadedProjectValue : null;
  const isDirty = hydrated && isDirtyValue;
  const canReset = hydrated && canResetValue;

  const [saveAsOpen, setSaveAsOpen] = useState(false);
  const [loadOpen, setLoadOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const handleViewModeChange = useCallback(
    (mode: TrainingViewMode) => {
      dispatch(setTrainingViewMode(mode));
    },
    [dispatch],
  );

  const handleSave = useCallback(() => {
    if (!loadedProject) return;
    void dispatch(saveCurrentVersion(form));
  }, [dispatch, form, loadedProject]);

  const handleReset = useCallback(() => {
    if (loadedProject && isDirty) {
      dispatch(revertToBaseline());
    } else {
      dispatch(resetToSuggestedDefaults());
    }
  }, [dispatch, isDirty, loadedProject]);

  const resetLabel = loadedProject ? 'Reset to saved' : 'Reset to defaults';

  return (
    <>
      {/* Left: project menu + save + reset */}
      <ProjectSelector
        onRequestLoad={() => setLoadOpen(true)}
        onRequestSaveAs={() => setSaveAsOpen(true)}
        onRequestDelete={() => setDeleteOpen(true)}
      />

      <ToolbarDivider />

      {loadedProject && (
        <Button
          size="sm"
          variant="ghost"
          onClick={handleSave}
          disabled={isDirty === false}
          title={
            isDirty
              ? `Save changes to v${loadedProject.version}`
              : 'No unsaved changes'
          }
        >
          <SaveIcon className="mr-1 h-3.5 w-3.5" />
          Save
        </Button>
      )}

      <Button
        size="sm"
        variant="ghost"
        onClick={handleReset}
        disabled={canReset === false}
        title={
          canReset
            ? resetLabel
            : loadedProject
              ? 'No unsaved changes to reset'
              : 'Already at defaults'
        }
      >
        <RotateCcwIcon className="mr-1 h-3.5 w-3.5" />
        {resetLabel}
      </Button>

      {/* Spacer */}
      <div className="mr-auto!" />

      {/* Right: view mode toggle */}
      <SegmentedControl
        options={VIEW_MODE_OPTIONS}
        value={viewMode}
        onChange={handleViewModeChange}
        size="toolbar"
      />

      <SaveAsModal isOpen={saveAsOpen} onClose={() => setSaveAsOpen(false)} />
      <LoadProjectModal isOpen={loadOpen} onClose={() => setLoadOpen(false)} />
      <DeleteProjectModal
        isOpen={deleteOpen}
        onClose={() => setDeleteOpen(false)}
      />
    </>
  );
};

export const TrainingToolbar = memo(TrainingToolbarComponent);
