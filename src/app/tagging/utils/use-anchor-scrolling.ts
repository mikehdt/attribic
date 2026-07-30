import { useEffect } from 'react';

import { scrollAnchorIntoView } from './scroll-to-anchor';

/**
 * Hook to handle anchor scrolling after navigation
 * This is needed because Next.js client-side navigation doesn't automatically
 * scroll to anchors like traditional page loads do
 */
export const useAnchorScrolling = () => {
  useEffect(() => {
    // Owned by the effect so it can be cancelled on unmount — returning a
    // cleanup from `handleHashChange` (an event-listener callback) never runs.
    let frameId: number | undefined;

    const handleHashChange = () => {
      const hash = window.location.hash;
      if (!hash) return;

      // Wait a frame so the target has been laid out; scrolling in the same
      // tick as the navigation measures the previous page's geometry.
      frameId = requestAnimationFrame(() => {
        scrollAnchorIntoView(hash.substring(1));
      });
    };

    // Check hash on component mount/route change
    handleHashChange();

    // Listen for hash changes
    window.addEventListener('hashchange', handleHashChange);

    return () => {
      window.removeEventListener('hashchange', handleHashChange);
      if (frameId !== undefined) cancelAnimationFrame(frameId);
    };
  }, []);
};
