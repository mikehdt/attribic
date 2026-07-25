/**
 * Most-recently-opened training projects, persisted to localStorage.
 *
 * Only the identity is stored (id + version + when) — never the name. Display
 * text is resolved against a fresh project list at render time, so a rename
 * can't leave a stale label behind and a project that has since been deleted
 * simply drops out of the list.
 */

const RECENTS_KEY = 'img-tagger:training-recent-projects';

/** How many entries are kept on disk. The menu shows fewer (see the popup). */
const MAX_STORED = 6;

export type RecentProject = {
  id: string;
  /** The version that was open. Falls back to latest if it's since been deleted. */
  version: number;
  /** ISO timestamp of the visit, newest first in the stored list. */
  at: string;
};

function read(): RecentProject[] {
  try {
    const raw = localStorage.getItem(RECENTS_KEY);
    if (!raw) return [];
    const list: unknown = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    return list.filter(
      (e): e is RecentProject =>
        !!e &&
        typeof e.id === 'string' &&
        typeof e.version === 'number' &&
        typeof e.at === 'string',
    );
  } catch {
    return [];
  }
}

function write(list: RecentProject[]): void {
  try {
    if (list.length === 0) {
      localStorage.removeItem(RECENTS_KEY);
    } else {
      localStorage.setItem(RECENTS_KEY, JSON.stringify(list));
    }
  } catch {
    // localStorage may be unavailable (SSR, private browsing)
  }
}

/** The stored list, newest first. */
export function loadRecentProjects(): RecentProject[] {
  return read();
}

/**
 * Move a project to the front of the list, recording the version that was
 * open. One entry per project — reopening it updates the version rather than
 * adding a duplicate.
 */
export function recordRecentProject(id: string, version: number): void {
  const at = new Date().toISOString();
  const rest = read().filter((e) => e.id !== id);
  write([{ id, version, at }, ...rest].slice(0, MAX_STORED));
}

/** Drop a project from the list — used when it's deleted from disk. */
export function forgetRecentProject(id: string): void {
  write(read().filter((e) => e.id !== id));
}
