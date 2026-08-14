import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
} from 'react';

import { selectAllImages, selectFilteredAssets } from '@/app/store/assets';
import { selectHasActiveFilters } from '@/app/store/filters';
import { useAppDispatch, useAppSelector } from '@/app/store/hooks';
import { selectCaptionMode } from '@/app/store/project';
import {
  selectSelectedAssetsCount,
  selectWorkingSelection,
  selectWorkingSelectionCount,
} from '@/app/store/selection';
import {
  editTagsAcrossAssets,
  replaceCaptionsAcrossAssets,
} from '@/app/store/selection/thunks';
import {
  buildTagUpdates,
  compileSearch,
  getMatchRanges,
  type InvalidTagResult,
  type MatchRange,
  prepareReplacement,
  replaceText,
  type TagUpdate,
} from '@/app/utils/text-replace';

export type SearchReplaceTarget = 'tags' | 'captions';

type TagPreviewRow = TagUpdate & {
  assetCount: number;
  ranges: MatchRange[];
};

type CaptionPreviewRow = {
  fileId: string;
  caption: string;
  ranges: MatchRange[];
};

const CAPTION_PREVIEW_LIMIT = 15;

// Remembered across opens so reopening in hybrid mode keeps the last choice —
// deliberately session-only, per the no-persisted-UI-state rule.
let lastHybridTarget: SearchReplaceTarget = 'tags';

