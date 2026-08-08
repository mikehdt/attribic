import { RefObject, useCallback, useEffect, useRef, useState } from 'react';

/** Fractional scroll offsets never land exactly on the edge. */
const EDGE_TOLERANCE = 1;

type ScrollFade = {
  /** Attach to the scrolling element. */
  scrollRef: RefObject<HTMLDivElement | null>;
  /** Attach to the single child wrapping the scrolled content. */
  contentRef: RefObject<HTMLDivElement | null>;
  hasScrollAbove: boolean;
  hasScrollBelow: boolean;
};

/**
 * Tracks whether a scroll container has content hidden above or below, so an
 * edge fade can be shown only on the side that has more to reveal.
 *
 * Both refs are needed: the container resizing changes how much fits, and the
 * content resizing changes how much there is. Watching only the container
 * misses tags being added or an asset swapping for a taller one.
 */
export const useScrollFade = (): ScrollFade => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({
    hasScrollAbove: false,
    hasScrollBelow: false,
  });

  const sync = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;

    const { scrollTop, scrollHeight, clientHeight } = el;
    const next = {
      hasScrollAbove: scrollTop > EDGE_TOLERANCE,
      hasScrollBelow: scrollTop + clientHeight < scrollHeight - EDGE_TOLERANCE,
    };

    setEdges((prev) =>
      prev.hasScrollAbove === next.hasScrollAbove &&
      prev.hasScrollBelow === next.hasScrollBelow
        ? prev
        : next,
    );
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    sync();
    el.addEventListener('scroll', sync, { passive: true });

    const observer = new ResizeObserver(sync);
    observer.observe(el);
    if (contentRef.current) observer.observe(contentRef.current);

    return () => {
      el.removeEventListener('scroll', sync);
      observer.disconnect();
    };
  }, [sync]);

  return { scrollRef, contentRef, ...edges };
};
