/**
 * Thunks for saving, loading, and managing training projects on disk.
 *
 * Each thunk wraps a REST call to `/api/training/projects/*` and then
 * dispatches the slice action that updates the in-memory state (loaded
 * project pointer, baseline snapshot for dirty tracking, etc.).
 */

import type {
  TrainingProjectMeta,
  TrainingProjectSummary,
  TrainingProjectVersion,
} from '@/app/services/training-projects/disk-schema';
import { fetchJson, isJsonStatus } from '@/app/utils/fetch-json';
import {
  getProjectFolderHistograms,
  scanDatasetFolders,
} from '@/app/utils/project-actions';

import type { AppThunk } from '../index';
import { addToast } from '../toasts';
import {
  clearLoadedProject,
  hydrateFromProject,
  reconcileDatasetFolders,
  setDatasetHistogram,
  stampSaved,
} from './index';
import { forgetRecentProject, recordRecentProject } from './recent-projects';
import type { FormState, LoadedProject } from './types';

type ProjectResponse = {
  meta: TrainingProjectMeta;
  version: TrainingProjectVersion;
};

/**
 * Build the loaded-project pointer for a project we've just opened or saved,
 * and stamp it as recently used. Every path that points the form at a project
 * on disk funnels through here, so the Recent Projects list can't miss one.
 */
function adoptProject(
  meta: TrainingProjectMeta,
  version: TrainingProjectVersion,
): LoadedProject {
  recordRecentProject(meta.id, version.version);
  return {
    id: meta.id,
    name: meta.name,
    version: version.version,
    versionLabel: version.label,
    savedAt: version.savedAt,
  };
}

// --- Disk scans (derived from disk, never persisted) ---

/**
 * Read one attached dataset off disk: which folders exist, how many images
 * each holds, and the image sizes across them.
 *
 * A saved config records which folders to train on and how to weight them; it
 * doesn't record what's inside them, so everything descriptive is stripped on
 * save and re-read here. Without this the form would render a folder list, per
 * folder image counts, step totals and a bucket preview describing the project
 * as it looked at some arbitrary point in the past — all of it presented as
 * current, and none of it invalidated when the images change.
 *
 * The two halves are dispatched separately because they cost wildly different
 * amounts: the folder listing is a readdir and lands immediately, while the
 * histogram opens a header per image. Waiting for the second to show the first
 * would leave every project load briefly claiming an empty dataset.
 *
 * A folder that fails to scan outright (permissions, I/O) is left alone rather
 * than blanked — the rest of the datasets still refresh. A folder that's simply
 * absent is not a failure: it comes back as a scan saying so, which is what the
 * missing-dataset warning is built on.
 */
const scanDataset =
  (folderName: string): AppThunk =>
  async (dispatch) => {
    try {
      const { exists, folders, captionMode } =
        await scanDatasetFolders(folderName);
      dispatch(
        reconcileDatasetFolders({ folderName, exists, captionMode, folders }),
      );
    } catch {
      // Leave the existing folders alone; a failed read shouldn't wipe them.
      return;
    }

    try {
      const folderHistograms = await getProjectFolderHistograms(folderName);
      dispatch(setDatasetHistogram({ folderName, folderHistograms }));
    } catch {
      // Bucket preview keeps whatever it had; the folder list is current.
    }
  };

/**
 * Read every dataset that hasn't been read yet.
 *
 * This is the one that runs on a load, and it's deliberately idempotent: a
 * dataset that already carries a scan is skipped, so it can be driven from an
 * effect and re-entered as often as the form re-renders (see
 * `useDatasetScanSync`). That's what makes a scan the client dropped —
 * loading a project rewrites the URL, and the navigation that follows can
 * take an in-flight request with it — recoverable rather than terminal.
 */
export const ensureDatasetScans =
  (): AppThunk => async (dispatch, getState) => {
    const pending = getState().trainingConfig.form.datasets.filter(
      (ds) => !ds.scan,
    );
    await Promise.all(
      pending.map((ds) => dispatch(scanDataset(ds.folderName))),
    );
  };

/**
 * Re-read every attached dataset, scanned or not — the Dataset section's
 * rescan button, for when the files have changed under a form that's already
 * looked at them.
 */
