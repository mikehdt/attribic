'use client';

import { FolderOpenIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import type { TrainingProjectSummary } from '@/app/services/training-projects/disk-schema';
import { Button } from '@/app/shared/button';
import { Input } from '@/app/shared/input/input';
import { Modal } from '@/app/shared/modal';
import { useAppDispatch, useAppSelector } from '@/app/store/hooks';
import { selectLoadedProject } from '@/app/store/training-config';
import {
  fetchProjectList,
  loadProject,
} from '@/app/store/training-config/thunks';

import { RadioRow } from './radio-row';

type LoadProjectModalProps = {
  isOpen: boolean;
  onClose: () => void;
};

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
    >
      <div className="flex flex-wrap gap-4">
        <h2 className="w-full text-2xl font-semibold text-slate-700 dark:text-slate-200">
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
                className="flex min-h-[20rem] flex-1 flex-col gap-1 overflow-auto rounded-md border border-slate-200 p-2 dark:border-slate-700"
                role="radiogroup"
                aria-label="Projects"
              >
                {filtered.map((p) => (
                  <RadioRow
                    key={p.id}
                    name="load-project"
                    value={p.id}
                    checked={selectedId === p.id}
                    onChange={() => handleSelectProject(p.id)}
                  >
                    <FolderOpenIcon className="h-4 w-4 shrink-0 text-slate-400" />
                    <div className="flex flex-1 flex-col">
                      <span className="truncate">{p.name}</span>
                      <span className="text-xs text-slate-500">
                        {p.versions.length} version
                        {p.versions.length === 1 ? '' : 's'} ·{' '}
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
                className="flex max-h-[28rem] w-48 flex-col gap-1 overflow-auto rounded-md border border-slate-200 p-2 dark:border-slate-700"
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
                        <div className="flex flex-1 flex-col">
                          <span className="text-sm">
                            v{v.version}
                            {v.label ? ` · ${v.label}` : ''}
                          </span>
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
