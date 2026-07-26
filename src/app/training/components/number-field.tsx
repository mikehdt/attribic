import { type ReactNode, useCallback, useState } from 'react';

import type { TrainingDefaults } from '@/app/services/training/models';
import { Input } from '@/app/shared/input/input';
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
  className?: string;
  ariaLabel?: string;
};

/**
 * A labelled numeric form field: title, reset affordance, input and hint.
 *
 * Editing is draft-based. These inputs previously committed straight to the
 * store behind a `parseFloat` guard that dropped anything not already a valid
 * number — which made the field fight you mid-edit, because clearing it or
 * typing an intermediate value like `0.` or `1e-` parses to nothing and the
 * rejected keystroke never reached the DOM. Instead the raw text is held
 * locally while the field is being edited and pushed to the store on every
 * keystroke that parses to an in-range number; blurring drops the draft so the
 * display snaps back to whatever the store actually holds. Abandoning a field
 * mid-edit therefore restores the last valid value rather than leaving it empty.
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
  className = 'w-full tabular-nums',
  ariaLabel,
}: NumberFieldProps<K>) {
  const [draft, setDraft] = useState<string | null>(null);

  const handleChange = useCallback(
    (raw: string) => {
      setDraft(raw);
      const parsed = kind === 'int' ? parseInt(raw, 10) : parseFloat(raw);
      if (!Number.isFinite(parsed)) return;
      if (min !== undefined && parsed < min) return;
      if (max !== undefined && parsed > max) return;
      if (validate && !validate(parsed)) return;
      onFieldChange(field, parsed as FormState[K]);
    },
    [field, kind, max, min, onFieldChange, validate],
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
      <Input
        type="text"
        inputMode={kind === 'int' ? 'numeric' : 'decimal'}
        value={draft ?? String(value)}
        onChange={(e) => handleChange(e.target.value)}
        onBlur={() => setDraft(null)}
        placeholder={placeholder}
        className={className}
        aria-label={ariaLabel}
      />
      {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
    </div>
  );
}
