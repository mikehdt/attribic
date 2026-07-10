import { type ReactNode, useCallback } from 'react';

import { FIELD_REGISTRY } from '@/app/services/training/field-registry';
import type { TrainingDefaults } from '@/app/services/training/models';
import { FormTitle } from '@/app/shared/form-title/form-title';
import type { FormState } from '@/app/store/training-config/types';

import { FieldResetButton } from './field-reset-button';

type FormTitleVariant = 'field' | 'section';
type FormTitleSize = 'xs' | 'sm' | 'md';

type FieldTitleProps<K extends keyof FormState> = {
  /** Key into FormState/FIELD_REGISTRY — drives the reset-affordance lookup. */
  field: K;
  label: ReactNode;
  value: FormState[K];
  defaults: TrainingDefaults;
  onFieldChange: (field: K, value: FormState[K]) => void;
  variant?: FormTitleVariant;
  size?: FormTitleSize;
  className?: string;
};

/**
 * Loose equality for comparing a field's current value against its model
 * default. Handles the two shapes that trip up strict `===`:
 *  - arrays (only `resolution` today) — compared by JSON contents
 *  - numeric values that arrive as strings from an input's raw event value —
 *    coerced with `Number()` so "0.0001" matches 0.0001
 */
function valuesDiffer(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return JSON.stringify(a) !== JSON.stringify(b);
  }
  const aIsNumeric =
    typeof a === 'number' || (typeof a === 'string' && a.trim() !== '');
  const bIsNumeric =
    typeof b === 'number' || (typeof b === 'string' && b.trim() !== '');
  if (
    aIsNumeric &&
    bIsNumeric &&
    (typeof a === 'number' || typeof b === 'number') &&
    !Number.isNaN(Number(a)) &&
    !Number.isNaN(Number(b))
  ) {
    return Number(a) !== Number(b);
  }
  return a !== b;
}

/**
 * `FormTitle` plus a per-field reset-to-default affordance. A field only
 * gets the affordance when its `FIELD_REGISTRY` entry has a non-null
 * `defaultKey` — fields with no model default (seed, output name, duration
 * mode, etc.) are automatically excluded, so callers never hand-pick which
 * fields qualify.
 */
export function FieldTitle<K extends keyof FormState>({
  field,
  label,
  value,
  defaults,
  onFieldChange,
  variant,
  size,
  className,
}: FieldTitleProps<K>) {
  const defaultKey = FIELD_REGISTRY[field as string]?.defaultKey ?? null;
  const defaultValue = defaultKey ? defaults[defaultKey] : undefined;
  const showReset = defaultKey !== null && valuesDiffer(value, defaultValue);

  const handleReset = useCallback(() => {
    if (defaultKey) onFieldChange(field, defaultValue as FormState[K]);
  }, [defaultKey, defaultValue, field, onFieldChange]);

  return (
    <div className={`mb-1 flex items-center gap-1 ${className ?? ''}`}>
      <FormTitle variant={variant} size={size} className="block">
        {label}
      </FormTitle>
      {showReset && <FieldResetButton onClick={handleReset} />}
    </div>
  );
}