export const refreshDatasetScans =
  (): AppThunk => async (dispatch, getState) => {
    const { datasets } = getState().trainingConfig.form;
    await Promise.all(
      datasets.map((ds) => dispatch(scanDataset(ds.folderName))),
    );
  };

// --- List (not a thunk — plain fetch for UI consumption) ---

export async function fetchProjectList(): Promise<TrainingProjectSummary[]> {
  const { projects } = await fetchJson<{
    projects: TrainingProjectSummary[];
  }>('/api/training/projects');
  return projects;
}

// --- Load ---

export const loadProject =
  (id: string, version?: number): AppThunk =>
  async (dispatch) => {
    try {
      const url = version
        ? `/api/training/projects/${encodeURIComponent(id)}?version=${version}`
        : `/api/training/projects/${encodeURIComponent(id)}`;
      const { meta, version: v } = await fetchJson<ProjectResponse>(url);
      dispatch(
        hydrateFromProject({
          form: v.form,
          loadedProject: adoptProject(meta, v),
        }),
      );
    } catch (error) {
      dispatch(
        addToast({
          children: `Failed to load project: ${errorMessage(error)}`,
          variant: 'error',
        }),
      );
    }
  };

/**
 * Load a project by its URL slug rather than its id.
 *
 * Used when the URL is the source of truth — a refresh or a bookmark on
 * `/training/my-project/v2`, where the client has a slug and no id.
 *
 * `not-found` is reserved for a JSON 404, the handler's own word that no such
 * project exists — that's what lets the caller send the user back to the
 * unsaved form. Anything else resolves to `error`: a 404 that isn't JSON never
 * reached the handler (the dev server failing to match its own route looks
 * identical from here), and treating that as "no such project" evicts the user
 * from a URL whose project is sitting on disk.
 */
export type LoadBySlugResult = 'loaded' | 'not-found' | 'error';

export const loadProjectBySlug =
  (slug: string, version?: number): AppThunk<Promise<LoadBySlugResult>> =>
  async (dispatch) => {
    try {
      const query = version ? `?version=${version}` : '';
      const { meta, version: v } = await fetchJson<ProjectResponse>(
        `/api/training/projects/by-slug/${encodeURIComponent(slug)}${query}`,
      );
      dispatch(
        hydrateFromProject({
          form: v.form,
          loadedProject: adoptProject(meta, v),
        }),
      );
      return 'loaded';
    } catch (error) {
      if (isJsonStatus(error, 404)) return 'not-found';
      dispatch(
        addToast({
          children: `Failed to load project: ${errorMessage(error)}`,
          variant: 'error',
        }),
      );
      return 'error';
    }
  };

// --- Save: overwrite the currently loaded version ---

