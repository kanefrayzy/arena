import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';

export function SplashPage() {
  const nav = useNavigate();
  const [netError, setNetError] = useState(false);
  const [logoFailed, setLogoFailed] = useState(false);
  // Cache-bust key so a newly-uploaded logo shows without a hard refresh.
  const cbRef = useRef(`?v=${Math.floor(Date.now() / 60_000)}`);

  useEffect(() => {
    // Race the auth check against an 8s timeout so we never block the
    // splash UI when the API is unreachable (e.g. RU ISPs blocking the
    // host without VPN). A TypeError from fetch also means no network /
    // blocked — surface a hint to the user.
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 8000);
    void fetch('/api/auth/me', { credentials: 'include', signal: ctrl.signal })
      .then(async (r) => {
        clearTimeout(to);
        if (r.ok) {
          nav('/home', { replace: true });
        } else if (r.status >= 500) {
          setNetError(true);
        }
        // 401 / 4xx → not logged in, stay on splash
      })
      .catch(() => {
        clearTimeout(to);
        // Network error or abort → server unreachable from this network
        setNetError(true);
      });
    return () => { clearTimeout(to); ctrl.abort(); };
  }, [nav]);
  const { t } = useTranslation();

  return (
    <div className="relative flex h-full flex-col items-center justify-center gap-10 overflow-hidden px-6 text-center">
      {/* decorative blobs */}
      <div className="pointer-events-none absolute -top-20 left-1/2 h-72 w-72 -translate-x-1/2 rounded-full bg-game-purple/40 blur-3xl" />
      <div className="pointer-events-none absolute bottom-10 right-10 h-48 w-48 rounded-full bg-game-pink/30 blur-3xl" />
      <div className="pointer-events-none absolute bottom-20 left-10 h-40 w-40 rounded-full bg-game-cyan/20 blur-3xl" />

      <div className="relative animate-pop-in">
        {logoFailed ? (
          <h1 className="game-title text-7xl text-game-yellow drop-shadow-[0_4px_0_rgba(0,0,0,0.5)]">
            {t('splash.title')}
          </h1>
        ) : (
          <img
            src={`/uploads/branding/logo.png${cbRef.current}`}
            onError={() => setLogoFailed(true)}
            alt={t('splash.title')}
            className="mx-auto max-h-32 w-auto object-contain drop-shadow-[0_4px_16px_rgba(0,0,0,0.6)]"
          />
        )}
        <div className="mx-auto mt-2 h-1 w-24 rounded-full bg-game-yellow/60" />
        <p className="mt-4 font-display text-base uppercase tracking-widest text-white/70">
          {t('splash.subtitle')}
        </p>
      </div>

      {netError && (
        <div className="relative max-w-xs rounded-2xl border border-amber-400/40 bg-amber-500/10 px-4 py-3 text-xs text-amber-200">
          {t('splash.netError', 'Не удаётся подключиться к серверу. В некоторых регионах требуется VPN.')}
        </div>
      )}

      <div className="relative flex w-full max-w-xs flex-col gap-4">
        <Link to="/login" className="game-btn game-btn-yellow game-btn-lg game-shimmer">
          {t('splash.login')}
        </Link>
        <Link to="/register" className="game-btn game-btn-purple">
          {t('splash.register')}
        </Link>
      </div>
    </div>
  );
}

