import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../shared/api/client';

export function SplashPage() {
  const nav = useNavigate();
  const [checking, setChecking] = useState(true);
  const [logoFailed, setLogoFailed] = useState(false);
  // Cache-bust key so a newly-uploaded logo shows without a hard refresh.
  const cbRef = useRef(`?v=${Math.floor(Date.now() / 60_000)}`);

  useEffect(() => {
    void api.get('/auth/me')
      .then(() => nav('/home', { replace: true }))
      .catch(() => setChecking(false));
  }, [nav]);
  const { t } = useTranslation();

  if (checking) return null;

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

