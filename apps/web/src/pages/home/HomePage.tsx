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

      {/* ── TOP BAR ── */}
      <header className="game-panel relative z-10 flex items-center justify-between px-4 py-2.5">
        {/* Balance chip → wallet */}
        <button
          type="button"
          onClick={() => nav('/wallet')}
          className="game-chip game-chip-yellow text-base"
          title={t('home.balance')}
        >
          <span className="text-[#1a1450]">$</span>
          <span className="font-mono">{wallet ? Number(wallet.balance).toFixed(2) : '—'}</span>
        </button>

        <div className="game-title text-lg text-white/90">@{me.username}</div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => nav('/settings')}
            className="game-btn game-btn-ghost game-btn-sm"
            aria-label={t('settings.title')}
          >⚙</button>
          {me.role === 'ADMIN' && (
            <button type="button" onClick={() => nav('/admin')} className="game-btn game-btn-pink game-btn-sm">
              admin
            </button>
          )}
        </div>
      </header>

      <main className="relative z-10 flex flex-1 flex-col overflow-hidden">

        {/* ── MODE TABS ── */}
        <div className="flex justify-center gap-2 px-6 pt-3">
          {SELECTABLE_MODES.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={'game-btn game-btn-sm ' + (mode === m ? 'game-btn-yellow' : 'game-btn-ghost')}
            >
              {t(`home.mode.${m}`)}
            </button>
          ))}
        </div>

        {/* Stake room picker */}
        {mode === 'stake' && (
          <div className="mt-2 flex justify-center gap-2 px-6">
            {STAKE_ROOMS.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => setSelectedRoomId(r.id)}
                className={'game-btn game-btn-sm ' + (selectedRoomId === r.id ? 'game-btn-green' : 'game-btn-ghost')}
              >
                ${r.stake}
              </button>
            ))}
          </div>
        )}

        {/* ── CHARACTER AREA (flex-1) ── */}
        <div className="relative flex flex-1 overflow-hidden">

          {/* History — top-left corner of char area */}
          <button
            type="button"
            onClick={() => setShowHistory(true)}
            className="absolute left-4 top-2 z-20 flex h-11 w-11 items-center justify-center rounded-2xl border border-game-yellow/40 bg-black/40 text-game-yellow backdrop-blur active:scale-90 hover:bg-black/60"
            aria-label="История матчей"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
            </svg>
          </button>

          {/* Notifications — top-right corner of char area */}
          <button
            type="button"
            onClick={() => setShowNotifs(true)}
            className="absolute right-4 top-2 z-20 flex h-11 w-11 items-center justify-center rounded-2xl border border-game-cyan/40 bg-black/40 text-game-cyan backdrop-blur active:scale-90 hover:bg-black/60"
            aria-label="Уведомления"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
            {unreadNotifs > 0 && (
              <span className="absolute -top-1.5 -right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-rose-500 text-[9px] font-bold text-white">
                {unreadNotifs > 9 ? '9+' : unreadNotifs}
              </span>
            )}
          </button>

          {/* Character — fills entire area */}
          {activeChar && (
            <button
              type="button"
              onClick={() => nav('/loadout')}
              className="group absolute inset-0 z-10 flex flex-col items-center"
              title={activeChar.name}
            >
              {/* Image wrapper — takes all vertical space, top padding clears the buttons */}
              <div className="flex min-h-0 flex-1 w-full items-end justify-center pt-16 pb-0">
                {activeChar.spriteUrl ? (
                  (() => {
                    const isWebm = /\.webm(\?|$)/i.test(activeChar.spriteUrl ?? '');
                    const cls = 'max-h-full w-auto max-w-[75%] object-contain drop-shadow-[0_14px_32px_rgba(0,0,0,0.7)] transition-transform group-active:scale-95';
                    return isWebm
                      ? <video src={activeChar.spriteUrl} autoPlay loop muted playsInline className={cls} />
                      : <img src={activeChar.spriteUrl} alt={activeChar.name} className={cls} />;
                  })()
                ) : (
                  <div className="h-40 w-40 rounded-full bg-white/10" />
                )}
              </div>

              {/* Platform shadow image */}
              <div className="pointer-events-none" style={{ marginTop: '-12px' }}>
                <img src="/shadow.webp" alt="" aria-hidden className="w-48 select-none" draggable={false} />
              </div>

              {/* Name label */}
              <div className="mt-2 mb-3 rounded-full bg-black/50 px-4 py-0.5 font-display text-sm uppercase tracking-wide text-game-yellow backdrop-blur-sm drop-shadow-[0_2px_4px_rgba(0,0,0,0.7)]">
                {activeChar.name}
              </div>
            </button>
          )}
        </div>

        {/* ── BOTTOM DOCK ── */}
        <div className="flex flex-col items-center gap-3 px-6 pb-4 pt-2">
          {/* PLAY */}
          <button
            type="button"
            onClick={() => void play()}
            disabled={!canPlay}
            className="game-btn game-btn-yellow game-btn-xl game-shimmer animate-pulse-glow disabled:animate-none w-full max-w-xs"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <circle cx="12" cy="12" r="9" />
              <circle cx="12" cy="12" r="4" />
              <path d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3" />
            </svg>
            {t('home.play')}
          </button>

          {error && <div className="text-sm font-semibold text-game-red">{error}</div>}

          {/* Loadout + Shop */}
          <div className="grid w-full max-w-xs grid-cols-2 gap-3">
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
