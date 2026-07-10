import type { PreferencesState, TrainingViewMode } from './types';
import { TagEditMode, type ThemeMode } from './types';

const STORAGE_KEY = 'preferences';
const LEGACY_THEME_KEY = 'theme-preference';

/**
 * Cookie mirror of the preferences state. Written alongside localStorage on
 * every save so the server (root layout) can read the user's real preferences
 * and render them into the first HTML — avoiding a post-mount hydration flip.
 * Local-only app: no privacy/size concerns beyond the 4KB cookie limit.
 */
export const PREFERENCES_COOKIE = 'img-tagger-preferences';
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365; // one year

const VALID_THEMES = ['light', 'dark', 'auto'];
const VALID_EDIT_MODES = Object.values(TagEditMode);
const VALID_VIEW_MODES: TrainingViewMode[] = [
  'simple',
  'intermediate',
  'advanced',
  'expert',
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

/**
 * Sanitise an untrusted parsed object into a complete, valid PreferencesState,
 * falling back to defaults for any missing or invalid field. Shared by the
 * localStorage and cookie readers so both apply identical validation.
 */
const sanitisePreferences = (parsed: unknown): PreferencesState => {
  const o = (parsed ?? {}) as Record<string, unknown>;
  return {
    theme: VALID_THEMES.includes(o.theme as string)
      ? (o.theme as ThemeMode)
      : preferenceDefaults.theme,
    tagEditMode: VALID_EDIT_MODES.includes(o.tagEditMode as TagEditMode)
      ? (o.tagEditMode as TagEditMode)
      : preferenceDefaults.tagEditMode,
    trainingViewMode: VALID_VIEW_MODES.includes(
      o.trainingViewMode as TrainingViewMode,
    )
      ? (o.trainingViewMode as TrainingViewMode)
      : preferenceDefaults.trainingViewMode,
    keepTaggerModelInMemory:
      typeof o.keepTaggerModelInMemory === 'boolean'
        ? o.keepTaggerModelInMemory
        : preferenceDefaults.keepTaggerModelInMemory,
  };
};

/**
 * Parse a JSON preferences string (from localStorage or a cookie) into a
 * validated state. Returns defaults on missing/corrupt input. Pure and
 * server-safe — no `window` access.
 */
export const parsePreferences = (
  raw: string | null | undefined,
): PreferencesState => {
  if (!raw) return preferenceDefaults;
  try {
    return sanitisePreferences(JSON.parse(raw));
  } catch {
    return preferenceDefaults;
  }
};

/**
 * Parse preferences from a cookie value (URL-encoded JSON). Safe to call on
 * the server. Decodes only when the value looks percent-encoded — validated
 * JSON never contains `%`, so this is a no-op when Next has already decoded.
 */
export const parsePreferencesCookie = (
  value: string | null | undefined,
): PreferencesState => {
  if (!value) return preferenceDefaults;
  const json = value.includes('%') ? decodeURIComponent(value) : value;
  return parsePreferences(json);
};

/** Read preferences from localStorage, migrating the legacy theme key if present. */
export const loadPreferences = (): PreferencesState => {
  if (typeof window === 'undefined') return preferenceDefaults;

  try {
    const raw = localStorage.getItem(STORAGE_KEY);

    if (raw) {
      return parsePreferences(raw);
    }

    // Migrate legacy theme key
    const legacyTheme = localStorage.getItem(LEGACY_THEME_KEY);
    if (legacyTheme && VALID_THEMES.includes(legacyTheme)) {
      const state: PreferencesState = {
        ...preferenceDefaults,
        theme: legacyTheme as ThemeMode,
      };
      savePreferences(state);
      localStorage.removeItem(LEGACY_THEME_KEY);
      return state;
    }
  } catch {
    // Corrupt data — fall through to defaults
  }

  return preferenceDefaults;
};

/**
 * Persist preferences to localStorage (primary) and mirror to a cookie so the
 * server can seed the store on the next load. Both hold the same JSON shape so
 * one parser (`parsePreferences`) serves both.
 */
export const savePreferences = (state: PreferencesState): void => {
  const json = JSON.stringify(state);

  try {
    localStorage.setItem(STORAGE_KEY, json);
  } catch {
    // Storage full or unavailable — silently ignore
  }

  try {
    document.cookie = `${PREFERENCES_COOKIE}=${encodeURIComponent(json)}; path=/; max-age=${COOKIE_MAX_AGE_SECONDS}; samesite=lax`;
  } catch {
    // Document/cookie unavailable — silently ignore
  }
};
