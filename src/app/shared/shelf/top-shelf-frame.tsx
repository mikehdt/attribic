import { type ReactNode } from 'react';

type TopShelfFrameProps = {
  children: ReactNode;
};

export const TopShelfFrame = ({ children }: TopShelfFrameProps) => (
  // data-top-shelf lets the gallery keyboard nav measure how much of the
  // viewport the fixed shelf covers when picking the first visible asset
  <div data-top-shelf className="fixed top-0 left-0 z-20 w-full">
    {children}
  </div>
);