export const useSearchReplaceModal = (isOpen: boolean, onClose: () => void) => {
  const dispatch = useAppDispatch();
  const captionMode = useAppSelector(selectCaptionMode);

  const [pattern, setPattern] = useState('');
  const [replacement, setReplacement] = useState('');
  const [useRegex, setUseRegex] = useState(false);
  const [matchCase, setMatchCase] = useState(false);
  const [target, setTargetState] = useState<SearchReplaceTarget>('tags');
  const [onlyFilteredAssets, setOnlyFilteredAssets] = useState(true);
  const [onlySelectedAssets, setOnlySelectedAssets] = useState(false);

  const allImages = useAppSelector(selectAllImages);
  const filteredAssets = useAppSelector(selectFilteredAssets);
  const hasActiveFilters = useAppSelector(selectHasActiveFilters);
  const selectedAssets = useAppSelector(selectWorkingSelection);
  const selectedAssetsCount = useAppSelector(selectWorkingSelectionCount);
  const hasSelectedAssets = selectedAssetsCount > 0;
  // Ticks alone seed the scope checkbox — see the initialisation effect below
  const hasTickedAssets = useAppSelector(selectSelectedAssetsCount) > 0;

  // Only hybrid mode has a genuine target choice; the other modes are fixed
  const showTargetChooser = captionMode === 'hybrid';

  // Seed scoping and target when the modal opens. Unlike Edit Tags, filtered
  // scoping is always meaningful here — an arbitrary pattern can match assets
  // outside the filter chips, so the filtered set is never redundant.
  //
  // Only ticks seed the selected scope. Unscoped, this runs across the whole
  // project, and a highlight — which is nearly always present after clicking
  // around — must not quietly shrink that to a single asset. Tick the box and
  // the highlight joins the scope like any other soft selection.
  useEffect(() => {
    if (isOpen) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Intentional form initialization on modal open
      setOnlyFilteredAssets(hasActiveFilters);
      setOnlySelectedAssets(hasTickedAssets);
      setTargetState(
        captionMode === 'caption'
          ? 'captions'
          : captionMode === 'hybrid'
            ? lastHybridTarget
            : 'tags',
      );
    }
  }, [isOpen, hasActiveFilters, hasTickedAssets, captionMode]);

  const setTarget = useCallback(
    (next: SearchReplaceTarget) => {
      setTargetState(next);
      if (captionMode === 'hybrid') {
        lastHybridTarget = next;
      }
    },
    [captionMode],
  );

  const scopedAssets = useMemo(() => {
    const useFiltered = onlyFilteredAssets && hasActiveFilters;
    const useSelected = onlySelectedAssets && hasSelectedAssets;

    if (useFiltered && useSelected) {
      const selectedIds = new Set(selectedAssets);
      return filteredAssets.filter((a) => selectedIds.has(a.fileId));
    } else if (useFiltered) {
      return filteredAssets;
    } else if (useSelected) {
      const selectedIds = new Set(selectedAssets);
      return allImages.filter((a) => selectedIds.has(a.fileId));
    }
    return allImages;
  }, [
    onlyFilteredAssets,
    hasActiveFilters,
    onlySelectedAssets,
    hasSelectedAssets,
    filteredAssets,
    selectedAssets,
    allImages,
  ]);

  // Preview recomputes per keystroke over the whole scope — deferred values
  // keep typing responsive on large datasets
  const deferredPattern = useDeferredValue(pattern);
  const deferredReplacement = useDeferredValue(replacement);

  const { regex, error: patternError } = useMemo(
    () => compileSearch(deferredPattern, useRegex, matchCase),
    [deferredPattern, useRegex, matchCase],
  );

  const preparedReplacement = useMemo(
    () => prepareReplacement(deferredReplacement, useRegex),
    [deferredReplacement, useRegex],
  );

  // A comma in the replacement would split a tag into several on the next
  // load; captions are free-form text, so it's only invalid for tags
  const replacementHasComma = target === 'tags' && replacement.includes(',');

  const emptyTagPreview = useMemo(
    () => ({
      rows: [] as TagPreviewRow[],
      invalid: [] as InvalidTagResult[],
      affectedAssetCount: 0,
    }),
    [],
  );

  const tagPreview = useMemo(() => {
    if (target !== 'tags' || !regex || replacementHasComma) {
      return emptyTagPreview;
    }

    const tagCounts = new Map<string, number>();
    scopedAssets.forEach((asset) => {
      asset.tagList.forEach((tag) => {
        tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
      });
    });

    const { updates, invalid } = buildTagUpdates(
      [...tagCounts.keys()],
      regex,
      preparedReplacement,
    );

    const rows: TagPreviewRow[] = updates.map((update) => ({
      ...update,
      assetCount: tagCounts.get(update.oldTagName) ?? 0,
      ranges: getMatchRanges(update.oldTagName, regex),
    }));

    const changedTags = new Set(updates.map((u) => u.oldTagName));
    const affectedAssetCount = scopedAssets.filter((asset) =>
      asset.tagList.some((tag) => changedTags.has(tag)),
    ).length;

    return { rows, invalid, affectedAssetCount };
  }, [
    target,
    regex,
    replacementHasComma,
    preparedReplacement,
    scopedAssets,
    emptyTagPreview,
  ]);

  const captionPreview = useMemo(() => {
    if (target !== 'captions' || !regex) {
      return { rows: [] as CaptionPreviewRow[], affectedAssetCount: 0 };
    }

    const rows: CaptionPreviewRow[] = [];
    let affectedAssetCount = 0;

    for (const asset of scopedAssets) {
      const text = asset.captionText;
      if (!text) continue;
      if (replaceText(text, regex, preparedReplacement) === text) continue;

      affectedAssetCount++;
      if (rows.length < CAPTION_PREVIEW_LIMIT) {
        rows.push({
          fileId: asset.fileId,
          caption: text,
          ranges: getMatchRanges(text, regex),
        });
      }
    }

    return { rows, affectedAssetCount };
  }, [target, regex, preparedReplacement, scopedAssets]);

  const affectedAssetCount =
    target === 'tags'
      ? tagPreview.affectedAssetCount
      : captionPreview.affectedAssetCount;

  const hasChanges =
    target === 'tags'
      ? tagPreview.rows.length > 0
      : captionPreview.affectedAssetCount > 0;

  const canApply =
    !!regex && !patternError && !replacementHasComma && hasChanges;

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!canApply) return;

      const scopeFlags = {
        onlyFilteredAssets: onlyFilteredAssets && hasActiveFilters,
        onlySelectedAssets: onlySelectedAssets && hasSelectedAssets,
      };

      if (target === 'tags') {
        // Recompute from the raw (non-deferred) inputs so a submit mid-typing
        // can't apply a stale preview
        const { regex: submitRegex } = compileSearch(
          pattern,
          useRegex,
          matchCase,
        );
        if (!submitRegex) return;

        const distinctTags = new Set<string>();
        scopedAssets.forEach((asset) => {
          asset.tagList.forEach((tag) => distinctTags.add(tag));
        });

        const { updates } = buildTagUpdates(
          [...distinctTags],
          submitRegex,
          prepareReplacement(replacement, useRegex),
        );

        if (updates.length > 0) {
          dispatch(
            editTagsAcrossAssets({ tagUpdates: updates, ...scopeFlags }),
          );
        }
      } else {
        dispatch(
          replaceCaptionsAcrossAssets({
            pattern,
            replacement,
            useRegex,
            matchCase,
            ...scopeFlags,
          }),
        );
      }

      onClose();
    },
    [
      canApply,
      onlyFilteredAssets,
      hasActiveFilters,
      onlySelectedAssets,
      hasSelectedAssets,
      target,
      pattern,
      replacement,
      useRegex,
      matchCase,
      scopedAssets,
      dispatch,
      onClose,
    ],
  );

  const getSummaryMessage = () => {
    const useFiltered = onlyFilteredAssets && hasActiveFilters;
    const useSelected = onlySelectedAssets && hasSelectedAssets;
    const count = scopedAssets.length;

    if (useFiltered && useSelected) {
      return `Searching ${count} ${count === 1 ? 'asset that is' : 'assets that are'} both filtered and selected.`;
    } else if (useFiltered) {
      return `Searching the ${count} currently filtered ${count === 1 ? 'asset' : 'assets'}.`;
    } else if (useSelected) {
      return `Searching the ${count} selected ${count === 1 ? 'asset' : 'assets'}.`;
    }
    return 'Searching all assets.';
  };

  return {
    // Form state
    pattern,
    setPattern,
    replacement,
    setReplacement,
    useRegex,
    setUseRegex,
    matchCase,
    setMatchCase,

    // Target
    target,
    setTarget,
    showTargetChooser,

    // Scoping
    hasActiveFilters,
    filteredCount: filteredAssets.length,
    hasSelectedAssets,
    selectedAssetsCount,
    onlyFilteredAssets,
    setOnlyFilteredAssets,
    onlySelectedAssets,
    setOnlySelectedAssets,
    scopedAssetCount: scopedAssets.length,

    // Preview
    tagPreview,
    captionPreview,
    captionPreviewLimit: CAPTION_PREVIEW_LIMIT,
    affectedAssetCount,

    // Validation
    patternError,
    replacementHasComma,
    canApply,

    // Handlers
    handleSubmit,
    getSummaryMessage,
  };
};
