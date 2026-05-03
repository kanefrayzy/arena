import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../../shared/api/client';
import { useAuth, type Me } from '../../shared/store/auth';

interface Wallet {
  balance: string;
  locked: string;
}

type Mode = 'free' | 'casual' | 'stake';

const STAKE_ROOMS: { id: number; stake: string }[] = [
  { id: 3, stake: '1' },
  { id: 4, stake: '5' },
  { id: 5, stake: '10' },
];

export function HomePage() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const me = useAuth((s) => s.me);
  const setMe = useAuth((s) => s.setMe);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [mode, setMode] = useState<Mode>('free');
  const [selectedRoomId, setSelectedRoomId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const u = await api.get<Me>('/auth/me');
        setMe(u);
        const w = await api.get<Wallet>('/wallet');
        setWallet(w);
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) nav('/');
      }
    })();
  }, [nav, setMe]);

  if (!me) return null;

  const play = async () => {
    setError(null);
    // Balance / stake validation happens server-side on /queue/join (called from QueuePage).
    // We just navigate; QueuePage surfaces INSUFFICIENT_BALANCE.
    const params = new URLSearchParams({ mode });
    if (mode === 'stake' && selectedRoomId) params.set('roomId', String(selectedRoomId));
    nav(`/queue?${params.toString()}`);
  };

  const canPlay = mode !== 'stake' || selectedRoomId != null;

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-white/10 px-5 py-3">
        <div className="text-sm text-white/70">@{me.username}</div>
        <div className="flex items-center gap-2">
          {me.role === 'ADMIN' && (
            <button
              type="button"
              onClick={() => nav('/admin')}
              className="rounded bg-accent/30 px-2 py-1 text-sm text-accent hover:bg-accent/40"
            >
              admin
            </button>
          )}
          <button
            type="button"
            onClick={() => nav('/loadout')}
            className="rounded px-2 py-1 text-sm text-white/70 hover:bg-white/10"
            title={t('home.loadout')}
          >
            {t('home.loadout')}
          </button>
          <button
            type="button"
            onClick={() => nav('/shop')}
            className="rounded px-2 py-1 text-sm text-white/70 hover:bg-white/10"
          >
            {t('home.shop')}
          </button>
          <button
            type="button"
            onClick={() => nav('/wallet')}
            className="rounded px-2 py-1 text-sm hover:bg-white/10"
          >
            <span className="text-white/50">{t('home.balance')}: </span>
            <span className="font-mono">${wallet ? Number(wallet.balance).toFixed(2) : '—'}</span>
          </button>
        </div>
      </header>

      <main className="flex flex-1 flex-col items-center justify-center gap-6 px-6">
        <div className="flex gap-2">
          {(['free', 'casual', 'stake'] as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={
                'rounded-lg px-4 py-2 text-sm transition ' +
                (mode === m ? 'bg-accent text-bg' : 'bg-surface text-white/70 hover:bg-white/10')
              }
            >
              {t(`home.mode.${m}`)}
            </button>
          ))}
        </div>

        {mode === 'stake' && (
          <div className="flex gap-2">
            {STAKE_ROOMS.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => setSelectedRoomId(r.id)}
                className={
                  'rounded-lg px-4 py-2 text-sm transition ' +
                  (selectedRoomId === r.id
                    ? 'bg-emerald-500 text-bg'
                    : 'bg-surface text-white/70 hover:bg-white/10')
                }
              >
                ${r.stake}
              </button>
            ))}
          </div>
        )}

        {mode === 'casual' && (
          <div className="text-xs text-white/50">{t('home.casual_hint')}</div>
        )}

        <button
          type="button"
          onClick={() => void play()}
          disabled={!canPlay}
          className="rounded-2xl bg-accent px-16 py-6 text-2xl font-bold text-bg shadow-2xl shadow-accent/20 disabled:opacity-50"
        >
          {t('home.play')}
        </button>

        {error && <div className="text-sm text-red-400">{error}</div>}

        <p className="text-xs text-white/40">
          {mode === 'free' ? t('home.free_hint') : ''}
        </p>
      </main>
    </div>
  );
}
