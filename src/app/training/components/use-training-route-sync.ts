'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';

import { useAppDispatch, useAppSelector } from '@/app/store/hooks';
import { addToast } from '@/app/store/toasts';
import { selectLoadedProject } from '@/app/store/training-config';
import { loadProjectBySlug } from '@/app/store/training-config/thunks';
import type { LoadedProject } from '@/app/store/training-config/types';
import { slugify } from '@/app/utils/slug';

type RouteTarget = {
  slug: string | null;
  version: number | null;
};

/**
 * Read `/training`, `/training/{slug}` or `/training/{slug}/v{n}`.
 *
 * A third segment that isn't `v{n}` yields a null version rather than failing
 * the whole parse, so a hand-mangled URL still resolves the project and gets
 * canonicalised instead of silently dropping to the unsaved form.
 */
function parseTrainingPath(pathname: string): RouteTarget {
  const segments = pathname.split('/').filter(Boolean);
  if (segments[0] !== 'training') return { slug: null, version: null };

  const slug = segments[1] ? decodeURIComponent(segments[1]) : null;
  const versionMatch = segments[2] ? /^v(\d+)$/.exec(segments[2]) : null;

  return {
    slug,
    version: versionMatch ? Number.parseInt(versionMatch[1]!, 10) : null,
  };
}

/**
 * The canonical URL for a loaded project.
 *
 * Version labels are deliberately absent: the segment is always `v{n}` so that
 * renaming a label never moves the URL out from under a bookmark. An unsaved
 * form — and a name that can't produce a slug at all — lives at bare
 * `/training`.
 */
function canonicalPath(project: LoadedProject | null): string {
  if (!project) return '/training';
  const slug = slugify(project.name);
  return slug ? `/training/${slug}/v${project.version}` : '/training';
}

/** Whether what's loaded already answers what the URL is asking for. */
function satisfies(project: LoadedProject | null, target: RouteTarget): boolean {
  if (!project || !target.slug) return false;
  if (slugify(project.name) !== target.slug) return false;
  // A URL with no version segment accepts whichever version is open; the
  // canonicalisation pass then pins it.
  return target.version === null || target.version === project.version;
}

/**
 * Keep the training URL and the loaded-project state in step.
 *
 * Two things drive this, and they have to be told apart. When the URL is the
 * source of truth — a refresh, a bookmark, a back/forward step — the slug gets
 * resolved server-side and hydrated into the form. Every other time the store
 * is the source of truth, and the URL is rewritten to match it: loading a
 * project, switching version, renaming, or dropping back to unsaved.
 *
 * Guarding on "do they differ?" alone is not enough, because a difference
 * doesn't say which side moved. Switching v1 → v2 and pressing Back from v2 to
 * v1 both end with the store and URL disagreeing about the version, but the
 * first must rewrite the URL and the second must reload the form. Telling them
 * apart is what {@link handledPathRef} is for: a path the URL has already been
 * allowed to lead with never gets to lead again, so anything that changes
 * afterwards can only have come from the store.
 */
export function useTrainingRouteSync(): void {
  const dispatch = useAppDispatch();
  const router = useRouter();
  const pathname = usePathname();
  const loadedProject = useAppSelector(selectLoadedProject);

  const target = useMemo(() => parseTrainingPath(pathname), [pathname]);

  // The last path the URL was allowed to lead with. Null until the first
  // reconciliation, which is what marks a cold load.
  const handledPathRef = useRef<string | null>(null);
  const isResolvingRef = useRef(false);

  // Bumped when a resolve settles, purely to re-run the effect. Hydration and
  // the promise callback land in an unspecified order, so the render caused by
  // the incoming project can arrive while the guard below is still closed and
  // get discarded. Without this nudge the URL would keep whatever the user
  // typed instead of canonicalising to what actually loaded.
  const [resolveCount, setResolveCount] = useState(0);

  useEffect(() => {
    // A resolve in flight owns the URL until it settles. Without this, the
    // store-leads branch below would see an empty store, decide the URL is
    // wrong, and redirect to /training — cancelling the very load that is
    // about to fill it.
    if (isResolvingRef.current) return;

    // The URL leads on a cold load and on any navigation we didn't initiate.
    // After a remount it's our own canonical redirect that just landed, so the
    // store already satisfies it and this costs nothing.
    const urlLeads =
      target.slug !== null && handledPathRef.current !== pathname;

    if (urlLeads && !satisfies(loadedProject, target)) {
      // Recorded before awaiting, not after: the server is allowed to answer
      // with a different version than asked for (a deleted one falls back to
      // the latest), so re-testing the response against the URL would never
      // agree and would re-request forever. One attempt per path, then the
      // store-leads branch canonicalises whatever actually came back.
      handledPathRef.current = pathname;
      isResolvingRef.current = true;

      let cancelled = false;
      void dispatch(
        loadProjectBySlug(target.slug!, target.version ?? undefined),
      ).then((ok) => {
        isResolvingRef.current = false;
        setResolveCount((n) => n + 1);
        if (cancelled) return;
        if (!ok) {
          dispatch(
            addToast({
              children: `No training project found at “${target.slug}”`,
              variant: 'error',
            }),
          );
          router.replace('/training', { scroll: false });
        }
      });

      return () => {
        cancelled = true;
      };
    }

    // Otherwise the store leads — point the URL at whatever is loaded.
    handledPathRef.current = pathname;
    const desired = canonicalPath(loadedProject);
    if (desired !== pathname) {
      router.replace(desired, { scroll: false });
    }
  }, [target, loadedProject, pathname, resolveCount, dispatch, router]);
}
