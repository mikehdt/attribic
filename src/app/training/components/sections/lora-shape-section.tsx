import { Link2Icon, Unlink2Icon } from 'lucide-react';
import { memo, useCallback } from 'react';

import type { TrainingDefaults } from '@/app/services/training/models';
import { Button } from '@/app/shared/button/button';
import { CollapsibleSection } from '@/app/shared/collapsible-section';
import { Dropdown, type DropdownItem } from '@/app/shared/dropdown';
import { FormTitle } from '@/app/shared/form-title/form-title';
import { Input } from '@/app/shared/input/input';
import { Slider } from '@/app/shared/slider/slider';

import { FieldTitle } from '../field-title';
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
  scaleWeightNorms: number;
  networkArgs: string;
  lokrFactor: number;
  layerTargeting: string;
  hasChanges: boolean;
  defaults: TrainingDefaults;
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
  scaleWeightNorms,
  networkArgs,
  lokrFactor,
  layerTargeting,
  hasChanges,
  defaults,
  visibleFields,
  hiddenChangesCount,
  onFieldChange,
  onReset,
}: LoraShapeSectionProps) => {
  const hasVisibleFields =
    visibleFields.has('networkDim') ||
    visibleFields.has('networkAlpha') ||
    visibleFields.has('networkType') ||
    visibleFields.has('networkDropout') ||
    visibleFields.has('scaleWeightNorms') ||
    visibleFields.has('networkArgs') ||
    visibleFields.has('lokrFactor') ||
    visibleFields.has('layerTargeting');

  // Lightweight shape check for the raw network_args editor: each
  // whitespace-separated chunk should look like key=value. Non-blocking —
  // just surfaces an inline hint (the sidecar silently drops bad chunks).
  const networkArgsInvalid =
    networkArgs.trim() !== '' &&
    networkArgs
      .trim()
      .split(/\s+/)
      .some((chunk) => !/^[^=\s]+=[^=\s]*$/.test(chunk));

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

  // Reset-to-default for Rank/Alpha routes through the same linked-value
  // handlers as manual edits, so resetting one keeps the pair in sync when
  // they're linked.
  const handleNetworkDimReset = useCallback(
    (_field: 'networkDim', value: number) => handleRankChange(value),
    [handleRankChange],
  );

  const handleNetworkAlphaReset = useCallback(
    (_field: 'networkAlpha', value: number) => handleAlphaChange(value),
    [handleAlphaChange],
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
          visibleFields.has('networkDropout' satisfies keyof FormState) ||
          visibleFields.has('lokrFactor' satisfies keyof FormState) ||
          visibleFields.has('scaleWeightNorms' satisfies keyof FormState)) && (
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
                <FieldTitle
                  field="networkDropout"
                  label="Dropout"
                  value={networkDropout}
                  defaults={defaults}
                  onFieldChange={onFieldChange}
                />
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

            {visibleFields.has(
              'scaleWeightNorms' satisfies keyof FormState,
            ) && (
              <div>
                <FieldTitle
                  field="scaleWeightNorms"
                  label="Max Weight Norm"
                  value={scaleWeightNorms}
                  defaults={defaults}
                  onFieldChange={onFieldChange}
                />
                <Input
                  type="text"
                  value={scaleWeightNorms}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value);
                    if (!isNaN(val) && val >= 0)
                      onFieldChange('scaleWeightNorms', val);
                  }}
                  placeholder="0"
                  className="w-full tabular-nums"
                />
                <p className="mt-1 text-xs text-slate-400">
                  Caps LoRA weight norms; 1.0 typical, 0 = disabled
                </p>
              </div>
            )}

            {visibleFields.has('lokrFactor' satisfies keyof FormState) && (
              <div>
                <FieldTitle
                  field="lokrFactor"
                  label="LoKr Factor"
                  value={lokrFactor}
                  defaults={defaults}
                  onFieldChange={onFieldChange}
                />
                <Input
                  type="number"
                  min={-1}
                  value={lokrFactor}
                  onChange={(e) => {
                    const val = parseInt(e.target.value, 10);
                    if (!isNaN(val) && val >= -1)
                      onFieldChange('lokrFactor', val);
                  }}
                  placeholder="-1"
                  className="w-full tabular-nums"
                />
                <p className="mt-1 text-xs text-slate-400">
                  -1 = auto (largest factor)
                </p>
              </div>
            )}
          </div>
        )}

        {/* Rank + Alpha sliders */}
        <div className="flex items-end gap-2">
          {visibleFields.has('networkDim' satisfies keyof FormState) && (
            <div className="flex-1">
              <FieldTitle
                field="networkDim"
                label="Rank (dim)"
                value={networkDim}
                defaults={defaults}
                onFieldChange={handleNetworkDimReset}
              />
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
              <FieldTitle
                field="networkAlpha"
                label="Alpha"
                value={networkAlpha}
                defaults={defaults}
                onFieldChange={handleNetworkAlphaReset}
              />
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

        {visibleFields.has('layerTargeting' satisfies keyof FormState) && (
          <div>
            <FieldTitle
              field="layerTargeting"
              label="Layer Targeting"
              value={layerTargeting}
              defaults={defaults}
              onFieldChange={onFieldChange}
            />
            <Input
              type="text"
              value={layerTargeting}
              onChange={(e) => onFieldChange('layerTargeting', e.target.value)}
              placeholder="e.g. attn, ff"
              className="w-full"
            />
            <p className="mt-1 text-xs text-slate-400">
              Restrict training to layers whose names contain these strings
              (comma-separated).
            </p>
          </div>
        )}

        {visibleFields.has('networkArgs' satisfies keyof FormState) && (
          <div>
            <FieldTitle
              field="networkArgs"
              label="Network Args"
              value={networkArgs}
              defaults={defaults}
              onFieldChange={onFieldChange}
            />
            <Input
              type="text"
              value={networkArgs}
              onChange={(e) => onFieldChange('networkArgs', e.target.value)}
              placeholder="conv_dim=4 conv_alpha=1"
              className="w-full"
            />
            <p className="mt-1 text-xs text-slate-400">
              Raw network_args key=value pairs, space-separated (e.g. conv_dim=4
              conv_alpha=1).
            </p>
            {networkArgsInvalid && (
              <p className="mt-1 text-xs text-amber-500/70">
                Each entry should be key=value; malformed entries are ignored.
              </p>
            )}
          </div>
        )}
      </div>
    </CollapsibleSection>
  );
};

export const LoraShapeSection = memo(LoraShapeSectionComponent);
