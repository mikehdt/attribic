import { useCallback, useEffect, useRef, useState } from 'react';

export type ResolutionMode = 'bucketed' | 'native';

/**
 * Which of the two mutually exclusive resolution controls is in play.
 *
 * The form has no mode field — an empty `nativeResolution` *is* bucketed mode
 * — so the mode is local state seeded from the value rather than derived from
 * it on every render: clearing the text mid-edit would otherwise snap the
 * radio back to bucketed and swap the control out from under the caret.
 *
 * Values arriving from anywhere else (project load, section reset, provider
 * switch) still win, so the radio follows the form; only this section's own
 * edits are exempt.
 */
export function useResolutionMode(
  nativeResolution: string,
  onNativeResolutionChange: (value: string) => void,
) {
  const [mode, setMode] = useState<ResolutionMode>(
    nativeResolution.trim().length > 0 ? 'native' : 'bucketed',
  );
  // Set when this section is the source of the change, so the sync below can
  // tell an external value apart from the user's own typing.
  const selfEdit = useRef(false);

  useEffect(() => {
    if (selfEdit.current) {
      selfEdit.current = false;
      return;
    }
    setMode(nativeResolution.trim().length > 0 ? 'native' : 'bucketed');
  }, [nativeResolution]);

  const setNativeResolution = useCallback(
    (value: string) => {
      if (value === nativeResolution) return;
      selfEdit.current = true;
      onNativeResolutionChange(value);
    },
    [nativeResolution, onNativeResolutionChange],
  );

  /**
   * Switch mode. Bucketed clears the exact size; native seeds `fallback` when
   * there's nothing to switch back to, so the choice sticks rather than
   * bouncing off an empty value.
   */
  const selectMode = useCallback(
    (next: ResolutionMode, fallback: string) => {
      setMode(next);
      if (next === 'bucketed') {
        setNativeResolution('');
      } else if (nativeResolution.trim().length === 0) {
        setNativeResolution(fallback);
      }
    },
    [nativeResolution, setNativeResolution],
  );

  return { mode, selectMode, setNativeResolution };
}
