import { useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const LAUNCH_KEY = 'arena.launches';
const DISMISS_KEY = 'arena.installDismissedAt';
const DISMISS_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const MIN_LAUNCHES = 2;

export function InstallPrompt() {
  const [evt, setEvt] = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // bump launch counter once per page load
    const launches = Number(localStorage.getItem(LAUNCH_KEY) ?? '0') + 1;
    localStorage.setItem(LAUNCH_KEY, String(launches));

    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      const dismissed = Number(localStorage.getItem(DISMISS_KEY) ?? '0');
      const cooled = !dismissed || Date.now() - dismissed > DISMISS_COOLDOWN_MS;
      if (launches >= MIN_LAUNCHES && cooled) {
        setEvt(e as BeforeInstallPromptEvent);
        setVisible(true);
      }
    };

    const onInstalled = () => {
      setVisible(false);
      setEvt(null);
      localStorage.setItem(DISMISS_KEY, String(Date.now() + DISMISS_COOLDOWN_MS * 100)); // forever
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (!visible || !evt) return null;

  function dismiss() {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
    setVisible(false);
  }

  async function install() {
    if (!evt) return;
    await evt.prompt();
    await evt.userChoice;
    setVisible(false);
    setEvt(null);
  }

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex justify-center p-4">
      <div className="pointer-events-auto w-full max-w-sm rounded-2xl border border-white/10 bg-surface/95 p-4 shadow-2xl backdrop-blur">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent text-bg font-bold">A1</div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold">Установить Arena1v1</div>
            <p className="mt-0.5 text-xs text-white/60">
              Добавьте на главный экран — играйте в полноэкранном режиме без браузерной строки.
            </p>
          </div>
          <button
            type="button"
            onClick={dismiss}
            className="rounded-md p-1 text-white/40 hover:bg-white/10 hover:text-white"
            aria-label="dismiss"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={dismiss}
            className="flex-1 rounded-md bg-white/5 px-3 py-2 text-xs text-white/70 hover:bg-white/10"
          >
            Не сейчас
          </button>
          <button
            type="button"
            onClick={() => void install()}
            className="flex-1 rounded-md bg-accent px-3 py-2 text-xs font-semibold text-bg hover:brightness-110"
          >
            Установить
          </button>
        </div>
      </div>
    </div>
  );
}
