'use client';

import {
  ChangeEvent,
  CSSProperties,
  ReactNode,
  useCallback,
  useId,
} from 'react';

import { NumberInput } from '@/app/shared/number-input/number-input';

type SliderColor = 'sky' | 'indigo' | 'teal' | 'green' | 'red' | 'amber';
type SliderSize = 'xs' | 'sm' | 'md';
type NumberInputSize = 'xs' | 'sm' | 'md';

type SliderProps = {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;

  color?: SliderColor;
  size?: SliderSize;

  /** Paint the portion of the track left of the thumb in the accent colour. */
  showTrackFill?: boolean;

  /** Labels under the track. Any combination may be provided. */
  startLabel?: ReactNode;
  midLabel?: ReactNode;
  endLabel?: ReactNode;

  /** Read-only value display rendered to the right of the track. */
  valueDisplay?: ReactNode;
  /**
   * Typeable number box to the right of the track, bound to a value that isn't
   * the slider position — e.g. a log-scaled learning rate whose slider runs
   * 0-100. Takes precedence over `valueDisplay`.
   */
  valueInput?: {
    value: number;
    onChange: (value: number) => void;
    kind?: 'int' | 'float';
    min?: number;
    max?: number;
    validate?: (value: number) => boolean;
  };

  /** Editable number input bound to the slider value, rendered to the right. */
  showNumberInput?: boolean;
  numberInputSize?: NumberInputSize;

  ariaLabel?: string;
  className?: string;
  id?: string;
};

const trackHeight: Record<SliderSize, string> = {
  xs: 'h-1.5',
  sm: 'h-2',
  md: 'h-3',
};

const thumbSizePx: Record<SliderSize, number> = {
  xs: 14,
  sm: 16,
  md: 20,
};

// Match ProgressBar fill styling so sliders sit in the same visual family.
const fillColorClasses: Record<SliderColor, string> = {
  sky: 'bg-linear-to-t from-sky-600 to-sky-500 inset-shadow-xs inset-shadow-sky-300',
  indigo:
    'bg-linear-to-t from-indigo-600 to-indigo-500 inset-shadow-xs inset-shadow-indigo-300',
  teal: 'bg-linear-to-t from-teal-600 to-teal-500 inset-shadow-xs inset-shadow-teal-300',
  green:
    'bg-linear-to-t from-green-600 to-green-500 inset-shadow-xs inset-shadow-green-300',
  red: 'bg-linear-to-t from-red-600 to-red-500 inset-shadow-xs inset-shadow-red-300',
  amber:
    'bg-linear-to-t from-amber-600 to-amber-500 inset-shadow-xs inset-shadow-amber-300',
};

// Sets currentColor on the <input>; the thumb border uses currentColor, so
// the accent colour flows through without per-browser pseudo-element classes.
const accentTextClasses: Record<SliderColor, string> = {
  sky: 'text-sky-600 dark:text-sky-400',
  indigo: 'text-indigo-600 dark:text-indigo-400',
  teal: 'text-teal-600 dark:text-teal-400',
  green: 'text-green-600 dark:text-green-400',
  red: 'text-red-600 dark:text-red-400',
  amber: 'text-amber-600 dark:text-amber-400',
};

const numberInputWidth: Record<NumberInputSize, string> = {
  xs: 'w-12',
  sm: 'w-18',
  md: 'w-24',
};

const clamp = (v: number, min: number, max: number) =>
  Math.min(max, Math.max(min, v));

export const Slider = ({
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  disabled = false,
  color = 'sky',
  size = 'sm',
  showTrackFill = false,
  startLabel,
  midLabel,
  endLabel,
  valueDisplay,
  valueInput,
  showNumberInput = false,
  numberInputSize = 'sm',
  ariaLabel,
  className = '',
  id,
}: SliderProps) => {
  const reactId = useId();
  const inputId = id ?? reactId;

  const handleRangeChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const v = parseFloat(e.target.value);
      if (!Number.isNaN(v)) onChange(v);
    },
    [onChange],
  );

  const range = max - min;
  const pct = range > 0 ? ((clamp(value, min, max) - min) / range) * 100 : 0;

  const trackH = trackHeight[size];
  const thumbPx = thumbSizePx[size];
  const accentText = accentTextClasses[color];
  const fillClasses = fillColorClasses[color];

  const hasValueColumn =
    valueDisplay !== undefined || valueInput !== undefined || showNumberInput;
  const valueColWidth = numberInputWidth[numberInputSize];
  const hasAnyLabel =
    startLabel !== undefined ||
    midLabel !== undefined ||
    endLabel !== undefined;

  const sliderVars = {
    '--slider-thumb-size': `${thumbPx}px`,
  } as CSSProperties;

  return (
    <div className={`flex flex-col ${className}`}>
      <div className="flex items-center gap-3">
        <div
          className={`relative flex-1 ${disabled ? 'opacity-60' : ''}`}
          style={{ ...sliderVars, height: `${thumbPx}px` }}
        >
          {/* Track background — same gradient/inset-shadow as ProgressBar */}
          <div
            className={`pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 overflow-hidden rounded-full bg-linear-to-t from-slate-200 to-slate-300 inset-shadow-xs inset-shadow-slate-400 dark:from-slate-700 dark:to-slate-600 dark:inset-shadow-slate-800 ${trackH}`}
          >
            {showTrackFill && (
              <div
                className={`h-full ${fillClasses}`}
                style={{ width: `${pct}%` }}
              />
            )}
          </div>

          <input
            id={inputId}
            type="range"
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={handleRangeChange}
            disabled={disabled}
            aria-label={ariaLabel}
            className={`app-slider relative block w-full ${accentText}`}
          />
        </div>

        {valueInput ? (
          <NumberInput
            value={valueInput.value}
            onChange={valueInput.onChange}
            kind={valueInput.kind}
            min={valueInput.min}
            max={valueInput.max}
            validate={valueInput.validate}
            disabled={disabled}
            size={numberInputSize}
            className={`${valueColWidth} text-center`}
            aria-label={ariaLabel ? `${ariaLabel} value` : undefined}
          />
        ) : (
          valueDisplay !== undefined && (
            <span
              className={`text-right text-sm font-medium text-(--foreground) tabular-nums ${valueColWidth}`}
            >
              {valueDisplay}
            </span>
          )
        )}

        {showNumberInput && (
          <NumberInput
            spinner={Number.isInteger(step)}
            kind={Number.isInteger(step) ? 'int' : 'float'}
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={onChange}
            disabled={disabled}
            size={numberInputSize}
            className={`${valueColWidth} text-center`}
            aria-label={ariaLabel ? `${ariaLabel} value` : undefined}
          />
        )}
      </div>

      {hasAnyLabel && (
        <div className="mt-0.5 flex items-start gap-3 text-xs text-slate-400">
          {/* Track-aligned labels: start left, end right (no mid when value column is shown) */}
          <div className="flex flex-1 justify-between">
            <span>{startLabel}</span>
            {!hasValueColumn && midLabel !== undefined && (
              <span className="font-medium text-slate-500">{midLabel}</span>
            )}
            <span>{endLabel}</span>
          </div>

          {/* Mid label sits under the value/input column when present */}
          {hasValueColumn && midLabel !== undefined && (
            <span
              className={`text-center font-medium text-slate-500 ${valueColWidth}`}
            >
              {midLabel}
            </span>
          )}
        </div>
      )}
    </div>
  );
};
