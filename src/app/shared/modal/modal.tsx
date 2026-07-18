'use client';

import {
  SyntheticEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';

import { useModalPortal, useModalRegister } from './modal-provider';

type ModalProps = {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
  animationDuration?: never;
  /** Prevent closing via backdrop click, ESC key, or X button */
  preventClose?: boolean;
  /** ID of the element that labels the dialog (rendered as aria-labelledby) */
  labelledById?: string;
  /** Accessible name for dialogs without a visible heading (rendered as aria-label) */
  ariaLabel?: string;
};

// Elements that can receive keyboard focus, for the focus trap.
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const getFocusableElements = (container: HTMLElement): HTMLElement[] =>
  Array.from(
    container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  ).filter((el) => el.offsetParent !== null);

/**
 * A customisable modal component that dims the background and focuses on content
 * - Dims the UI behind it (clickable to dismiss)
 * - Resets when dismissed (doesn't maintain state)
 * - Customisable layout and design
 * - Remains centered and responsive
 * - Smooth fade in/out animations
 * - Includes dismiss button (X)
 */
export const Modal = ({
  isOpen,
  onClose,
  children,
  className = '',
  preventClose = false,
  labelledById,
  ariaLabel,
}: ModalProps) => {
  // State to control the visibility of the modal for animation purposes
  const [isVisible, setIsVisible] = useState(false);

  // State to determine if the modal should be completely unmounted
  const [shouldUnmount, setShouldUnmount] = useState(!isOpen);

  // Animation duration in ms (matches the Tailwind duration-300 class)
  const ANIMATION_DURATION = 300;

  // Ref to track the modal container element
  const modalRef = useRef<HTMLDivElement>(null);

  // Remember the element focused before the modal opened, to restore on close.
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  // Close on Escape and trap Tab within the dialog. Bound to the modal
  // container (not document) so only the focused — i.e. topmost — modal reacts;
  // a shared document listener made one Escape close every stacked modal.
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Escape') {
        if (!preventClose) {
          e.stopPropagation();
          onClose();
        }
        return;
      }
      if (e.key !== 'Tab') return;

      const node = modalRef.current;
      if (!node) return;
      const focusable = getFocusableElements(node);
      if (focusable.length === 0) {
        e.preventDefault();
        node.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === node)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    },
    [onClose, preventClose],
  );

  const handleStopPropagation = useCallback(
    (e: SyntheticEvent) => e.stopPropagation(),
    [],
  );

  // This effect handles the modal open/close animation state
  useEffect(() => {
    let rafId: number;

    // This function repeatedly checks if the modal element exists in the DOM
    // and only starts the animation once it does
    const checkAndAnimate = () => {
      if (modalRef.current !== null) {
        // Element exists in DOM, we can safely start the animation
        setIsVisible(true);
      } else if (isOpen) {
        // Element doesn't exist yet, keep checking
        rafId = requestAnimationFrame(checkAndAnimate);
      }
    };

    if (isOpen) {
      // Use RAF to set initial state, avoiding synchronous setState in effect
      rafId = requestAnimationFrame(() => {
        setShouldUnmount(false);
        setIsVisible(false);
        // Start checking for the DOM element
        rafId = requestAnimationFrame(checkAndAnimate);
      });
    } else {
      // When closing, trigger fade-out animation in RAF
      rafId = requestAnimationFrame(() => {
        setIsVisible(false);

        // Use nested requestAnimationFrames to approximate the animation duration
        const startTime = performance.now();
        const animateUnmount = (currentTime: number) => {
          if (currentTime - startTime >= ANIMATION_DURATION) {
            // Animation duration elapsed, now unmount
            setShouldUnmount(true);
          } else {
            // Keep waiting, ask for another frame
            rafId = requestAnimationFrame(animateUnmount);
          }
        };

        rafId = requestAnimationFrame(animateUnmount);
      });
    }

    // Clean up all possible async operations
    return () => {
      cancelAnimationFrame(rafId);
    };
  }, [isOpen, ANIMATION_DURATION]);

  // Track this modal in the global open-modal count. The cleanup is what makes
  // this unmount-safe: without it, a modal that unmounts while still open (Fast
  // Refresh remounting its subtree, or a parent dropping it) never runs
  // `registerModal(false)`, so its +1 leaks into `openCount` forever. That
  // stuck count keeps `useIsAnyModalOpen()` true, which permanently gates off
  // the activity panel — the bubble/panel never reappears after a hot reload.
  const registerModal = useModalRegister();
  useEffect(() => {
    registerModal(isOpen);
    return () => registerModal(false);
  }, [isOpen, registerModal]);

  // Lock body scroll while the modal is open.
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  // Move focus into the dialog on open and restore it to the trigger on close.
  useEffect(() => {
    if (!isOpen) return;
    previouslyFocusedRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    return () => {
      const trigger = previouslyFocusedRef.current;
      if (trigger && document.contains(trigger)) {
        trigger.focus();
      }
    };
  }, [isOpen]);

  // Once the dialog is mounted, focus it so keyboard users start inside the
  // modal and the Tab trap has an anchor to cycle from.
  useEffect(() => {
    if (shouldUnmount || !isOpen) return;
    modalRef.current?.focus();
  }, [shouldUnmount, isOpen]);

  // Get the portal container
  const portalContainer = useModalPortal();

  // Don't render anything if we should unmount the component
  // This only happens after the fade-out animation has completed
  if (shouldUnmount) {
    return null;
  }

  // Use createPortal to render modal at the document body level
  return portalContainer
    ? createPortal(
        <div
          className={`fixed inset-0 z-50 flex items-center justify-center transition-opacity duration-300 ease-in-out ${
            isVisible
              ? 'opacity-100 backdrop-blur-xs'
              : 'opacity-0 backdrop-blur-none'
          }`}
          aria-modal="true"
          role="dialog"
          aria-labelledby={labelledById}
          aria-label={ariaLabel}
        >
          {/* Backdrop overlay - clickable to close (unless preventClose) */}
          <div
            className={`absolute inset-0 bg-black transition-opacity duration-300 ease-in-out ${
              isVisible ? 'opacity-60' : 'opacity-0'
            }`}
            onClick={preventClose ? undefined : onClose}
          />

          {/* Modal container */}
          <div
            ref={modalRef}
            tabIndex={-1}
            className={`relative max-h-[90vh] w-full overflow-auto rounded-lg bg-white p-6 shadow-lg shadow-slate-600/50 transition-all duration-300 ease-in-out outline-none dark:bg-slate-800 dark:shadow-slate-950/50 ${
              isVisible
                ? 'translate-y-0 scale-100 opacity-100'
                : 'translate-y-4 scale-95 opacity-0'
            } ${className}`}
            onClick={handleStopPropagation}
            onKeyDown={handleKeyDown}
          >
            {/* Close button (hidden when preventClose is true) */}
            {!preventClose && (
              <button
                className="absolute top-3 right-3 z-1 cursor-pointer rounded-full border border-slate-300/0 bg-white p-1 text-slate-500 transition-colors hover:border-slate-300 hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:outline-none dark:border-slate-600/0 dark:bg-slate-800 dark:text-slate-400 dark:hover:border-slate-600 dark:hover:bg-slate-700 dark:hover:text-slate-200"
                onClick={onClose}
                aria-label="Close modal"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-5 w-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            )}

            {/* Modal content */}
            <div className={!preventClose ? 'mt-2' : ''}>{children}</div>
          </div>
        </div>,
        portalContainer,
      )
    : null;
};
