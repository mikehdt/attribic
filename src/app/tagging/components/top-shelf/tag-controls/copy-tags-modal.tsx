'use client';

import { CopyIcon, FilmIcon } from 'lucide-react';
import Image from 'next/image';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { isSupportedVideoExtension } from '@/app/constants';
import { Button } from '@/app/shared/button';
import { Modal } from '@/app/shared/modal';
import { RadioGroup } from '@/app/shared/radio-group';
import { copyTagsToAssets, selectTagCounts } from '@/app/store/assets';
import { useAppDispatch, useAppSelector } from '@/app/store/hooks';
import { selectProjectFolderName } from '@/app/store/project';
import { selectSelectedAssetsData } from '@/app/store/selection/combinedSelectors';
import { getImageUrl } from '@/app/utils/image-utils';

import { CopyableTagPill } from './copyable-tag-pill';

type TagSortOption = 'order' | 'alphabetical' | 'frequency';

/**
 * Thumbnail that handles videos by loading the poster sidecar
 * (`<id>.poster.jpg`) and falling back to a film icon if it isn't
 * present yet (posters are generated lazily by the auto-tagger).
 */
const VideoOrImageThumb = ({
  src,
  alt,
  isVideo,
}: {
  src: string;
  alt: string;
  isVideo: boolean;
}) => {
  const [errored, setErrored] = useState(false);

  if (isVideo && errored) {
    return (
      <div className="flex h-20 w-20 items-center justify-center bg-slate-200 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
        <FilmIcon className="h-8 w-8" />
      </div>
    );
  }

  if (isVideo) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- poster sidecar may not exist; need onError fallback that next/image makes awkward
      <img
        src={src}
        alt={alt}
        width={80}
        height={80}
        className="h-20 w-20 object-contain"
        onError={() => setErrored(true)}
      />
    );
  }

  return (
    <Image
      src={src}
      alt={alt}
      width={80}
      height={80}
      className="h-20 w-20 object-contain"
    />
  );
};

type CopyTagsModalProps = {
  isOpen: boolean;
  onClose: () => void;
};

/**
 * Modal for copying tags from one selected asset (donor) to others (recipients).
 * - User selects which asset to copy from via radio buttons
 * - Tags from the donor that don't exist in all recipients are shown as copyable
 * - Selected tags are added to all recipient assets
 */
