import { type ReactNode, useCallback } from 'react';

import type { TrainingDefaults } from '@/app/services/training/models';
import { NumberInput } from '@/app/shared/number-input/number-input';
import type { FormState } from '@/app/store/training-config/types';

import { FieldTitle } from './field-title';

/** The FormState keys that hold a plain number — the only ones this fits. */
type NumericField = {
  [P in keyof FormState]: FormState[P] extends number ? P : never;
}[keyof FormState];

type NumberFieldProps<K extends NumericField> = {
  /** Key into FormState/FIELD_REGISTRY — drives the reset affordance. */
  field: K;
  label: ReactNode;
  value: FormState[K];
  defaults: TrainingDefaults;
  onFieldChange: <F extends keyof FormState>(
    field: F,
    value: FormState[F],
  ) => void;
  /** `int` parses with a radix-10 `parseInt`, `float` with `parseFloat`. */
  kind?: 'int' | 'float';
  min?: number;
  max?: number;
  /**
   * Extra acceptance test for values that pass `min`/`max`, for the handful of
   * fields whose bounds are exclusive (flow shift must be > 0, EMA decay must
   * sit strictly between 0 and 1).
   */
  validate?: (value: number) => boolean;
  /** Explanatory line under the input. */
  hint?: ReactNode;
  placeholder?: string;
  /** Draw native spinner buttons — see {@link NumberInput}; ints only. */
  spinner?: boolean;
  /** Spinner increment. */
  step?: number;
  className?: string;
  ariaLabel?: string;
};

/**
 * A labelled numeric form field: title, reset affordance, input and hint.
 * Editing is draft-based — see {@link NumberInput}.
 */
export function NumberField<K extends NumericField>({
  field,
  label,
  value,
  defaults,
  onFieldChange,
  kind = 'float',
  min,
  max,
  validate,
  hint,
  placeholder,
  spinner,
  step,
  className,
  ariaLabel,
}: NumberFieldProps<K>) {
  const handleChange = useCallback(
    (parsed: number) => onFieldChange(field, parsed as FormState[K]),
    [field, onFieldChange],
  );

  return (
    <div>
      <FieldTitle
        field={field}
        label={label}
        value={value}
        defaults={defaults}
        onFieldChange={onFieldChange}
      />
      <NumberInput
        value={value}
        onChange={handleChange}
        kind={kind}
        min={min}
        max={max}
        validate={validate}
        placeholder={placeholder}
        spinner={spinner}
        step={step}
        className={className}
        aria-label={ariaLabel}
      />
      {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
    </div>
  );
}
