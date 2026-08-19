'use client';

import {
  type ChangeEvent,
  type FocusEvent,
  forwardRef,
  type InputHTMLAttributes,
  useCallback,
  useState,
} from 'react';

import { Input, type InputSize } from '@/app/shared/input/input';

type NumberInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'size' | 'type' | 'value' | 'onChange' | 'min' | 'max' | 'step'
> & {
  value: number;
  /** Fires only for text that parses to an accepted number. */
  onChange: (value: number) => void;
  /** `int` parses with a radix-10 `parseInt`, `float` with `parseFloat`. */
  kind?: 'int' | 'float';
  min?: number;
  max?: number;
  /**
   * Extra acceptance test for values that already pass `min`/`max`, for fields
   * whose bounds are exclusive (flow shift must be > 0, EMA decay must sit
   * strictly between 0 and 1).
   */
  validate?: (value: number) => boolean;
  /**
   * Render as a native `type="number"` so the browser draws spinner buttons.
   * Best kept for integers — a number input reports intermediate decimal text
   * like `0.` as an empty string, which makes float editing feel lossy.
   */
  spinner?: boolean;
  step?: number;
  size?: InputSize;
};

/**
 * Text shapes a numeric draft is allowed to pass through on its way to a
 * number: digits, one decimal point and an exponent for floats, digits alone
 * for ints, plus a leading `-` where negatives are in range. Deliberately
 * looser than "parses to a number" so partial entries like `0.`, `1e-` and an
 * empty field survive; anything outside these shapes never reaches the input.
 */
const DRAFT_SHAPES = {
  int: { signed: /^-?\d*$/, unsigned: /^\d*$/ },
  float: {
    signed: /^-?\d*\.?\d*(?:[eE][-+]?\d*)?$/,
    unsigned: /^\d*\.?\d*(?:[eE][-+]?\d*)?$/,
  },
} as const;

/**
 * A numeric text input that can be emptied mid-edit without fighting you.
 *
 * Committing straight to the store behind a `parseFloat` guard drops anything
 * that isn't already a valid number, so clearing the field — or typing an
 * intermediate value like `0.` or `1e-` — snaps the display back to the old
 * value and the keystroke never lands. That makes replacing a value (`10` to
 * `50`) needlessly fiddly, because the last digit can't be erased.
 *
 * Instead the raw text is held locally while the field is being edited and
 * pushed to the consumer on every keystroke that parses to an accepted number.
 * Keystrokes that would put non-numeric text in the field are refused outright
 * rather than held in the draft and stripped later, so a typo never shows as
 * text the field is going to silently discard. Values that are numeric but out
 * of range are still allowed to sit in the draft — `5` has to be typeable on
 * the way to `50` in a field with a minimum of 10.
 *
 * Blurring drops the draft so the display snaps back to whatever the consumer
 * actually holds — abandoning a field mid-edit restores the last valid value
 * rather than leaving it empty.
 */
export const NumberInput = forwardRef<HTMLInputElement, NumberInputProps>(
  (
    {
      value,
      onChange,
      kind = 'float',
      min,
      max,
      validate,
      spinner = false,
      step,
      onBlur,
      ...props
    },
    ref,
  ) => {
    const [draft, setDraft] = useState<string | null>(null);

    const handleChange = useCallback(
      (e: ChangeEvent<HTMLInputElement>) => {
        const el = e.target;
        const raw = el.value;

        // Negatives are only typeable where they're actually in range.
        const negatable = min === undefined || min < 0;
        const shape = DRAFT_SHAPES[kind][negatable ? 'signed' : 'unsigned'];
        if (!shape.test(raw)) {
          // Refuse the edit: put the previous text back and leave the caret
          // where the rejected characters would have gone. Rewriting the DOM
          // value is enough because state hasn't changed, so React won't
          // re-render over it.
          const restored = draft ?? String(value);
          el.value = restored;
          if (!spinner) {
            const typed = (el.selectionStart ?? raw.length) - raw.length;
            const caret = Math.max(0, restored.length + typed);
            el.setSelectionRange(caret, caret);
          }
          return;
        }

        setDraft(raw);
        const parsed = kind === 'int' ? parseInt(raw, 10) : parseFloat(raw);
        if (!Number.isFinite(parsed)) return;
        if (min !== undefined && parsed < min) return;
        if (max !== undefined && parsed > max) return;
        if (validate && !validate(parsed)) return;
        onChange(parsed);
      },
      [draft, kind, max, min, onChange, spinner, validate, value],
    );

    const handleBlur = useCallback(
      (e: FocusEvent<HTMLInputElement>) => {
        setDraft(null);
        onBlur?.(e);
      },
      [onBlur],
    );

    return (
      <Input
        ref={ref}
        type={spinner ? 'number' : 'text'}
        inputMode={kind === 'int' ? 'numeric' : 'decimal'}
        // Bounds are enforced in `handleChange`; the attributes only exist to
        // drive the native spinner, so a text input shouldn't carry them.
        {...(spinner ? { min, max, step } : {})}
        value={draft ?? String(value)}
        onChange={handleChange}
        onBlur={handleBlur}
        className="tabular-nums"
        {...props}
      />
    );
  },
);

NumberInput.displayName = 'NumberInput';