export const saveCurrentVersion =
  (form: FormState, label?: string | null): AppThunk =>
  async (dispatch, getState) => {
    const loaded = getState().trainingConfig.loadedProject;
    if (!loaded) {
      dispatch(
        addToast({
          children: 'No project loaded — use Save As instead',
          variant: 'error',
        }),
      );
      return;
    }
    try {
      const { meta, version } = await fetchJson<ProjectResponse>(
        `/api/training/projects/${encodeURIComponent(loaded.id)}/versions/${loaded.version}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ form, label }),
        },
      );
      dispatch(stampSaved(adoptProject(meta, version)));
    } catch (error) {
      dispatch(
        addToast({
          children: `Failed to save: ${errorMessage(error)}`,
          variant: 'error',
        }),
      );
    }
  };

// --- Save As: new project ---

export const saveAsNewProject =
  (name: string, form: FormState, label: string | null = null): AppThunk =>
  async (dispatch) => {
    try {
      const { meta, version } = await fetchJson<ProjectResponse>(
        '/api/training/projects',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, form, label }),
        },
      );
      dispatch(
        hydrateFromProject({
          form: version.form,
          loadedProject: adoptProject(meta, version),
        }),
      );
      dispatch(addToast({ children: `Saved as new project “${meta.name}”` }));
    } catch (error) {
      dispatch(
        addToast({
          children: `Failed to save: ${errorMessage(error)}`,
          variant: 'error',
        }),
      );
    }
  };

// --- Save As: new version of an existing project ---

export const saveAsNewVersion =
  (projectId: string, form: FormState, label: string | null = null): AppThunk =>
  async (dispatch) => {
    try {
      const { meta, version } = await fetchJson<ProjectResponse>(
        `/api/training/projects/${encodeURIComponent(projectId)}/versions`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ form, label }),
        },
      );
      dispatch(
        hydrateFromProject({
          form: version.form,
          loadedProject: adoptProject(meta, version),
        }),
      );
      dispatch(
        addToast({
          children: `Saved as v${version.version} of “${meta.name}”`,
        }),
      );
    } catch (error) {
      dispatch(
        addToast({
          children: `Failed to save: ${errorMessage(error)}`,
          variant: 'error',
        }),
      );
    }
  };

// --- Save As: replace an existing project entirely ---

export const replaceExistingProject =
  (
    projectId: string,
    form: FormState,
    options: { name?: string; label?: string | null } = {},
  ): AppThunk =>
  async (dispatch) => {
    try {
      const { meta, version } = await fetchJson<ProjectResponse>(
        `/api/training/projects/${encodeURIComponent(projectId)}/replace`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ form, ...options }),
        },
      );
      dispatch(
        hydrateFromProject({
          form: version.form,
          loadedProject: adoptProject(meta, version),
        }),
      );
      dispatch(addToast({ children: `Replaced project “${meta.name}”` }));
    } catch (error) {
      dispatch(
        addToast({
          children: `Failed to replace: ${errorMessage(error)}`,
          variant: 'error',
        }),
      );
    }
  };

// --- Rename a project ---

export const renameProject =
  (id: string, name: string): AppThunk =>
  async (dispatch, getState) => {
    try {
      const { meta } = await fetchJson<{ meta: TrainingProjectMeta }>(
        `/api/training/projects/${encodeURIComponent(id)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name }),
        },
      );

      // Mirror the rename into loadedProject if it's the one we have loaded.
      const loaded = getState().trainingConfig.loadedProject;
      if (loaded && loaded.id === meta.id) {
        dispatch(stampSaved({ ...loaded, name: meta.name }));
      }
    } catch (error) {
      dispatch(
        addToast({
          children: `Failed to rename: ${errorMessage(error)}`,
          variant: 'error',
        }),
      );
    }
  };

// --- Set version label ---

export const setVersionLabel =
  (id: string, version: number, label: string | null): AppThunk =>
  async (dispatch, getState) => {
    try {
      const { version: updated } = await fetchJson<{
        version: TrainingProjectVersion;
      }>(
        `/api/training/projects/${encodeURIComponent(id)}/versions/${version}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ label }),
        },
      );

      const loaded = getState().trainingConfig.loadedProject;
      if (loaded && loaded.id === id && loaded.version === version) {
        dispatch(stampSaved({ ...loaded, versionLabel: updated.label }));
      }
    } catch (error) {
      dispatch(
        addToast({
          children: `Failed to set label: ${errorMessage(error)}`,
          variant: 'error',
        }),
      );
    }
  };

// --- Delete whole project ---

export const deleteProject =
  (id: string): AppThunk =>
  async (dispatch, getState) => {
    try {
      await fetchJson<{ ok: boolean }>(
        `/api/training/projects/${encodeURIComponent(id)}`,
        { method: 'DELETE' },
      );
      forgetRecentProject(id);

      const loaded = getState().trainingConfig.loadedProject;
      if (loaded && loaded.id === id) {
        dispatch(clearLoadedProject());
      }
      dispatch(addToast({ children: 'Project deleted' }));
    } catch (error) {
      dispatch(
        addToast({
          children: `Failed to delete: ${errorMessage(error)}`,
          variant: 'error',
        }),
      );
    }
  };

// --- Delete a single version ---

export const deleteVersion =
  (id: string, version: number): AppThunk =>
  async (dispatch, getState) => {
    try {
      const { meta } = await fetchJson<{ meta: TrainingProjectMeta }>(
        `/api/training/projects/${encodeURIComponent(id)}/versions/${version}`,
        { method: 'DELETE' },
      );

      // If we just deleted the loaded version, hop to the latest remaining.
      const loaded = getState().trainingConfig.loadedProject;
      if (loaded && loaded.id === id && loaded.version === version) {
        dispatch(loadProject(id, meta.latestVersion));
      }
      dispatch(addToast({ children: `Deleted v${version}` }));
    } catch (error) {
      dispatch(
        addToast({
          children: `Failed to delete version: ${errorMessage(error)}`,
          variant: 'error',
        }),
      );
    }
  };

// --- Helpers ---

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
