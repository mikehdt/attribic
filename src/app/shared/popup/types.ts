import { ReactNode, RefObject } from 'react';

export type PopupPosition =
  'top-left' | 'top' | 'top-right' | 'bottom-left' | 'bottom' | 'bottom-right';

export interface PopupState {
  isOpen: boolean;
  isAnimating: boolean;
  shouldRender: boolean;
  /** True while measuring/positioning before animation starts */
  isPositioning: boolean;
}

export interface PopupConfig {
  position?: PopupPosition;
  triggerRef?: RefObject<HTMLElement | null>;
  offset?: number;
  className?: string;
}

export interface PopupContextValue {
  activePopupId: string | null;
  openPopup: (id: string, config?: PopupConfig) => void;
  closePopup: (id: string) => void;
  closeAllPopups: () => void;
  getPopupState: (id: string) => PopupState;
  setPopupConfig: (id: string, config: PopupConfig) => void;
  getPopupConfig: (id: string) => PopupConfig | undefined;
  /** Called by Popup component when positioning is complete and ready to animate */
  finishPositioning: (id: string) => void;
}

export interface PopupProviderProps {
  children: ReactNode;
}

export interface PopupProps {
  id: string;
  position?: PopupPosition;
  triggerRef?: RefObject<HTMLElement | null>;
  offset?: number;
  className?: string;
  /** Additional inline styles merged onto the popup container */
  style?: React.CSSProperties;
  children: ReactNode;
  /** Skip maxHeight/overflow handling - useful for popups containing nested popups */
  disableOverflowHandling?: boolean;
  /** Called when positioning is complete and the popup is about to become visible.
   * Use this to focus inputs instead of autoFocus, which fires too early. */
  onPositioned?: () => void;
}
