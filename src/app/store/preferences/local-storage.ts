import type { PreferencesState, TrainingViewMode } from './types';
import { TagEditMode, type ThemeMode } from './types';

const STORAGE_KEY = 'preferences';
const LEGACY_THEME_KEY = 'theme-preference';

const VALID_THEMES = ['light', 'dark', 'auto'];
const VALID_EDIT_MODES = Object.values(TagEditMode);
const VALID_VIEW_MODES: TrainingViewMode[] = [
  'simple',
  'intermediate',
  'advanced',
];

/**
 * Deterministic default preferences. Used as the Redux initial state on BOTH
 * server and client so the first client render matches the server HTML — the
 * persisted values are applied after mount (see `hydratePreferences`). Reading
 * localStorage into the initial state instead would make the client's first
 * render diverge from the server's and trip hydration mismatches app-wide.
 */
export const preferenceDefaults: PreferencesState = {
  theme: 'auto',
  tagEditMode: TagEditMode.BUTTON,
  trainingViewMode: 'intermediate',
  keepTaggerModelInMemory: true,
};

/** Read preferences from localStorage, migrating the legacy theme key if present. */
export const loadPreferences = (): PreferencesState => {
  if (typeof window === 'undefined') return preferenceDefaults;

  try {
    const raw = localStorage.getItem(STORAGE_KEY);

    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        theme: VALID_THEMES.includes(parsed.theme)
          ? (parsed.theme as ThemeMode)
          : preferenceDefaults.theme,
        tagEditMode: VALID_EDIT_MODES.includes(parsed.tagEditMode)
          ? parsed.tagEditMode
          : preferenceDefaults.tagEditMode,
        trainingViewMode: VALID_VIEW_MODES.includes(parsed.trainingViewMode)
          ? (parsed.trainingViewMode as TrainingViewMode)
          : preferenceDefaults.trainingViewMode,
        keepTaggerModelInMemory:
          typeof parsed.keepTaggerModelInMemory === 'boolean'
            ? parsed.keepTaggerModelInMemory
            : preferenceDefaults.keepTaggerModelInMemory,
      };
    }

    // Migrate legacy theme key
    const legacyTheme = localStorage.getItem(LEGACY_THEME_KEY);
    if (legacyTheme && VALID_THEMES.includes(legacyTheme)) {
      const state: PreferencesState = {
        ...preferenceDefaults,
        theme: legacyTheme as ThemeMode,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      localStorage.removeItem(LEGACY_THEME_KEY);
      return state;
    }
  } catch {
    // Corrupt data — fall through to defaults
  }

  return preferenceDefaults;
};

/** Write preferences to localStorage. */
export const savePreferences = (state: PreferencesState): void => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage full or unavailable — silently ignore
  }
};
