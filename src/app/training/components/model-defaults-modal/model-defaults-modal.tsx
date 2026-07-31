'use client';

import { useCallback, useEffect, useState } from 'react';

import {
  getAllModelComponents,
  getModelsByArchitecture,
  type ModelComponentType,
} from '@/app/services/training/models';
import { Button } from '@/app/shared/button';
import { FormTitle } from '@/app/shared/form-title/form-title';
import { Modal } from '@/app/shared/modal';
import { useAppDispatch } from '@/app/store/hooks';
import { addToast } from '@/app/store/toasts';

import { ModelPathField } from '../model-path-field/model-path-field';
import { useEnsureModelStatuses } from '../model-path-field/use-ensure-model-statuses';
import type { AppModelDefaults } from '../training-config-form/use-training-config-form';

type ModelDefaultsModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onSaved: (defaults: AppModelDefaults) => void;
};

/** Models grouped by architecture, for display in the defaults modal. */
const MODEL_GROUPS = getModelsByArchitecture();

export function ModelDefaultsModal({
  isOpen,
  onClose,
  onSaved,
}: ModelDefaultsModalProps) {
  const dispatch = useAppDispatch();
  const [draft, setDraft] = useState<AppModelDefaults>({});
  // Snapshot of what was loaded — used as the reset target so the user
  // can undo in-modal edits back to the last saved value.
  const [savedDefaults, setSavedDefaults] = useState<AppModelDefaults>({});
  const [saving, setSaving] = useState(false);

  useEnsureModelStatuses(isOpen);

  // Load current defaults when modal opens
  useEffect(() => {
    if (!isOpen) return;
    fetch('/api/config/model-defaults')
      .then((r) => r.json())
      .then((data: AppModelDefaults) => {
        setDraft(data);
        setSavedDefaults(data);
      })
      .catch(() => {});
  }, [isOpen]);

  const setPath = useCallback(
    (modelId: string, comp: ModelComponentType, value: string) => {
      setDraft((prev) => ({
        ...prev,
        [modelId]: { ...prev[modelId], [comp]: value },
      }));
    },
    [],
  );

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/config/model-defaults', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      });
      // A non-OK answer still parses as JSON, so without this check an error
      // body was applied as though it were the saved defaults.
      if (!res.ok) throw new Error(`Save failed (${res.status})`);
      const saved = await res.json();
      onSaved(saved);
      onClose();
    } catch (err) {
      // Stay open with the draft intact — closing silently looked like a save.
      dispatch(
        addToast({
          children:
            err instanceof Error
              ? `Couldn't save model defaults: ${err.message}`
              : "Couldn't save model defaults",
          variant: 'error',
        }),
      );
    } finally {
      setSaving(false);
    }
  }, [dispatch, draft, onClose, onSaved]);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      className="max-w-xl"
      labelledById="model-defaults-modal-title"
    >
      <div className="flex flex-col gap-4">
        <div>
          <h2
            id="model-defaults-modal-title"
            className="text-2xl font-semibold text-slate-700 dark:text-slate-200"
          >
            Default Model Paths
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Set default file paths for model components. These will be
            pre-filled when you start a new training run.
          </p>
        </div>

        <div className="flex flex-col gap-5 pr-1">
          {MODEL_GROUPS.map(({ architecture, label, models }) => (
            <div key={architecture}>
              <h3 className="mb-3 border-b border-slate-200 pb-2 text-base font-medium text-slate-700 dark:border-slate-700 dark:text-slate-300">
                {label}
              </h3>
              <div className="space-y-4">
                {models.map((model) => (
                  <div key={model.id}>
                    {models.length > 1 && (
                      <p className="mb-2 text-sm text-slate-400 dark:text-slate-300">
                        {model.name}
                      </p>
                    )}
                    <div className="space-y-2">
                      {/* Every backend's components, since these defaults are
                          set before a backend is chosen. */}
                      {getAllModelComponents(model).map((comp) => (
                        <div key={comp.type}>
                          <FormTitle className="mt-4 mb-2 ml-2 flex items-baseline gap-1.5">
                            {comp.label}
                            {!comp.required && (
                              <span className="font-normal text-slate-400">
                                (optional)
                              </span>
                            )}
                          </FormTitle>

                          <ModelPathField
                            value={draft[model.id]?.[comp.type] ?? ''}
                            onChange={(path) =>
                              setPath(model.id, comp.type, path)
                            }
                            browseTitle={comp.label}
                            downloadId={comp.downloadId}
                            resetTo={savedDefaults[model.id]?.[comp.type]}
                            className="dark:bg-slate-900"
                          />
                          {comp.hint && (
                            <p className="mt-1 ml-4 text-xs text-slate-400 dark:text-slate-500">
                              {comp.hint}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="flex w-full justify-end gap-2 pt-2">
          <Button onClick={onClose} color="slate" size="md" width="lg">
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            color="indigo"
            size="md"
            width="lg"
            disabled={saving}
            neutralDisabled
          >
            {saving ? 'Saving…' : 'Save Defaults'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
