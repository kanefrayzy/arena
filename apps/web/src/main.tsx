import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { AppRouter } from './app/router';
import { InstallPrompt } from './shared/pwa/InstallPrompt';
import { startSW } from './shared/pwa/registerSW';
import { ErrorBoundary } from './shared/ui/ErrorBoundary';
import { ToastViewport, toast } from './shared/ui/toast';
import { unlockAudio } from './shared/game/audio';
import { applyBrandingAndSeo } from './shared/seo/applyBrandingAndSeo';
import './shared/i18n';
import './index.css';

// Live-apply admin branding (favicon, icons, theme color) and SEO meta tags.
void applyBrandingAndSeo();

// Global audio unlock on first user gesture (browsers require this).
const unlock = () => {
  unlockAudio();
  window.removeEventListener('pointerdown', unlock);
  window.removeEventListener('keydown', unlock);
  window.removeEventListener('touchstart', unlock);
};
window.addEventListener('pointerdown', unlock, { once: false });
window.addEventListener('keydown', unlock, { once: false });
window.addEventListener('touchstart', unlock, { once: false });

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

const root = document.getElementById('root');
if (!root) throw new Error('root element not found');

window.addEventListener('unhandledrejection', (e) => {
  // eslint-disable-next-line no-console
  console.error('[unhandledrejection]', e.reason);
  const msg = e.reason instanceof Error ? e.reason.message : String(e.reason ?? '');
  if (msg) toast.error('Ошибка', msg.slice(0, 200));
});

ReactDOM.createRoot(root).render(
  <ErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AppRouter />
        <InstallPrompt />
        <ToastViewport />
      </BrowserRouter>
    </QueryClientProvider>
  </ErrorBoundary>,
);

if (import.meta.env.PROD) startSW();

