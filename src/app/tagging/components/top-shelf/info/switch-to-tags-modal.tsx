'use client';

import { TagIcon } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/app/shared/button';
import { Modal } from '@/app/shared/modal';

type SwitchToTagsModalProps = {
  isOpen: boolean;
  /** How many loaded assets currently have a natural-language caption. */
  captionCount: number;
  onClose: () => void;
  /** Confirmed: strip captions and switch. Resolves when the strip completes. */
  onConfirm: () => Promise<void> | void;
};

/**
 * Confirm dialog shown when switching a hybrid project to Tags mode. Tags mode
 * ignores the caption section, so the captions would be silently rewritten as
 * junk tags on the next save — we make the loss explicit and opt-in here.
 */
export const SwitchToTagsModal = ({
  isOpen,
  captionCount,
  onClose,
  onConfirm,
}: SwitchToTagsModalProps) => {
  const [isWorking, setIsWorking] = useState(false);

  const handleConfirm = async () => {
    setIsWorking(true);
    try {
      await onConfirm();
      onClose();
    } finally {
      setIsWorking(false);
    }
  };

  const imageWord = captionCount === 1 ? 'image has' : 'images have';

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      className="max-w-md min-w-[24rem]"
      preventClose={isWorking}
      labelledById="switch-to-tags-modal-title"
    >
      <div className="flex flex-wrap gap-4">
        <h2
          id="switch-to-tags-modal-title"
          className="w-full text-2xl font-semibold text-slate-700 dark:text-slate-200"
        >
          Switch to Tags mode?
        </h2>

        <p className="w-full text-sm text-slate-500">
          {captionCount} {imageWord} a natural-language caption. Tags mode
          doesn’t use captions, so switching will remove them from the text
          files.
        </p>

        <div className="w-full rounded-md border border-amber-300 bg-amber-50 p-2 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-200">
          This can’t be undone. The tag list for each image is kept — only the
          caption text is discarded.
        </div>

        <div className="flex w-full justify-end gap-2 pt-2">
          <Button
            type="button"
            onClick={onClose}
            color="slate"
            size="md"
            width="lg"
            disabled={isWorking}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleConfirm}
            disabled={isWorking}
            neutralDisabled
            color="rose"
            size="md"
            width="lg"
          >
            <TagIcon className="mr-1 h-4 w-4" />
            {isWorking ? 'Removing…' : 'Drop captions & switch'}
          </Button>
        </div>
      </div>
    </Modal>
  );
};
