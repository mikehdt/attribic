import './globals.css';

import type { Metadata } from 'next';
import { Geist } from 'next/font/google';
import { cookies } from 'next/headers';

import { AppProvider } from './providers/AppProvider';
import { StoreProvider } from './providers/StoreProvider';
import { ActivityPanel } from './shared/activity-panel/activity-panel';
import { ModalProvider } from './shared/modal';
import { ModelManagerModal } from './shared/model-manager-modal/model-manager-modal';
import { PopupProvider } from './shared/popup';
import { StableLayout } from './shared/stable-layout';
import { ToastContainer } from './shared/toast';
import {
  parsePreferencesCookie,
  PREFERENCES_COOKIE,
} from './store/preferences/local-storage';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
  fallback: ['system-ui', 'arial'],
});

export const metadata: Metadata = {
  title: 'Attribic',
  description: 'Image tagger and LoRA training UI',
  icons: {
    icon: [
      { url: '/favicon-16.png', sizes: '16x16', type: 'image/png' },
      { url: '/favicon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/favicon-48.png', sizes: '48x48', type: 'image/png' },
      { url: '/favicon-96.png', sizes: '96x96', type: 'image/png' },
      {
        url: '/favicon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
      },
    ],
    apple: [
      { url: '/favicon-128.png', sizes: '128x128', type: 'image/png' },
      { url: '/favicon-196.png', sizes: '196x196', type: 'image/png' },
    ],
    other: [
      {
        rel: 'apple-touch-icon',
        url: '/favicon-196.png',
      },
    ],
  },
};

export default async function Root({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Reading the cookie opts this route into dynamic rendering. Acceptable for
  // this local-only app — it lets the server render the user's real persisted
  // preferences (and theme) into the first HTML, eliminating the hydration
  // flip that fixed defaults would otherwise cause.
  const cookieStore = await cookies();
  const cookieValue = cookieStore.get(PREFERENCES_COOKIE)?.value;
  // Only treat preferences as "known" when the cookie actually exists. When it
  // is absent (first visit, or a user predating this cookie) we pass null so
  // StoreProvider falls back to reconciling from localStorage post-mount — the
  // one-time migration that seeds the cookie for subsequent SSR-correct loads.
  const preferences = cookieValue ? parsePreferencesCookie(cookieValue) : null;

  // Render the light/dark class directly when the theme is explicit and known
  // from the cookie. For 'auto' (system-driven) or a missing cookie we leave
  // it unset and let the inline script resolve it pre-hydration.
  const serverThemeClass =
    preferences?.theme === 'light'
      ? 'light'
      : preferences?.theme === 'dark'
        ? 'dark'
        : undefined;
  const htmlClassName = [geistSans.className, serverThemeClass]
    .filter(Boolean)
    .join(' ');

  return (
    <html
      lang="en"
      data-scroll-behavior="smooth"
      className={htmlClassName}
      // Still required: for 'auto'/cookie-absent themes the inline script below
      // resolves light/dark via matchMedia and mutates <html> before hydration,
      // which would otherwise trip a className mismatch warning.
      suppressHydrationWarning
    >
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var el=document.documentElement;if(el.classList.contains('light')||el.classList.contains('dark'))return;var p=localStorage.getItem('preferences');var t='auto';if(p){var o=JSON.parse(p);if(o&&(o.theme==='light'||o.theme==='dark'||o.theme==='auto'))t=o.theme;}var d=t==='dark'||(t==='auto'&&window.matchMedia('(prefers-color-scheme: dark)').matches);el.classList.add(d?'dark':'light');}catch(e){}})();`,
          }}
        />
      </head>
      <body>
        <StoreProvider preloadedPreferences={preferences}>
          <AppProvider>
            <ModalProvider>
              <PopupProvider>
                <StableLayout>{children}</StableLayout>
                <ModelManagerModal />
              </PopupProvider>
              <ToastContainer />
              <ActivityPanel />
            </ModalProvider>
          </AppProvider>
        </StoreProvider>
      </body>
    </html>
  );
}
