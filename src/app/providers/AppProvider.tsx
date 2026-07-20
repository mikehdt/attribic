'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  completeAfterDelay,
  IoState,
  loadAllAssets,
  selectImageCount,
  selectIoState,
} from '../store/assets';
import { flushPendingTagResults } from '../store/assets/flush-pending-tags';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { selectActiveTaggingJob } from '../store/jobs';
import {
  selectProjectFolderName,
  setCaptionMode,
  setCaptionPrompt,
  setProjectInfo,
  setTriggerPhrases,
} from '../store/project';
import { hydrateActiveTraining } from '../store/training/training-runtime';
import { Error } from '../tagging/views/error';
import { InitialLoad } from '../tagging/views/initial-load';
import { NoContent } from '../tagging/views/no-content';
import { getProjectInfo } from '../utils/project-actions';
import { useTheme } from '../utils/use-theme';

/**
 * Extract the project slug from a tagging URL like /tagging/my-project/1
 */
function extractProjectFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/tagging\/([^/]+)/);
  if (!match) return null;
  return decodeURIComponent(match[1]);
}

export const AppProvider = ({ children }: { children: React.ReactNode }) => {
  // Apply theme class to document.documentElement globally
  useTheme();

  const router = useRouter();
  const pathname = usePathname();
  const [hasCompletedInitialLoad, setHasCompletedInitialLoad] = useState(false);
  const dispatch = useAppDispatch();

  // Reattach to an in-flight training job on every app mount, regardless of
  // route. Without this, refreshing on a non-training page loses the activity
  // panel until the user navigates back to /training.
  useEffect(() => {
    dispatch(hydrateActiveTraining());
  }, [dispatch]);
  const ioState = useAppSelector(selectIoState);
  const imageCount = useAppSelector(selectImageCount);
  const projectFolderName = useAppSelector(selectProjectFolderName);

  const isTagging = pathname.startsWith('/tagging');

  // Extract project from URL and set it in Redux — this runs in AppProvider
  // so it's not blocked by the InitialLoad gate below.
  // If navigated from the project list, Redux already has full info (title, thumbnail).
  // If accessed directly via URL (refresh/bookmark), we fetch the metadata from the server.
  const urlProject = isTagging ? extractProjectFromPath(pathname) : null;

  // /tagging with no project slug has nothing to load — bounce to the project list
  // before the InitialLoad gate below can strand the user on a forever spinner.
  useEffect(() => {
    if (isTagging && !urlProject) {
      router.replace('/');
    }
  }, [isTagging, urlProject, router]);

  useEffect(() => {
    if (!urlProject || urlProject === projectFolderName) return;

    // Set folderName immediately so asset loading can start,
    // but leave name undefined — InitialLoad shows "Loading…" without a name
    // until the server action resolves the proper title.
    dispatch(
      setProjectInfo({
        name: '',
        path: urlProject,
        folderName: urlProject,
      }),
    );

    // Fetch the real title/thumbnail/caption config from the server
    getProjectInfo(urlProject).then((info) => {
      if (info?.captionMode) dispatch(setCaptionMode(info.captionMode));
      if (info?.triggerPhrases)
        dispatch(setTriggerPhrases(info.triggerPhrases));
      // Dispatched unconditionally: a project without an authored prompt must
      // clear whatever the previously-viewed project left in the slice, not
      // inherit it.
      dispatch(setCaptionPrompt(info?.captionPrompt ?? null));
      dispatch(
        setProjectInfo({
          name: info?.title || urlProject,
          path: urlProject,
          folderName: urlProject,
          thumbnail: info?.thumbnail,
          thumbnailVersion: info?.thumbnailVersion,
        }),
      );
    });
  }, [urlProject, projectFolderName, dispatch]);

  // Load assets when project is set and we're on a tagging page
  const loadImageAssets = useCallback(
    (_args?: { maintainIoState: boolean }) => {
      if (isTagging && projectFolderName) {
        dispatch(
          loadAllAssets({
            maintainIoState: _args?.maintainIoState ?? false,
            projectPath: projectFolderName,
          }),
        );
      }
    },
    [dispatch, isTagging, projectFolderName],
  );

  // Track which project we last loaded so we know when to reload
  const lastLoadedProject = useRef<string | null>(null);

  useEffect(() => {
    // Reset when leaving tagging view
    if (!isTagging) {
      lastLoadedProject.current = null;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Intentional state reset on navigation
      setHasCompletedInitialLoad(false);
      return;
    }

    // Load when we have a project and either haven't loaded yet or the project changed
    if (projectFolderName && lastLoadedProject.current !== projectFolderName) {
      lastLoadedProject.current = projectFolderName;
      loadImageAssets();
    }
  }, [loadImageAssets, isTagging, projectFolderName]);

  // Redirect to root on I/O error
  useEffect(() => {
    if (ioState === IoState.ERROR && isTagging) {
      router.push('/');
    }
  }, [ioState, router, isTagging]);

  // Auto-trigger completion delay when state becomes COMPLETING
  useEffect(() => {
    if (ioState === IoState.COMPLETING) {
      dispatch(completeAfterDelay());
    }
  }, [ioState, dispatch]);

  // Track initial load completion and reset flag if imageCount becomes 0 (crash recovery)
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    if (imageCount === 0) {
      setHasCompletedInitialLoad(false);
    } else if (ioState === IoState.COMPLETE && !hasCompletedInitialLoad) {
      setHasCompletedInitialLoad(true);
    }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [imageCount, ioState, hasCompletedInitialLoad]);

  // Flush any pending auto-tagger results that accumulated while the user was away.
  // Runs once when assets finish loading — but only if tagging isn't still in progress,
  // since the completion handler will flush when the job finishes.
  const activeTaggingJob = useAppSelector(
    selectActiveTaggingJob(projectFolderName ?? ''),
  );
  useEffect(() => {
    if (
      ioState === IoState.COMPLETE &&
      projectFolderName &&
      imageCount > 0 &&
      !activeTaggingJob
    ) {
      dispatch(flushPendingTagResults(projectFolderName));
    }
  }, [ioState, projectFolderName, imageCount, activeTaggingJob, dispatch]);

  // On non-tagging routes (project list, training), just show children
  if (!isTagging) {
    return children;
  }

  // Tagging path with no project slug — render nothing while the redirect effect runs
  if (!urlProject) {
    return null;
  }

  // Show loading when INITIAL or loading with no assets yet
  if (
    ioState === IoState.INITIAL ||
    (ioState === IoState.LOADING && imageCount === 0) ||
    (ioState === IoState.COMPLETING && !hasCompletedInitialLoad)
  ) {
    return <InitialLoad />;
  }

  if (ioState === IoState.ERROR) {
    return <Error onReload={loadImageAssets} />;
  }

  if (ioState !== IoState.LOADING && imageCount === 0) {
    return <NoContent onReload={loadImageAssets} />;
  }

  return children;
};
