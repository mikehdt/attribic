'use client';

import { Modal } from '../modal';
import { SegmentedControl } from '../segmented-control/segmented-control';
import { AutoTaggerTab } from './auto-tagger-tab';
import { SettingsTab } from './settings-tab';
import { TrainingTab } from './training-tab';
import { useModelManager } from './use-model-manager';

export function ModelManagerModal() {
  const { isOpen, activeTab, setActiveTab, handleClose } = useModelManager();

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      className="max-w-2xl"
      labelledById="model-manager-modal-title"
    >
      <div className="flex flex-col gap-4">
        <h2
          id="model-manager-modal-title"
          className="text-2xl font-semibold text-slate-700 dark:text-slate-200"
        >
          Model Manager
        </h2>

        {/* Tabs */}
        <SegmentedControl
          options={[
            { value: 'auto-tagger' as const, label: 'Image Tagging' },
            { value: 'training' as const, label: 'Image Training (WIP)' },
            { value: 'settings' as const, label: 'Settings' },
          ]}
          value={activeTab}
          onChange={setActiveTab}
          size="xl"
        />

        {/* Tab content */}
        <div className="max-h-[60vh] overflow-y-auto">
          {activeTab === 'auto-tagger' && <AutoTaggerTab />}
          {activeTab === 'training' && <TrainingTab />}
          {activeTab === 'settings' && <SettingsTab />}
        </div>
      </div>
    </Modal>
  );
}
