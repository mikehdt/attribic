import { useCallback, useMemo, useState } from 'react';

import { copyTagsToAssets, selectTagCounts } from '@/app/store/assets';
import { useAppDispatch, useAppSelector } from '@/app/store/hooks';
import { selectProjectFolderName } from '@/app/store/project';
import { selectWorkingSelectionData } from '@/app/store/selection/combinedSelectors';

export type TagSortOption = 'order' | 'alphabetical' | 'frequency';

type UseCopyTagsModalParams = {
  isOpen: boolean;
  onClose: () => void;
};

export const useCopyTagsModal = ({
  isOpen,
  onClose,
}: UseCopyTagsModalParams) => {
  const dispatch = useAppDispatch();
  const selectedAssetsData = useAppSelector(selectWorkingSelectionData);
  const tagCounts = useAppSelector(selectTagCounts);

  // Local state
  const [donorAssetId, setDonorAssetId] = useState<string | null>(null);
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
  const [addToStart, setAddToStart] = useState(false);
  const [tagSortOption, setTagSortOption] = useState<TagSortOption>('order');
  const [wasOpen, setWasOpen] = useState(isOpen);

  // Reset local state only on the closed→open transition (render-time
  // "adjusting state on prop change" pattern). Keying an effect on
  // `selectedAssetsData` identity would re-seed the donor and wipe the tag
  // selection whenever a store change lands while the modal is open.
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen);
    if (isOpen) {
      setDonorAssetId(
        selectedAssetsData.length > 0 ? selectedAssetsData[0].fileId : null,
      );
      setSelectedTags(new Set());
      setAddToStart(false);
      setTagSortOption('order');
    }
  }

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

  return {
    // Asset data
    selectedAssetsData,
    donorAssetId,
    recipientAssets,
    projectName,

    // Tag data
    copyableTags,
    commonTags,
    selectedTags,

    // Options
    addToStart,
    setAddToStart,
    tagSortOption,
    setTagSortOption,

    // Status flags
    isFormValid,
    hasNoCopyableTags,

    // Handlers
    handleTagToggle,
    handleDonorChange,
    handleSubmit,
  };
};
