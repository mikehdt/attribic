'use client';

import { useEffect, useMemo, useState } from 'react';

import type {
  TrainingProjectSummary,
  TrainingProjectVersionSummary,
} from '@/app/services/training-projects/disk-schema';
import { Button } from '@/app/shared/button';
import { Input } from '@/app/shared/input/input';
import { Modal } from '@/app/shared/modal';
import { useAppDispatch, useAppSelector } from '@/app/store/hooks';
import { selectLoadedProject } from '@/app/store/training-config';
import {
  fetchProjectList,
  loadProject,
} from '@/app/store/training-config/thunks';

import { DatasetThumbs } from './dataset-thumbs';
import {
  MODEL_BADGE_CLASS,
  ModelBackendBadges,
  modelLabel,
} from './model-backend-badges';
import { RadioRow } from './radio-row';

type LoadProjectModalProps = {
  isOpen: boolean;
  onClose: () => void;
};

const COUNT_CHIP_CLASS =
  'cursor-pointer rounded bg-slate-200 px-1.5 py-0.5 text-xs font-medium text-slate-500 hover:bg-slate-300 dark:bg-slate-600 dark:text-slate-300 dark:hover:bg-slate-500';

/** Highest-numbered version — the one whose datasets represent the project. */
function latestVersionOf(
  project: TrainingProjectSummary,
): TrainingProjectVersionSummary | null {
  return (
    project.versions.reduce<TrainingProjectVersionSummary | null>(
      (best, v) => (!best || v.version > best.version ? v : best),
      null,
    ) ?? null
  );
}

/** Distinct values across a project's versions, latest first. */
function distinctByVersion<T>(
  project: TrainingProjectSummary,
  pick: (v: TrainingProjectVersionSummary) => T,
): T[] {
  const ordered = [...project.versions].sort((a, b) => b.version - a.version);
  const seen = new Set<T>();
  const out: T[] = [];
  for (const v of ordered) {
    const value = pick(v);
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

/**
 * Project-level badges. A project can span several models across its versions,
 * so the model list collapses to the latest model plus a clickable `+N` chip
 * that expands the rest in place. Backends (usually one) are shown in full.
 */
function ProjectSummaryBadges({
  project,
}: {
  project: TrainingProjectSummary;
}) {
  const [expanded, setExpanded] = useState(false);
  const models = distinctByVersion(project, (v) => v.modelId);
  if (models.length === 0) return null;

  const shownModels = expanded ? models : models.slice(0, 1);
  const hidden = models.length - shownModels.length;

  return (
    <span className="flex flex-wrap items-center gap-1">
      {shownModels.map((id) => (
        <span key={id} className={MODEL_BADGE_CLASS}>
          {modelLabel(id)}
        </span>
      ))}
      {(hidden > 0 || expanded) && models.length > 1 && (
        <button
          type="button"
          // Inside a RadioRow <label>; stop the click from toggling selection.
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setExpanded((prev) => !prev);
          }}
          className={COUNT_CHIP_CLASS}
          aria-label={
            expanded
              ? 'Show fewer models'
              : `Show ${hidden} more model${hidden === 1 ? '' : 's'}`
          }
        >
          {expanded ? '−' : `+${hidden}`}
        </button>
      )}
    </span>
  );
}

