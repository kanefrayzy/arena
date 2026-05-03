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

interface CharSummary {
  id: number;
  name: string;
  spriteUrl: string | null;
}

interface LoadoutResp {
  characterId: number;
}

type Mode = 'casual' | 'stake';

const SELECTABLE_MODES: Mode[] = ['casual', 'stake'];

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
  const [activeChar, setActiveChar] = useState<CharSummary | null>(null);
  const [mode, setMode] = useState<Mode>('casual');
  const [selectedRoomId, setSelectedRoomId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const u = await api.get<Me>('/auth/me');
        setMe(u);
        const w = await api.get<Wallet>('/wallet');
        setWallet(w);
        // Resolve equipped character (or fall back to first available).
        try {
          const list = await api.get<{ characters: CharSummary[] }>('/characters');
          let pick: CharSummary | null = list.characters[0] ?? null;
          try {
            const lo = await api.get<LoadoutResp>('/loadout/me');
            const found = list.characters.find((c) => c.id === lo.characterId);
            if (found) pick = found;
          } catch {
            /* no loadout yet */
          }
          setActiveChar(pick);
        } catch {
          /* ignore character fetch errors */
        }
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
          <button
            type="button"
            onClick={() => nav('/settings')}
            className="game-btn game-btn-ghost game-btn-sm"
            title={t('settings.title')}
            aria-label={t('settings.title')}
          >
            ⚙
          </button>
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

      <main className="relative z-10 flex flex-1 flex-col overflow-hidden px-6 py-4">
        {/* Mode selector (slightly lower) */}
        <div className="mt-3 flex w-full max-w-md flex-wrap justify-center gap-2 self-center">
          {SELECTABLE_MODES.map((m) => (
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
          <div className="mt-3 flex flex-wrap justify-center gap-3 self-center">
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
          <div className="mt-3 self-center game-chip text-white/80">{t('home.casual_hint')}</div>
        )}

        {/* Hero character — no background, name above, soft shadow only */}
        <div className="relative flex flex-1 flex-col items-center justify-end">
          {activeChar && (
            <>
              <div className="pointer-events-none mb-1 font-display text-base uppercase tracking-wide text-game-yellow drop-shadow-[0_2px_4px_rgba(0,0,0,0.7)]">
                {activeChar.name}
              </div>
              <button
                type="button"
                onClick={() => nav('/loadout')}
                className="group relative flex h-full w-full max-w-[340px] items-end justify-center"
                title={activeChar.name}
              >
                {/* soft ground shadow */}
                <div className="pointer-events-none absolute bottom-[8%] left-1/2 h-2.5 w-[38%] -translate-x-1/2 rounded-full bg-black/45 blur-md" />
                {activeChar.spriteUrl ? (
                  <img
                    src={activeChar.spriteUrl}
                    alt={activeChar.name}
                    className="relative max-h-[88%] max-w-[80%] animate-float object-contain drop-shadow-[0_6px_8px_rgba(0,0,0,0.45)] transition-transform group-active:scale-95"
                  />
                ) : (
                  <div className="relative h-40 w-40 animate-float rounded-full bg-white/10" />
                )}
              </button>
            </>
          )}
        </div>

        {/* PLAY */}
        <div className="-mt-6 flex flex-col items-center gap-2">
          <button
            type="button"
            onClick={() => void play()}
            disabled={!canPlay}
            className="game-btn game-btn-yellow game-btn-xl game-shimmer animate-pulse-glow disabled:animate-none"
          >
            <span className="mr-2 inline-block">🎯</span>
            {t('home.play')}
          </button>
          {error && <div className="text-sm font-semibold text-game-red">{error}</div>}
        </div>

        {/* Bottom nav */}
        <div className="mt-3 grid w-full max-w-md grid-cols-2 gap-3 self-center pb-2">
          <button
            type="button"
            onClick={() => nav('/loadout')}
            className="game-btn game-btn-purple"
          >
            <span className="mr-2">🎽</span>
            {t('home.loadout')}
          </button>
          <button
            type="button"
            onClick={() => nav('/shop')}
            className="game-btn game-btn-pink"
          >
            <span className="mr-2">🛒</span>
            {t('home.shop')}
          </button>
        </div>
      </main>
    </div>
  );
}
