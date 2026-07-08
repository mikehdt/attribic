import { Link2Icon, Unlink2Icon } from 'lucide-react';
import { memo, useCallback } from 'react';

import { Button } from '@/app/shared/button/button';
import { CollapsibleSection } from '@/app/shared/collapsible-section';
import { Dropdown, type DropdownItem } from '@/app/shared/dropdown';
import { FormTitle } from '@/app/shared/form-title/form-title';
import { Input } from '@/app/shared/input/input';
import { Slider } from '@/app/shared/slider/slider';

import type {
  FormState,
  SectionName,
} from '../training-config-form/use-training-config-form';
import { SectionResetButton } from './section-reset-button';

type LoraShapeSectionProps = {
  networkType: 'lora' | 'lokr';
  networkDim: number;
  networkAlpha: number;
  networkDimAlphaLinked: boolean;
  networkDropout: number;
  hasChanges: boolean;
  visibleFields: Set<string>;
  hiddenChangesCount?: number;
  onFieldChange: <K extends keyof FormState>(
    field: K,
    value: FormState[K],
  ) => void;
  onReset: (section: SectionName) => void;
};

const NETWORK_TYPE_ITEMS: DropdownItem<string>[] = [
  { value: 'lora', label: 'LoRA' },
  { value: 'lokr', label: 'LoKr' },
];

const LoraShapeSectionComponent = ({
  networkType,
  networkDim,
  networkAlpha,
  networkDimAlphaLinked,
  networkDropout,
  hasChanges,
  visibleFields,
  hiddenChangesCount,
  onFieldChange,
  onReset,
}: LoraShapeSectionProps) => {
  const hasVisibleFields =
    visibleFields.has('networkDim') ||
    visibleFields.has('networkAlpha') ||
    visibleFields.has('networkType') ||
    visibleFields.has('networkDropout');

  const handleRankChange = useCallback(
    (v: number) => {
      onFieldChange('networkDim', v);
      if (networkDimAlphaLinked) onFieldChange('networkAlpha', v);
    },
    [networkDimAlphaLinked, onFieldChange],
  );

  const handleAlphaChange = useCallback(
    (v: number) => {
      onFieldChange('networkAlpha', v);
      if (networkDimAlphaLinked) onFieldChange('networkDim', v);
    },
    [networkDimAlphaLinked, onFieldChange],
  );

  const toggleLinked = useCallback(() => {
    const next = !networkDimAlphaLinked;
    onFieldChange('networkDimAlphaLinked', next);
    // On re-link, Rank wins — snap Alpha to match.
    if (next && networkAlpha !== networkDim) {
      onFieldChange('networkAlpha', networkDim);
    }
  }, [networkDimAlphaLinked, networkAlpha, networkDim, onFieldChange]);

  if (!hasVisibleFields) return null;

  return (
    <CollapsibleSection
      title="LoRA Shape"
      headerExtra={
        <>
          {hasChanges && (
            <span className="h-1.5 w-1.5 rounded-full bg-sky-500" />
          )}
          {hiddenChangesCount ? (
            <span className="text-xs text-amber-500/70">
              {hiddenChangesCount} hidden{' '}
              {hiddenChangesCount === 1 ? 'setting' : 'settings'} customised
            </span>
          ) : undefined}
        </>
      }
      headerActions={(expanded) =>
        hasChanges && expanded ? (
          <SectionResetButton onClick={() => onReset('loraShape')} />
        ) : undefined
      }
    >
      <div className="space-y-3">
        {/* Type + Dropout row */}
        {(visibleFields.has('networkType' satisfies keyof FormState) ||
          visibleFields.has('networkDropout' satisfies keyof FormState)) && (
          <div className="grid grid-cols-4 gap-x-4 gap-y-3">
            {visibleFields.has('networkType' satisfies keyof FormState) && (
              <div>
                <FormTitle>Type</FormTitle>
                <Dropdown
                  items={NETWORK_TYPE_ITEMS}
                  selectedValue={networkType}
                  onChange={(val) =>
                    onFieldChange(
                      'networkType',
                      val as FormState['networkType'],
                    )
                  }
                  aria-label="Network type"
                />
              </div>
            )}

            {visibleFields.has('networkDropout' satisfies keyof FormState) && (
              <div>
                <FormTitle>Dropout</FormTitle>
                <Input
                  type="text"
                  value={networkDropout}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value);
                    if (!isNaN(val) && val >= 0 && val <= 1) {
                      onFieldChange('networkDropout', val);
                    }
                  }}
                  placeholder="0"
                  className="w-full tabular-nums"
                />
                <p className="mt-1 text-xs text-slate-400">
                  0 = disabled, 0.1–0.3 typical
                </p>
              </div>
            )}
          </div>
        )}

        {/* Rank + Alpha sliders */}
        <div className="flex items-end gap-2">
          {visibleFields.has('networkDim' satisfies keyof FormState) && (
            <div className="flex-1">
              <FormTitle>Rank (dim)</FormTitle>
              <Slider
                min={1}
                max={128}
                step={1}
                value={networkDim}
                onChange={handleRankChange}
                showTrackFill
                showNumberInput
                ariaLabel="Rank"
              />
            </div>
          )}

          {visibleFields.has('networkDim' satisfies keyof FormState) &&
            visibleFields.has('networkAlpha' satisfies keyof FormState) && (
              <div className="pb-0.5">
                <Button
                  variant="ghost"
                  size="sm"
                  width="sm"
                  color={networkDimAlphaLinked ? 'sky' : 'slate'}
                  isPressed={networkDimAlphaLinked}
                  onClick={toggleLinked}
                  title={
                    networkDimAlphaLinked
                      ? 'Rank and Alpha are linked — click to edit independently'
                      : 'Rank and Alpha are unlinked — click to re-link (Alpha snaps to Rank)'
                  }
                >
                  {networkDimAlphaLinked ? (
                    <Link2Icon className="h-4 w-4" />
                  ) : (
                    <Unlink2Icon className="h-4 w-4" />
                  )}
                </Button>
              </div>
            )}

          {visibleFields.has('networkAlpha' satisfies keyof FormState) && (
            <div className="flex-1">
              <FormTitle>Alpha</FormTitle>
              <Slider
                min={1}
                max={128}
                step={1}
                value={networkAlpha}
                onChange={handleAlphaChange}
                showTrackFill
                showNumberInput
                ariaLabel="Alpha"
              />
            </div>
          )}
        </div>

        <p className="text-xs text-slate-400">
          Higher rank = more expressive, but uses more VRAM and can overfit
        </p>
      </div>
    </CollapsibleSection>
  );
};

export const LoraShapeSection = memo(LoraShapeSectionComponent);
