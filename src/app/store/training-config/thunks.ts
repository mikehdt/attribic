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
import { getProjectDimensionHistogram } from '@/app/utils/project-actions';

import type { AppThunk } from '../index';
import { addToast } from '../toasts';
import {
  clearLoadedProject,
  hydrateFromProject,
  setDatasetHistogram,
  stampSaved,
} from './index';
import type { FormState, LoadedProject } from './types';

type ProjectResponse = {
  meta: TrainingProjectMeta;
  version: TrainingProjectVersion;
};

function toLoadedProject(
  meta: TrainingProjectMeta,
  version: TrainingProjectVersion,
): LoadedProject {
  return {
    id: meta.id,
    name: meta.name,
    version: version.version,
    versionLabel: version.label,
    savedAt: version.savedAt,
  };
}

async function parseOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  return (await res.json()) as T;
}

// --- Dimension histograms (derived from disk, never persisted) ---

/**
 * Rescan every attached dataset's image dimensions from disk.
 *
 * Histograms are captured once when a dataset is picked and are stripped on
 * save, so without this a config would render size information about a folder
 * as it looked at some arbitrary point in the past. They drive the
 * native-resolution mismatch warning, so a stale one can claim a dataset is
 * correctly sized when it no longer is. Scans run in parallel and are
 * header-only reads, so this is cheap enough to do on every load.
 *
 * A folder that fails to scan (deleted, renamed, permissions) is skipped
 * rather than blanked — the rest of the datasets still refresh.
 */
export const refreshDatasetHistograms =
  (): AppThunk => async (dispatch, getState) => {
    const { datasets } = getState().trainingConfig.form;
    if (datasets.length === 0) return;

    await Promise.all(
      datasets.map(async (ds) => {
        try {
          const dimensionHistogram = await getProjectDimensionHistogram(
            ds.folderName,
          );
          dispatch(
            setDatasetHistogram({
              folderName: ds.folderName,
              dimensionHistogram,
            }),
          );
        } catch {
          // Leave the existing histogram alone; a failed scan shouldn't wipe it.
        }
      }),
    );
  };

// --- List (not a thunk — plain fetch for UI consumption) ---

export async function fetchProjectList(): Promise<TrainingProjectSummary[]> {
  const res = await fetch('/api/training/projects');
  const { projects } = await parseOrThrow<{
    projects: TrainingProjectSummary[];
  }>(res);
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
      const res = await fetch(url);
      const { meta, version: v } = await parseOrThrow<ProjectResponse>(res);
      dispatch(
        hydrateFromProject({
          form: v.form,
          loadedProject: toLoadedProject(meta, v),
        }),
      );
      void dispatch(refreshDatasetHistograms());
    } catch (error) {
      dispatch(
        addToast({
          children: `Failed to load project: ${errorMessage(error)}`,
          variant: 'error',
        }),
      );
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
      const res = await fetch(
        `/api/training/projects/${encodeURIComponent(loaded.id)}/versions/${loaded.version}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ form, label }),
        },
      );
      const { meta, version } = await parseOrThrow<ProjectResponse>(res);
      dispatch(stampSaved(toLoadedProject(meta, version)));
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
      const res = await fetch('/api/training/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, form, label }),
      });
      const { meta, version } = await parseOrThrow<ProjectResponse>(res);
      dispatch(
        hydrateFromProject({
          form: version.form,
          loadedProject: toLoadedProject(meta, version),
        }),
      );
      void dispatch(refreshDatasetHistograms());
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
      const res = await fetch(
        `/api/training/projects/${encodeURIComponent(projectId)}/versions`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ form, label }),
        },
      );
      const { meta, version } = await parseOrThrow<ProjectResponse>(res);
      dispatch(
        hydrateFromProject({
          form: version.form,
          loadedProject: toLoadedProject(meta, version),
        }),
      );
      void dispatch(refreshDatasetHistograms());
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
      const res = await fetch(
        `/api/training/projects/${encodeURIComponent(projectId)}/replace`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ form, ...options }),
        },
      );
      const { meta, version } = await parseOrThrow<ProjectResponse>(res);
      dispatch(
        hydrateFromProject({
          form: version.form,
          loadedProject: toLoadedProject(meta, version),
        }),
      );
      void dispatch(refreshDatasetHistograms());
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
      const res = await fetch(
        `/api/training/projects/${encodeURIComponent(id)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name }),
        },
      );
      const { meta } = await parseOrThrow<{ meta: TrainingProjectMeta }>(res);

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
      const res = await fetch(
        `/api/training/projects/${encodeURIComponent(id)}/versions/${version}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ label }),
        },
      );
      const { version: updated } = await parseOrThrow<{
        version: TrainingProjectVersion;
      }>(res);

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
      const res = await fetch(
        `/api/training/projects/${encodeURIComponent(id)}`,
        { method: 'DELETE' },
      );
      await parseOrThrow<{ ok: boolean }>(res);

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
      const res = await fetch(
        `/api/training/projects/${encodeURIComponent(id)}/versions/${version}`,
        { method: 'DELETE' },
      );
      const { meta } = await parseOrThrow<{ meta: TrainingProjectMeta }>(res);

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
