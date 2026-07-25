/**
 * Folder-name rules for newly created tagging projects.
 *
 * Shared by the create-project form and the server action behind it so the
 * inline feedback matches what the server will actually accept. The rules are
 * Windows' — the strictest of the platforms this runs on — so a name that
 * validates here is safe to `mkdir` anywhere.
 */

export const MAX_FOLDER_NAME_LENGTH = 64;

/** Path separators plus the characters Windows reserves in a path segment. */
const INVALID_CHARS = /[<>:"/\\|?*]/;

/** Control codes are invalid in a path segment; checked without a regex. */
const hasControlChar = (value: string): boolean =>
  Array.from(value).some((char) => char.charCodeAt(0) < 32);

const RESERVED_NAMES = new Set([
  'con',
  'prn',
  'aux',
  'nul',
  ...Array.from({ length: 9 }, (_, i) => `com${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `lpt${i + 1}`),
]);

/**
 * Validate a project folder name. Returns an error message to show against the
 * field, or null when the name is acceptable.
 */
export const validateProjectFolderName = (name: string): string | null => {
  const trimmed = name.trim();

  if (!trimmed) return 'Enter a folder name.';

  if (trimmed.length > MAX_FOLDER_NAME_LENGTH) {
    return `Keep the folder name to ${MAX_FOLDER_NAME_LENGTH} characters or fewer.`;
  }

  if (INVALID_CHARS.test(trimmed) || hasControlChar(trimmed)) {
    return 'Folder names cannot contain \\ / : * ? " < > or |';
  }

  // Leading dots are how this app marks its own metadata folders (`.tagging`,
  // `.training`), and most tools treat them as hidden.
  if (trimmed.startsWith('.')) {
    return 'Folder names cannot start with a dot.';
  }

  if (/[. ]$/.test(trimmed)) {
    return 'Folder names cannot end with a dot or a space.';
  }

  if (RESERVED_NAMES.has(trimmed.toLowerCase())) {
    return `“${trimmed}” is a reserved device name on Windows.`;
  }

  return null;
};
