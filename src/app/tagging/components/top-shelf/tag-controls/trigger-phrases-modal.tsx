import { HighlighterIcon, PlusIcon, XIcon } from 'lucide-react';
import { type KeyboardEvent, memo, useCallback, useRef, useState } from 'react';

import { Button } from '@/app/shared/button';
import { Modal } from '@/app/shared/modal';
import { useAppDispatch, useAppSelector } from '@/app/store/hooks';
import {
  selectProjectFolderName,
  selectTriggerPhrases,
  setTriggerPhrases,
} from '@/app/store/project';
import { updateProject } from '@/app/utils/project-actions';

const inputStyles =
  'w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm outline-none transition-colors focus:border-amber-400 focus:ring-1 focus:ring-amber-300 dark:border-slate-600 dark:bg-slate-700 dark:focus:border-amber-500';

export const TriggerPhrasesModal = ({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) => {
  const dispatch = useAppDispatch();
  const triggerPhrases = useAppSelector(selectTriggerPhrases);
  const projectFolderName = useAppSelector(selectProjectFolderName);
  const [phrases, setPhrases] = useState<string[]>(() => [...triggerPhrases]);
  const [addValue, setAddValue] = useState('');
  const [wasOpen, setWasOpen] = useState(isOpen);
  const addInputRef = useRef<HTMLInputElement>(null);

  // Reset local state from Redux only on the closed→open transition. Using
  // `triggerPhrases` in an effect dep array would re-sync mid-edit (e.g.
  // right after Save dispatches) and clobber in-progress local changes.
  // This is the React-docs pattern for "adjusting state on prop change".
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen);
    if (isOpen) {
      setPhrases([...triggerPhrases]);
      setAddValue('');
    }
  }

  // Save commits exactly what's in the `phrases` array — pending text in the
  // add-field is intentionally ignored. The + button (or Enter) is the only
  // commit point for an individual phrase, so the modal can't sneak an
  // un-confirmed value into the saved list.
  const handleSave = useCallback(() => {
    dispatch(setTriggerPhrases(phrases));
    if (projectFolderName) {
      updateProject(projectFolderName, { triggerPhrases: phrases });
    }
    onClose();
  }, [phrases, dispatch, projectFolderName, onClose]);

  const handleEditPhrase = useCallback((index: number, value: string) => {
    setPhrases((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  }, []);

  const handleRemovePhrase = useCallback((index: number) => {
    setPhrases((prev) => prev.filter((_, i) => i !== index));
    // Refocus the add input after removal
    requestAnimationFrame(() => addInputRef.current?.focus());
  }, []);

  const handleAddPhrase = useCallback(() => {
    const trimmed = addValue.trim();
    if (!trimmed) return;
    setPhrases((prev) => [...prev, trimmed]);
    setAddValue('');
  }, [addValue]);

  const handleAddKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter' && addValue.trim()) {
        e.preventDefault();
        handleAddPhrase();
      }
    },
    [addValue, handleAddPhrase],
  );

  const handleEditKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>, index: number) => {
      if (e.key === 'Backspace' && phrases[index] === '') {
        e.preventDefault();
        handleRemovePhrase(index);
      }
    },
    [phrases, handleRemovePhrase],
  );

  // Save is only enabled when the committed `phrases` array differs from
  // the loaded value. Pending text in the add-field doesn't count — the user
  // has to click + (or Enter) to turn it into a real change.
  const hasChanges =
    phrases.length !== triggerPhrases.length ||
    phrases.some((p, i) => p !== triggerPhrases[i]);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      className="max-w-md"
      labelledById="trigger-phrases-modal-title"
    >
      <h2
        id="trigger-phrases-modal-title"
        className="w-full text-2xl font-semibold text-slate-700 dark:text-slate-200"
      >
        Trigger Phrases
      </h2>
      <p className="my-3 text-xs text-slate-500 dark:text-slate-400">
        Add trigger words or phrases to highlight in your captions and tags.
      </p>

      <div className="flex flex-col gap-2">
        {/* Existing phrases */}
        {phrases.map((phrase, index) => (
          <div key={index} className="flex items-center gap-1.5">
            <input
              type="text"
              value={phrase}
              onChange={(e) => handleEditPhrase(index, e.target.value)}
              onKeyDown={(e) => handleEditKeyDown(e, index)}
              className={inputStyles}
              aria-label={`Trigger phrase ${index + 1}`}
            />
            <Button
              onClick={() => handleRemovePhrase(index)}
              color="rose"
              variant="ghost"
              size="md"
              title="Remove trigger phrase"
            >
              <XIcon className="h-4 w-4" />
            </Button>
          </div>
        ))}

        {/* Divider when there are existing phrases */}
        {phrases.length > 0 && (
          <div className="h-px bg-slate-200 dark:bg-slate-600" />
        )}

        {/* Add input */}
        <div className="flex items-center gap-1.5">
          <input
            ref={addInputRef}
            type="text"
            value={addValue}
            onChange={(e) => setAddValue(e.target.value)}
            onKeyDown={handleAddKeyDown}
            placeholder="Add trigger phrase..."
            className={inputStyles}
            autoFocus
            aria-label="Add trigger phrase"
          />
          <Button
            onClick={handleAddPhrase}
            disabled={!addValue.trim()}
            title="Add trigger phrase"
            variant="ghost"
          >
            <PlusIcon />
          </Button>
        </div>
      </div>

      <div className="flex w-full justify-end gap-2 pt-2">
        <Button
          type="button"
          size="md"
          width="lg"
          color="slate"
          onClick={onClose}
        >
          Cancel
        </Button>

        <Button
          type="button"
          size="md"
          width="lg"
          color="teal"
          onClick={handleSave}
          disabled={!hasChanges}
          neutralDisabled
        >
          Save
        </Button>
      </div>
    </Modal>
  );
};

const TriggerPhrasesButtonComponent = () => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const triggerPhrases = useAppSelector(selectTriggerPhrases);

  return (
    <>
      <Button
        variant="ghost"
        size="toolbar"
        onClick={() => setIsModalOpen(true)}
        title="Edit trigger phrases"
      >
        <HighlighterIcon />

        <span className="flex items-center">
          <span className="mr-2 text-nowrap max-lg:hidden">Triggers</span>

          {triggerPhrases.length > 0 && (
            <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-green-500 px-1 text-xs font-bold text-white tabular-nums dark:bg-green-800">
              {triggerPhrases.length}
            </span>
          )}
        </span>
      </Button>

      <TriggerPhrasesModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
      />
    </>
  );
};

export const TriggerPhrasesButton = memo(TriggerPhrasesButtonComponent);