export const CopyTagsModal = ({ isOpen, onClose }: CopyTagsModalProps) => {
  const dispatch = useAppDispatch();
  const selectedAssetsData = useAppSelector(selectSelectedAssetsData);
  const tagCounts = useAppSelector(selectTagCounts);

  // Local state
  const [donorAssetId, setDonorAssetId] = useState<string | null>(null);
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
  const [addToStart, setAddToStart] = useState(false);
  const [tagSortOption, setTagSortOption] = useState<TagSortOption>('order');

  // Reset state when modal opens/closes
  useEffect(() => {
    if (isOpen) {
      // Pre-select first asset as donor
      if (selectedAssetsData.length > 0) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- Intentional form initialization on modal open
        setDonorAssetId(selectedAssetsData[0].fileId);
      }
      setSelectedTags(new Set());
      setAddToStart(false);
      setTagSortOption('order');
    } else {
      setDonorAssetId(null);
      setSelectedTags(new Set());
      setAddToStart(false);
      setTagSortOption('order');
    }
  }, [isOpen, selectedAssetsData]);

  // Get the donor asset data
  const donorAsset = useMemo(
    () => selectedAssetsData.find((a) => a.fileId === donorAssetId),
    [selectedAssetsData, donorAssetId],
  );

  // Get recipient assets (all except donor)
  const recipientAssets = useMemo(
    () => selectedAssetsData.filter((a) => a.fileId !== donorAssetId),
    [selectedAssetsData, donorAssetId],
  );

  // Calculate which tags can be copied and how many recipients need each
  const copyableTags = useMemo(() => {
    if (!donorAsset || recipientAssets.length === 0) return [];

    // Get tags from donor that are missing from at least one recipient
    const tags = donorAsset.tagList
      .map((tag, index) => {
        const recipientsNeedingTag = recipientAssets.filter(
          (r) => !r.tagList.includes(tag),
        );
        return {
          tagName: tag,
          recipientCount: recipientsNeedingTag.length,
          originalIndex: index,
        };
      })
      .filter((t) => t.recipientCount > 0);

    // Sort based on selected option
    switch (tagSortOption) {
      case 'alphabetical':
        return [...tags].sort((a, b) =>
          a.tagName.localeCompare(b.tagName, undefined, {
            sensitivity: 'base',
          }),
        );
      case 'frequency':
        return [...tags].sort(
          (a, b) => (tagCounts[b.tagName] ?? 0) - (tagCounts[a.tagName] ?? 0),
        );
      case 'order':
      default:
        return tags; // Already in original order
    }
  }, [donorAsset, recipientAssets, tagSortOption, tagCounts]);

  // Calculate tags that are common to all assets (donor + recipients)
  const commonTags = useMemo(() => {
    if (selectedAssetsData.length === 0) return [];

    // Start with all tags from first asset, filter to only those in all assets
    const allAssets = selectedAssetsData;
    if (allAssets.length === 0) return [];

    const firstAssetTags = new Set(allAssets[0].tagList);

    return Array.from(firstAssetTags).filter((tag) =>
      allAssets.every((asset) => asset.tagList.includes(tag)),
    );
  }, [selectedAssetsData]);

  // Handle tag toggle
  const handleTagToggle = useCallback((tagName: string) => {
    setSelectedTags((prev) => {
      const next = new Set(prev);
      if (next.has(tagName)) {
        next.delete(tagName);
      } else {
        next.add(tagName);
      }
      return next;
    });
  }, []);

  // Handle donor change - clear selected tags when donor changes
  const handleDonorChange = useCallback((assetId: string) => {
    setDonorAssetId(assetId);
    setSelectedTags(new Set());
  }, []);

  // Handle submit
  const handleSubmit = useCallback(() => {
    if (selectedTags.size === 0 || recipientAssets.length === 0) return;

    dispatch(
      copyTagsToAssets({
        tags: Array.from(selectedTags),
        targetAssetIds: recipientAssets.map((a) => a.fileId),
        position: addToStart ? 'start' : 'end',
      }),
    );

    onClose();
  }, [dispatch, selectedTags, recipientAssets, addToStart, onClose]);

  // Get project name for image URLs
  const projectName = useAppSelector(selectProjectFolderName);

  // Determine if form is valid
  const isFormValid = selectedTags.size > 0 && recipientAssets.length > 0;

  // No tags to copy message
  const hasNoCopyableTags = copyableTags.length === 0 && donorAsset;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      className="max-w-lg min-w-[28rem]"
      labelledById="copy-tags-modal-title"
    >
      <div className="flex flex-wrap gap-4">
        {/* Title */}
        <h2
          id="copy-tags-modal-title"
          className="w-full text-2xl font-semibold text-slate-700 dark:text-slate-200"
        >
          Copy Tags
        </h2>

        {/* Description */}
        <p className="w-full text-sm text-slate-500">
          Copy tags from one asset to the other{' '}
          {recipientAssets.length === 1
            ? 'selected asset'
            : `${recipientAssets.length} selected assets`}
          .
        </p>

        {/* Donor selection with thumbnails */}
        <div className="w-full">
          <h3 className="mb-2 text-sm font-medium text-slate-600 uppercase dark:text-slate-400">
            Copy from
          </h3>

          <div className="flex flex-wrap gap-2">
            {selectedAssetsData.map((asset) => {
              const isSelected = asset.fileId === donorAssetId;
              const isVideo = isSupportedVideoExtension(
                `.${asset.fileExtension}`,
              );
              const thumbFileName = isVideo
                ? `${asset.fileId}.poster.jpg`
                : `${asset.fileId}.${asset.fileExtension}`;
              const imageUrl = getImageUrl(
                thumbFileName,
                projectName || undefined,
              );

              return (
                <button
                  key={asset.fileId}
                  type="button"
                  onClick={() => handleDonorChange(asset.fileId)}
                  className={`relative overflow-hidden rounded-md border-2 transition-all ${
                    isSelected
                      ? 'border-teal-500 bg-teal-100 shadow-md shadow-teal-200 dark:bg-teal-950 dark:shadow-teal-800'
                      : 'border-slate-200 bg-slate-200 hover:border-slate-400 dark:border-slate-600 dark:bg-slate-900 dark:hover:border-slate-400'
                  }`}
                  title={asset.fileId}
                >
                  <VideoOrImageThumb
                    src={imageUrl}
                    alt={asset.fileId}
                    isVideo={isVideo}
                  />
                  {isSelected && (
                    <div className="absolute inset-0 bg-teal-500/20" />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Tags to copy */}
        <div className="w-full">
          <h3 className="text-sm font-medium text-slate-600 uppercase dark:text-slate-400">
            Tags to copy
          </h3>

          <div className="mt-2 mb-4">
            <RadioGroup
              name="tagSort"
              options={[
                { value: 'order', label: 'Tag order' },
                { value: 'alphabetical', label: 'Alphabetical' },
                { value: 'frequency', label: 'Frequency' },
              ]}
              value={tagSortOption}
              onChange={setTagSortOption}
            />
          </div>

          {hasNoCopyableTags ? (
            <p className="text-sm text-slate-400 italic">
              All tags from this asset already exist on the other assets.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {copyableTags.map(({ tagName, recipientCount }) => (
                <CopyableTagPill
                  key={tagName}
                  tagName={tagName}
                  recipientCount={recipientCount}
                  isSelected={selectedTags.has(tagName)}
                  onToggle={handleTagToggle}
                />
              ))}
            </div>
          )}
        </div>

        {/* Tag position */}
        <div className="w-full border-t border-t-slate-200 pt-4 dark:border-t-slate-700">
          <RadioGroup
            name="tagPosition"
            options={[
              { value: 'prepend', label: 'Prepend to start' },
              { value: 'append', label: 'Append to end' },
            ]}
            value={addToStart ? 'prepend' : 'append'}
            onChange={(mode) => setAddToStart(mode === 'prepend')}
          />
        </div>

        {/* Common tags (informational) */}
        {commonTags.length > 0 && (
          <div className="w-full">
            <h3 className="mb-1 text-sm font-medium text-slate-400 uppercase dark:text-slate-500">
              Common to all
            </h3>
            <p className="text-xs text-slate-400 dark:text-slate-500">
              {commonTags.join(', ')}
            </p>
          </div>
        )}

        {/* Summary */}
        {selectedTags.size > 0 && (
          <p className="w-full text-xs text-slate-500">
            {selectedTags.size} {selectedTags.size === 1 ? 'tag' : 'tags'} will
            be copied to {recipientAssets.length}{' '}
            {recipientAssets.length === 1 ? 'asset' : 'assets'}.
          </p>
        )}

        {/* Action buttons */}
        <div className="flex w-full justify-end gap-2 pt-2">
          <Button
            type="button"
            onClick={onClose}
            color="slate"
            size="md"
            width="lg"
          >
            Cancel
          </Button>

          <Button
            type="button"
            onClick={handleSubmit}
            disabled={!isFormValid}
            neutralDisabled
            color="teal"
            size="md"
            width="lg"
          >
            <CopyIcon className="mr-1 h-4 w-4" />
            Copy Tags
          </Button>
        </div>
      </div>
    </Modal>
  );
};