function formatRelative(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const seconds = Math.max(0, Math.floor((now - then) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export const LoadProjectModal = ({
  isOpen,
  onClose,
}: LoadProjectModalProps) => {
  const dispatch = useAppDispatch();
  const loadedProject = useAppSelector(selectLoadedProject);

  const [projects, setProjects] = useState<TrainingProjectSummary[]>([]);
  // Starts true so the loader is visible on first open; only reset to
  // false inside the fetch callback to keep the effect body free of
  // synchronous setState (which causes a cascading-render warning).
  const [isLoading, setIsLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    fetchProjectList()
      .then((list) => {
        if (cancelled) return;
        setProjects(list);
        const initial = loadedProject
          ? (list.find((p) => p.id === loadedProject.id) ?? list[0])
          : list[0];
        setSelectedId(initial?.id ?? null);
        setSelectedVersion(initial?.latestVersion ?? null);
        setIsLoading(false);
      })
      .catch(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, loadedProject]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter((p) => p.name.toLowerCase().includes(q));
  }, [projects, query]);

  const selectedProject = useMemo(
    () => projects.find((p) => p.id === selectedId) ?? null,
    [projects, selectedId],
  );

  const handleSelectProject = (id: string) => {
    setSelectedId(id);
    const p = projects.find((x) => x.id === id);
    setSelectedVersion(p?.latestVersion ?? null);
  };

  const handleLoad = async () => {
    if (!selectedId || selectedVersion === null) return;
    await dispatch(loadProject(selectedId, selectedVersion));
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      className="max-w-3xl min-w-[40rem]"
      labelledById="load-project-modal-title"
    >
      <div className="flex flex-wrap gap-4">
        <h2
          id="load-project-modal-title"
          className="w-full text-2xl font-semibold text-slate-700 dark:text-slate-200"
        >
          Load project
        </h2>

        {isLoading ? (
          <p className="py-2 text-sm text-slate-400">Loading…</p>
        ) : projects.length === 0 ? (
          <p className="py-2 text-sm text-slate-400">
            No saved projects yet. Use <strong>Save As…</strong> to create one.
          </p>
        ) : (
          <>
            <Input
              placeholder="Search…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full"
              autoFocus
            />

            <div className="flex w-full gap-3">
              {/* Project list */}
              <div
                className="flex min-h-80 flex-1 flex-col gap-1 overflow-auto rounded-md border border-slate-200 p-2 dark:border-slate-700"
                role="radiogroup"
                aria-label="Projects"
              >
                {filtered.map((p) => (
                  <RadioRow
                    key={p.id}
                    name="load-project"
                    value={p.id}
                    checked={selectedId === p.id}
                    align="start"
                    onChange={() => handleSelectProject(p.id)}
                  >
                    <DatasetThumbs
                      datasets={latestVersionOf(p)?.datasets ?? []}
                    />
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="truncate">{p.name}</span>
                      <ProjectSummaryBadges project={p} />
                      <span className="text-xs text-slate-500">
                        {p.versions.length}{' '}
                        {p.versions.length === 1 ? 'version' : 'versions'} ·{' '}
                        {formatRelative(p.updatedAt)}
                      </span>
                    </div>
                  </RadioRow>
                ))}
                {filtered.length === 0 && (
                  <p className="py-2 text-center text-sm text-slate-400">
                    No matches.
                  </p>
                )}
              </div>

              {/* Version list */}
              <div
                className="flex max-h-112 w-64 flex-col gap-1 overflow-auto rounded-md border border-slate-200 p-2 dark:border-slate-700"
                role="radiogroup"
                aria-label="Versions"
              >
                {selectedProject ? (
                  selectedProject.versions
                    .slice()
                    .reverse()
                    .map((v) => (
                      <RadioRow
                        key={v.version}
                        name="load-version"
                        value={String(v.version)}
                        checked={selectedVersion === v.version}
                        onChange={() => setSelectedVersion(v.version)}
                      >
                        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <span className="text-sm">
                            v{v.version}
                            {v.label ? ` · ${v.label}` : ''}
                          </span>
                          <ModelBackendBadges version={v} />
                          <span className="text-xs text-slate-500">
                            {formatRelative(v.savedAt)}
                          </span>
                        </div>
                      </RadioRow>
                    ))
                ) : (
                  <p className="py-2 text-center text-xs text-slate-400">
                    Select a project
                  </p>
                )}
              </div>
            </div>
          </>
        )}

        <div className="flex w-full justify-end gap-2 pt-2">
          <Button
            type="button"
            onClick={onClose}
            color="slate"
            size="md"
            width="lg"
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleLoad}
            disabled={!selectedId || selectedVersion === null}
            neutralDisabled
            color="sky"
            size="md"
            width="lg"
          >
            Load
          </Button>
        </div>
      </div>
    </Modal>
  );
};
