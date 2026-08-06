'use client';

import { FolderOpenIcon } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { Button } from '../button';
import { Input } from '../input/input';
import { InputTray } from '../input-tray/input-tray';

// Keys match what the sidecar reads from config.json `trainingBackends`
// (training-sidecar/config.py).
const BACKENDS = [
  {
    key: 'ai-toolkit',
    label: 'AI Toolkit',
    placeholder: 'Folder for AI-Toolkit',
    hint: 'Root of the ai-toolkit checkout',
  },
  {
    key: 'kohya',
    label: 'Kohya sd-scripts',
    placeholder: 'Folder for SD Scripts',
    hint: 'Root of the sd-scripts checkout',
  },
  {
    key: 'musubi',
    label: 'Musubi Tuner',
    placeholder: 'Folder for Musubi Tuner',
    hint: 'Root of the musubi-tuner checkout',
  },
] as const;

/**
 * Settings section for training backend install locations, persisted to
 * config.json `trainingBackends` — previously hand-edited. The sidecar reads
 * the file at spawn, so changes apply on its next (re)start.
 */
export function BackendPathsSection({
  initialPaths,
}: {
  initialPaths: Record<string, string>;
}) {
  const [saved, setSaved] = useState<Record<string, string>>(initialPaths);
  const [drafts, setDrafts] = useState<Record<string, string>>(initialPaths);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSavedPing, setShowSavedPing] = useState(false);

  useEffect(() => {
    if (!showSavedPing) return;
    const timeout = window.setTimeout(() => setShowSavedPing(false), 2500);
    return () => window.clearTimeout(timeout);
  }, [showSavedPing]);

  const dirty = BACKENDS.some(
    ({ key }) => (drafts[key] ?? '').trim() !== (saved[key] ?? '').trim(),
  );

  const handleBrowse = useCallback(async (key: string, label: string) => {
    try {
      const params = new URLSearchParams({
        title: `Select ${label} folder`,
        mode: 'folder',
      });
      const res = await fetch(`/api/filesystem/browse?${params}`);
      const data = await res.json();
      if (data.path) setDrafts((prev) => ({ ...prev, [key]: data.path }));
    } catch {
      // Dialog failed — the path can still be typed manually
    }
  }, []);

  const handleSave = useCallback(async () => {
    // Send only the changed backends so an untouched path that has since
    // vanished from disk can't fail the whole save.
    const changed: Record<string, string> = {};
    for (const { key } of BACKENDS) {
      const draft = (drafts[key] ?? '').trim();
      if (draft !== (saved[key] ?? '').trim()) changed[key] = draft;
    }
    if (Object.keys(changed).length === 0) return;

    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trainingBackends: changed }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to save');
      const next = (data.trainingBackends ?? {}) as Record<string, string>;
      setSaved(next);
      setDrafts(next);
      setShowSavedPing(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }, [drafts, saved]);

  return (
    <section className="flex flex-col gap-3">
      <div className="text-sm text-slate-500">
        <h3 className="text-lg font-medium text-slate-800 dark:text-slate-200">
          Training Backend Locations
        </h3>
        <p className="mt-1">
          Where each training backend is installed. Leave a field empty to
          remove that backend. Changes apply the next time the sidecar starts —
          restart it from the global menu to pick them up now.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        {BACKENDS.map(({ key, label, placeholder, hint }) => (
          <label key={key} className="flex flex-col gap-1">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
              {label}
            </span>
            <InputTray size="md" width="full" tone="deep">
              <Input
                size="md"
                placeholder={placeholder}
                value={drafts[key] ?? ''}
                onChange={(e) =>
                  setDrafts((prev) => ({ ...prev, [key]: e.target.value }))
                }
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSave();
                }}
                className="min-w-0 flex-1 font-mono"
                disabled={saving}
              />
              <Button
                onClick={() => handleBrowse(key, label)}
                variant="ghost"
                size="md"
                width="md"
                title="Browse…"
                disabled={saving}
              >
                <FolderOpenIcon />
              </Button>
            </InputTray>
            <span className="text-sm text-slate-400 dark:text-slate-500">
              {hint}
            </span>
          </label>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <Button
          onClick={handleSave}
          color="indigo"
          size="md"
          width="lg"
          disabled={saving || !dirty}
        >
          {saving ? 'Saving…' : 'Save'}
        </Button>
        {showSavedPing && (
          <span className="text-teal-600 dark:text-teal-400">Saved.</span>
        )}
      </div>

      {error && (
        <div className="rounded-md bg-rose-50 p-3 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
          {error}
        </div>
      )}
    </section>
  );
}
