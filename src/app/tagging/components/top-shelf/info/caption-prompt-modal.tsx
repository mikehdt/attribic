'use client';

import { RotateCcwIcon } from 'lucide-react';
import { useCallback, useState } from 'react';

import { DEFAULT_VLM_OPTIONS } from '@/app/services/auto-tagger';
import { Button } from '@/app/shared/button';
import { Modal } from '@/app/shared/modal';
import { useAppDispatch, useAppSelector } from '@/app/store/hooks';
import {
  selectCaptionPrompt,
  selectProjectFolderName,
  setCaptionPrompt,
} from '@/app/store/project';
import { updateProject } from '@/app/utils/project-actions';

type CaptionPromptModalProps = {
  isOpen: boolean;
  onClose: () => void;
};

/**
 * Authors the project's canonical natural-language captioning prompt.
 *
 * This is the only place the canonical prompt is written. Captioning runs seed
 * their prompt box from it, but edits made there apply to that run alone and
 * never travel back — so the project keeps one deliberate prompt rather than
 * drifting with whatever the last run happened to try.
 */
export const CaptionPromptModal = ({
  isOpen,
  onClose,
}: CaptionPromptModalProps) => {
  const dispatch = useAppDispatch();
  const projectFolderName = useAppSelector(selectProjectFolderName);
  const captionPrompt = useAppSelector(selectCaptionPrompt);

  // An unauthored project shows the default so the user edits from a working
  // prompt rather than an empty box.
  const savedPrompt = captionPrompt ?? DEFAULT_VLM_OPTIONS.prompt;

  const [prompt, setPrompt] = useState(savedPrompt);
  const [wasOpen, setWasOpen] = useState(isOpen);

  // Re-sync from Redux only on the closed→open transition. An effect keyed on
  // `savedPrompt` would clobber in-progress edits the moment Save dispatches.
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen);
    if (isOpen) setPrompt(savedPrompt);
  }

  const handleSave = useCallback(() => {
    const trimmed = prompt.trim();
    // Saving an empty box means "go back to the default": storing '' would
    // hand the model a promptless request. `updateProject` strips empty
    // strings, so this also clears the key from the project config.
    dispatch(setCaptionPrompt(trimmed || null));
    if (projectFolderName) {
      updateProject(projectFolderName, { captionPrompt: trimmed });
    }
    onClose();
  }, [prompt, dispatch, projectFolderName, onClose]);

  const isDefault = prompt === DEFAULT_VLM_OPTIONS.prompt;
  const hasChanges = prompt !== savedPrompt;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      className="max-w-2xl"
      labelledById="caption-prompt-modal-title"
    >
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-4">
          <h2
            id="caption-prompt-modal-title"
            className="text-2xl font-semibold text-slate-700 dark:text-slate-200"
          >
            Caption Prompt
          </h2>
          {!isDefault && (
            <Button
              onClick={() => setPrompt(DEFAULT_VLM_OPTIONS.prompt)}
              color="slate"
              variant="ghost"
              size="xs"
              width="sm"
            >
              <RotateCcwIcon />
              Reset
            </Button>
          )}
        </div>

        <p className="text-sm text-slate-500 dark:text-slate-400">
          This prompt is sent with each image when captioning this project.
          Every captioning run starts from it — a run can tweak its own copy
          without changing what&apos;s saved here.
        </p>

        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={16}
          autoFocus
          aria-label="Project caption prompt"
          className="resize-y rounded border border-slate-300 bg-white px-3 py-1.5 text-sm text-(--foreground) placeholder:text-slate-400 focus:border-sky-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800"
          placeholder="Describe this image in detail for AI training purposes."
        />

        <p className="text-sm text-slate-500">
          Example-based priming tends to work better than negative-only
          instructions with these models. Clear the box to fall back to the
          built-in default.
        </p>

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
      </div>
    </Modal>
  );
};
