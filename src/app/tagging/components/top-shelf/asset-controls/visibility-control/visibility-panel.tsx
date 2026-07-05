import { InfoIcon, TriangleAlertIcon } from 'lucide-react';
import { useMemo } from 'react';

import { Checkbox } from '@/app/shared/checkbox';
import { FormTitle } from '@/app/shared/form-title/form-title';
import { SectionDivider } from '@/app/shared/section-divider/section-divider';
import { SegmentedControl } from '@/app/shared/segmented-control/segmented-control';
import { ClassFilterMode } from '@/app/store/filters';
import { useAppSelector } from '@/app/store/hooks';
import { selectCaptionMode } from '@/app/store/project';

import {
  type SectionConfig,
  useVisibilityControl,
} from './use-visibility-control';

const CLASS_MODES: Array<{ value: ClassFilterMode; label: string }> = [
  { value: ClassFilterMode.OFF, label: 'Off' },
  { value: ClassFilterMode.ANY, label: 'Any' },
  { value: ClassFilterMode.ALL, label: 'All' },
  { value: ClassFilterMode.INVERSE, label: 'Inverse' },
];

const formatCategoryList = (categories: string[]) => {
  if (categories.length === 0) return '';
  if (categories.length === 1) return categories[0];
  return (
    categories.slice(0, -1).join(', ') +
    ', or ' +
    categories[categories.length - 1]
  );
};

export const VisibilityPanel = () => {
  const {
    sections,
    visibility,
    selectedAssetsCount,
    hasTaglessAssets,
    hasModifiedAssets,
    handleSetClassMode,
    handleToggleScopeTagless,
    handleToggleScopeSelected,
    handleToggleModified,
  } = useVisibilityControl();

  const captionMode = useAppSelector(selectCaptionMode);
  const tagSection = sections.find((s) => s.key === 'tags');
  const hasTagSelections = !!(tagSection && tagSection.count > 0);
  const taglessLabel =
    captionMode === 'caption' ? 'Uncaptioned only' : 'Tagless only';
  const taglessBlockedByTags = hasTagSelections && hasTaglessAssets;

  return (
    <>
      {/* Scope section */}
      <div className="flex flex-col gap-3 px-3 py-3">
        <FormTitle as="span" variant="section" size="xs">
          Scope
        </FormTitle>

        <div className="flex items-center justify-between gap-1.5">
          <Checkbox
            isSelected={visibility.scopeTagless}
            disabled={!hasTaglessAssets || hasTagSelections}
            onChange={handleToggleScopeTagless}
            label={taglessLabel}
          />
          {taglessBlockedByTags ? (
            <span title="Tagless selection is not available when tags are selected. Clear the tags first.">
              <TriangleAlertIcon className="h-5 w-5 shrink-0 text-amber-500" />
            </span>
          ) : null}
        </div>

        <Checkbox
          isSelected={visibility.scopeSelected}
          disabled={selectedAssetsCount === 0}
          onChange={handleToggleScopeSelected}
          label="Show selected assets only"
        />

        <Checkbox
          isSelected={visibility.showModified}
          disabled={!hasModifiedAssets}
          onChange={handleToggleModified}
          label="Show modified assets only"
        />
      </div>

      {/* Class filter sections */}
      {sections.map((section) => (
        <ClassModeSection
          key={section.key}
          section={section}
          onSetMode={handleSetClassMode}
        />
      ))}

      <EmptyHint sections={sections} />
    </>
  );
};

const ClassModeSection = ({
  section,
  onSetMode,
}: {
  section: SectionConfig;
  onSetMode: (classKey: SectionConfig['key'], mode: ClassFilterMode) => void;
}) => {
  if (!section.available) return null;

  return (
    <>
      <SectionDivider
        icon={section.icon}
        color={section.color}
        className="my-2"
      >
        <span className="font-semibold">{section.label}</span>{' '}
        <span className="tabular-nums">{section.count}</span>
      </SectionDivider>

      <div className="mb-4 px-3">
        <SegmentedControl
          options={CLASS_MODES}
          value={section.mode}
          width="full"
          size="sm"
          onChange={(mode) => onSetMode(section.key, mode)}
        />
      </div>
    </>
  );
};

const EmptyHint = ({ sections }: { sections: SectionConfig[] }) => {
  // Exclude trigger phrases from empty hints — they're configured in project
  // settings, not selected in the filter UI
  const emptyCategories = useMemo(
    () =>
      sections
        .filter((s) => !s.available && s.key !== 'triggerPhrases')
        .map((s) => s.emptyCategory),
    [sections],
  );

  return emptyCategories.length ? (
    <>
      <div className="mt-2 h-px bg-slate-200 shadow-2xs shadow-white dark:bg-slate-500 dark:shadow-slate-800" />

      <p className="flex cursor-default px-3 py-3 text-xs text-slate-400 dark:text-slate-500">
        <InfoIcon className="h-5 w-5" />
        <span className="ml-2 flex-1">
          Select a {formatCategoryList(emptyCategories)} to filter the assets
          list by them.
        </span>
      </p>
    </>
  ) : null;
};
