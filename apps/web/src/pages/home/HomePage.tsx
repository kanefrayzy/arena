import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../../shared/api/client';
import { useAuth, type Me } from '../../shared/store/auth';
import * as sfx from '../../shared/game/audio';
import { MatchHistoryModal } from './MatchHistoryModal';
import { NotificationsPanel } from './NotificationsPanel';

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
  const [showHistory, setShowHistory] = useState(false);
  const [showNotifs, setShowNotifs] = useState(false);
  const [unreadNotifs, setUnreadNotifs] = useState(0);

  useEffect(() => {
    void (async () => {
      try {
        const u = await api.get<Me>('/auth/me');
        setMe(u);
        const w = await api.get<Wallet>('/wallet');
        setWallet(w);
        // Fetch unread notification count
        try {
          const nr = await api.get<{ items: unknown[]; unreadCount: number }>('/notifications?limit=1');
          setUnreadNotifs(nr.unreadCount);
        } catch { /* ignore */ }
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

        {/* Hero character — centered, with history/notif side buttons like Clash Royale */}
        <div className="relative flex flex-1 items-center justify-center">
          {/* LEFT: Match history */}
          <button
            type="button"
            onClick={() => setShowHistory(true)}
            className="absolute left-0 top-1/2 -translate-y-1/2 flex flex-col items-center gap-1 rounded-2xl border border-white/10 bg-black/30 px-2 py-3 text-white/70 backdrop-blur hover:bg-black/50 active:scale-95"
            title={t('history.title', 'История матчей')}
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5 text-game-yellow" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
            </svg>
            <span className="text-[10px] font-semibold text-white/50">Итоги</span>
          </button>

          {/* RIGHT: Notifications */}
          <button
            type="button"
            onClick={() => setShowNotifs(true)}
            className="absolute right-0 top-1/2 -translate-y-1/2 flex flex-col items-center gap-1 rounded-2xl border border-white/10 bg-black/30 px-2 py-3 text-white/70 backdrop-blur hover:bg-black/50 active:scale-95"
            title="Уведомления"
          >
            <span className="relative">
              <svg viewBox="0 0 24 24" className="h-5 w-5 text-game-cyan" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
              {unreadNotifs > 0 && (
                <span className="absolute -top-1.5 -right-1.5 h-4 w-4 rounded-full bg-rose-500 text-[9px] font-bold text-white flex items-center justify-center">
                  {unreadNotifs > 9 ? '9+' : unreadNotifs}
                </span>
              )}
            </span>
            <span className="text-[10px] font-semibold text-white/50">Новости</span>
          </button>
          {activeChar && (
            <button
              type="button"
              onClick={() => nav('/loadout')}
              className="group relative flex h-full w-full max-w-[340px] flex-col items-center justify-center"
              title={activeChar.name}
            >
              <div className="pointer-events-none mb-1 font-display text-base uppercase tracking-wide text-game-yellow drop-shadow-[0_2px_4px_rgba(0,0,0,0.7)]">
                {activeChar.name}
              </div>
              <div className="relative flex flex-1 w-full items-center justify-center">
                {/* soft ground shadow */}
                <div className="pointer-events-none absolute bottom-[6%] left-1/2 h-2.5 w-[38%] -translate-x-1/2 rounded-full bg-black/45 blur-md" />
                {activeChar.spriteUrl ? (
                  <img
                    src={activeChar.spriteUrl}
                    alt={activeChar.name}
                    className="relative max-h-full max-w-[80%] animate-float object-contain drop-shadow-[0_6px_8px_rgba(0,0,0,0.45)] transition-transform group-active:scale-95"
                  />
                ) : (
                  <div className="relative h-40 w-40 animate-float rounded-full bg-white/10" />
                )}
              </div>
            </button>
          )}
        </div>

        {/* PLAY */}
        <div className="-mt-10 flex flex-col items-center gap-2">
          <button
            type="button"
            onClick={() => void play()}
            disabled={!canPlay}
            className="game-btn game-btn-yellow game-btn-xl game-shimmer animate-pulse-glow disabled:animate-none inline-flex items-center gap-2"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <circle cx="12" cy="12" r="9" />
              <circle cx="12" cy="12" r="4" />
              <path d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3" />
            </svg>
            {t('home.play')}
          </button>
          {error && <div className="text-sm font-semibold text-game-red">{error}</div>}
        </div>

        {/* Bottom nav */}
        <div className="mt-3 grid w-full max-w-md grid-cols-2 gap-3 self-center pb-2">
          <button
            type="button"
            onClick={() => nav('/loadout')}
            className="game-btn game-btn-purple inline-flex items-center justify-center gap-2"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M9 3l3 2 3-2 4 3v5l-3 1v9H8v-9l-3-1V6z" />
              <path d="M9 3v3M15 3v3" />
            </svg>
            {t('home.loadout')}
          </button>
          <button
            type="button"
            onClick={() => nav('/shop')}
            className="game-btn game-btn-pink inline-flex items-center justify-center gap-2"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M3 4h2l2.4 11.2a2 2 0 002 1.6h7.8a2 2 0 002-1.5L21 8H6" />
              <circle cx="9" cy="20" r="1.5" />
              <circle cx="17" cy="20" r="1.5" />
            </svg>
            {t('home.shop')}
          </button>
        </div>
      </main>

      {showHistory && <MatchHistoryModal onClose={() => setShowHistory(false)} />}
      {showNotifs && (
        <NotificationsPanel
          onClose={() => setShowNotifs(false)}
          onUnreadChange={setUnreadNotifs}
        />
      )}
    </div>
  );
}
