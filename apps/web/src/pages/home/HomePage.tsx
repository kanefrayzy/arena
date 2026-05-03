import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../../shared/api/client';
import { useAuth, type Me } from '../../shared/store/auth';

interface Wallet {
  balance: string;
  locked: string;
  coins: number;
}

type Mode = 'free' | 'casual' | 'stake';

export function HomePage() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const me = useAuth((s) => s.me);
  const setMe = useAuth((s) => s.setMe);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [mode, setMode] = useState<Mode>('free');

  useEffect(() => {
    void (async () => {
      try {
        const u = await api.get<Me>('/auth/me');
        setMe(u);
        const w = await api.get<Wallet>('/wallet');
        setWallet(w);
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) {
          nav('/');
        }
      }
    })();
  }, [nav, setMe]);

  if (!me) return null;

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-white/10 px-5 py-3">
        <div className="text-sm text-white/70">@{me.username}</div>
        <div className="text-sm">
          <span className="text-white/50">{t('home.balance')}: </span>
          <span className="font-mono">${wallet ? Number(wallet.balance).toFixed(2) : '—'}</span>
        </div>
      </header>

      <main className="flex flex-1 flex-col items-center justify-center gap-8 px-6">
        <div className="flex gap-2">
          {(['free', 'casual', 'stake'] as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={
                'rounded-lg px-4 py-2 text-sm transition ' +
                (mode === m
                  ? 'bg-accent text-bg'
                  : 'bg-surface text-white/70 hover:bg-white/10')
              }
            >
              {t(`home.mode.${m}`)}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => nav(`/queue?mode=${mode}`)}
          disabled={mode !== 'free'}
          className="rounded-2xl bg-accent px-16 py-6 text-2xl font-bold text-bg shadow-2xl shadow-accent/20 disabled:opacity-60"
          title={mode === 'free' ? '' : t('home.coming_soon')}
        >
          {t('home.play')}
        </button>

        <p className="text-sm text-white/40">
          {mode === 'free' ? t('home.free_hint') : t('home.coming_soon')}
        </p>
      </main>
    </div>
  );
}
