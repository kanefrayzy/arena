import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../../shared/api/client';
import { useAuth, type Me } from '../../shared/store/auth';
import * as sfx from '../../shared/game/audio';

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
    sfx.unlockAudio();
    sfx.uiClick();
    // Balance / stake validation happens server-side on /queue/join (called from QueuePage).
    // We just navigate; QueuePage surfaces INSUFFICIENT_BALANCE.
    const params = new URLSearchParams({ mode });
    if (mode === 'stake' && selectedRoomId) params.set('roomId', String(selectedRoomId));
    nav(`/queue?${params.toString()}`);
  };

  const canPlay = mode !== 'stake' || selectedRoomId != null;

  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      {/* Decorative blobs */}
      <div className="pointer-events-none absolute -top-32 -left-20 h-72 w-72 rounded-full bg-game-purple/40 blur-3xl" />
      <div className="pointer-events-none absolute bottom-0 right-0 h-72 w-72 rounded-full bg-game-pink/25 blur-3xl" />

      <header className="game-panel relative z-10 flex items-center justify-between px-4 py-3">
        <button
          type="button"
          onClick={() => nav('/wallet')}
          className="game-chip game-chip-yellow text-base"
          title={t('home.balance')}
        >
          <span className="text-[#1a1450]">$</span>
          <span className="font-mono">
            {wallet ? Number(wallet.balance).toFixed(2) : '—'}
          </span>
        </button>
        <div className="game-title text-lg text-white/90">@{me.username}</div>
        <div className="flex items-center gap-1.5">
          {me.role === 'ADMIN' && (
            <button
              type="button"
              onClick={() => nav('/admin')}
              className="game-btn game-btn-pink game-btn-sm"
            >
              admin
            </button>
          )}
        </div>
      </header>

      <main className="relative z-10 flex flex-1 flex-col items-center gap-6 overflow-y-auto px-6 py-6">
        {/* Mode selector */}
        <div className="flex w-full max-w-md flex-wrap justify-center gap-2">
          {(['free', 'casual', 'stake'] as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={
                'game-btn game-btn-sm ' +
                (mode === m ? 'game-btn-yellow' : 'game-btn-ghost')
              }
            >
              {t(`home.mode.${m}`)}
            </button>
          ))}
        </div>

        {mode === 'stake' && (
          <div className="flex flex-wrap justify-center gap-3">
            {STAKE_ROOMS.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => setSelectedRoomId(r.id)}
                className={
                  'game-btn ' +
                  (selectedRoomId === r.id ? 'game-btn-green' : 'game-btn-ghost')
                }
              >
                ${r.stake}
              </button>
            ))}
          </div>
        )}

        {mode === 'casual' && (
          <div className="game-chip text-white/80">{t('home.casual_hint')}</div>
        )}

        {/* PLAY button — hero */}
        <div className="flex flex-1 items-center justify-center">
          <button
            type="button"
            onClick={() => void play()}
            disabled={!canPlay}
            className="game-btn game-btn-yellow game-btn-xl game-shimmer animate-pulse-glow disabled:animate-none"
          >
            ▶ {t('home.play')}
          </button>
        </div>

        {error && <div className="text-sm font-semibold text-game-red">{error}</div>}

        {mode === 'free' && (
          <p className="text-center text-xs text-white/50">{t('home.free_hint')}</p>
        )}

        {/* Bottom nav */}
        <div className="grid w-full max-w-md grid-cols-2 gap-3 pb-2">
          <button
            type="button"
            onClick={() => nav('/loadout')}
            className="game-btn game-btn-purple"
          >
            {t('home.loadout')}
          </button>
          <button
            type="button"
            onClick={() => nav('/shop')}
            className="game-btn game-btn-pink"
          >
            {t('home.shop')}
          </button>
        </div>
      </main>
    </div>
  );
}
