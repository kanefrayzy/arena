import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../../shared/api/client';
import { useAuth, type Me } from '../../shared/store/auth';
import * as sfx from '../../shared/game/audio';
import { MatchHistoryModal } from './MatchHistoryModal';
import { NotificationsPanel } from './NotificationsPanel';
import { RankBadge } from '../../shared/ui/rank';

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
  // Per-mode display labels sourced from /queue/rooms so admins can rename
  // rooms without redeploying the UI (e.g. "Casual" → "Training").
  const [modeLabels, setModeLabels] = useState<Partial<Record<Mode, string>>>({});
  const [error, setError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [showNotifs, setShowNotifs] = useState(false);
  const [unreadNotifs, setUnreadNotifs] = useState(0);
  const [spriteW, setSpriteW] = useState(120);
  const spriteRef = useRef<HTMLImageElement | HTMLVideoElement | null>(null);

  // Measure rendered sprite width to scale shadow
  const measureSprite = (el: HTMLImageElement | HTMLVideoElement | null) => {
    if (el) setSpriteW(el.offsetWidth || 120);
  };

  useEffect(() => {
    void (async () => {
      try {
        const u = await api.get<Me>('/auth/me');
        setMe(u);
        const [walletRes, notifsRes, charRes] = await Promise.allSettled([
          api.get<Wallet>('/wallet'),
          api.get<{ items: unknown[]; unreadCount: number }>('/notifications?limit=1'),
          api.get<{ characters: CharSummary[] }>('/characters').then(async (list) => {
            let pick: CharSummary | null = list.characters[0] ?? null;
            try {
              const lo = await api.get<LoadoutResp>('/loadout/me');
              const found = list.characters.find((c) => c.id === lo.characterId);
              if (found) pick = found;
            } catch { /* no loadout yet */ }
            return pick;
          }),
        ]);
        if (walletRes.status === 'fulfilled') setWallet(walletRes.value);
        if (notifsRes.status === 'fulfilled') setUnreadNotifs(notifsRes.value.unreadCount);
        if (charRes.status === 'fulfilled') setActiveChar(charRes.value);
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) nav('/');
      }
    })();
  }, [nav, setMe]);

  // Fetch room list once to populate the mode-tab labels from server-side
  // room names (admin-editable). Falls back to i18n labels on failure.
  useEffect(() => {
    void (async () => {
      try {
        const res = await api.get<{ items: { id: number; name: string; mode: 'FREE' | 'CASUAL' | 'STAKE' }[] }>(
          '/queue/rooms',
        );
        const casual = res.items.find((r) => r.mode === 'CASUAL');
        if (casual) setModeLabels({ casual: casual.name });
      } catch { /* fall back to i18n */ }
    })();
  }, []);

  // Poll wallet + unread notifications every 15s so deposit completions and
  // server-side notifications surface in near real-time without a WebSocket.
  useEffect(() => {
    const tick = async () => {
      try {
        const [w, n] = await Promise.allSettled([
          api.get<Wallet>('/wallet'),
          api.get<{ items: unknown[]; unreadCount: number }>('/notifications?limit=1'),
        ]);
        if (w.status === 'fulfilled') setWallet(w.value);
        if (n.status === 'fulfilled') setUnreadNotifs(n.value.unreadCount);
      } catch { /* ignore */ }
    };
    const id = setInterval(() => { void tick(); }, 15_000);
    const onVis = () => { if (document.visibilityState === 'visible') void tick(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVis); };
  }, []);

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
        {/* Balance — clean dark capsule with gold dollar chip */}
        <button
          type="button"
          onClick={() => nav('/wallet')}
          className="group inline-flex items-center gap-2 rounded-full border border-white/10 bg-gradient-to-b from-black/40 to-black/60 py-1 pl-1 pr-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] transition hover:border-game-yellow/40 hover:from-black/30 hover:to-black/50 active:scale-[0.98]"
          title={t('home.balance')}
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-b from-game-yellow to-amber-500 text-[14px] font-black text-amber-950 shadow-[inset_0_1px_0_rgba(255,255,255,0.5),0_1px_2px_rgba(0,0,0,0.4)]">
            $
          </span>
          <span className="font-mono text-[15px] font-semibold leading-none text-white tabular-nums">
            {wallet ? Number(wallet.balance).toFixed(4) : '—'}
          </span>
          <svg viewBox="0 0 12 12" className="h-3 w-3 text-white/40 transition group-hover:text-game-yellow" fill="currentColor" aria-hidden>
            <path d="M6 2v8M6 2l3 3M6 2l-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" transform="rotate(180 6 6)" />
          </svg>
        </button>

        <button
          type="button"
          onClick={() => nav(`/u/${me.id}`)}
          className="flex flex-col items-center gap-0.5 rounded-xl px-2 py-1 transition active:scale-95 hover:bg-white/5"
          aria-label={t('profile.title', 'Профиль')}
        >
          <div className="game-title text-lg text-white/90">@{me.username}</div>
          <RankBadge cup={me.cup ?? 0} />
        </button>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => nav('/settings')}
            className="group relative inline-flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-gradient-to-b from-white/[0.08] to-white/[0.02] text-white/80 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] transition hover:border-white/25 hover:text-white active:scale-95"
            aria-label={t('settings.title')}
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5 transition-transform duration-300 group-hover:rotate-90" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
          {me.role === 'ADMIN' && (
            <button type="button" onClick={() => nav('/adfaur')} className="game-btn game-btn-pink game-btn-sm">
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
              {modeLabels[m] ?? t(`home.mode.${m}`)}
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

          {/* History — Brawl-Stars-style round icon button (clock-rewind) */}
          <button
            type="button"
            onClick={() => setShowHistory(true)}
            className="absolute left-3 top-2 z-20 group h-14 w-14 rounded-2xl border-b-4 border-amber-700/80 bg-gradient-to-b from-amber-300 via-amber-400 to-amber-600 text-amber-950 shadow-[0_4px_0_rgba(0,0,0,0.35),inset_0_2px_0_rgba(255,255,255,0.55)] transition active:translate-y-1 active:border-b-2 active:shadow-[0_2px_0_rgba(0,0,0,0.35),inset_0_2px_0_rgba(255,255,255,0.55)]"
            aria-label="История матчей"
          >
            <span className="pointer-events-none absolute inset-x-1.5 top-1 h-2 rounded-full bg-white/55 blur-[1px]" />
            <svg viewBox="0 0 24 24" className="relative mx-auto h-7 w-7 transition-transform group-hover:-rotate-12" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M3 12a9 9 0 1 0 3-6.7" />
              <polyline points="3 4 3 9 8 9" />
              <polyline points="12 7 12 12 16 14" />
            </svg>
          </button>

          {/* Notifications — Brawl-Stars-style round icon button */}
          <button
            type="button"
            onClick={() => setShowNotifs(true)}
            className="absolute right-3 top-2 z-20 group h-14 w-14 rounded-2xl border-b-4 border-cyan-800/80 bg-gradient-to-b from-cyan-300 via-cyan-400 to-cyan-600 text-cyan-950 shadow-[0_4px_0_rgba(0,0,0,0.35),inset_0_2px_0_rgba(255,255,255,0.55)] transition active:translate-y-1 active:border-b-2 active:shadow-[0_2px_0_rgba(0,0,0,0.35),inset_0_2px_0_rgba(255,255,255,0.55)]"
            aria-label="Уведомления"
          >
            <span className="pointer-events-none absolute inset-x-1.5 top-1 h-2 rounded-full bg-white/55 blur-[1px]" />
            <svg viewBox="0 0 24 24" className={'relative mx-auto h-7 w-7 ' + (unreadNotifs > 0 ? 'animate-bell' : '')} fill="currentColor" aria-hidden>
              <path d="M12 2a2 2 0 00-2 2v.6C7.16 5.4 5 8 5 11v3.5L3.3 17a1 1 0 00.85 1.5h15.7A1 1 0 0020.7 17L19 14.5V11c0-3-2.16-5.6-5-6.4V4a2 2 0 00-2-2zm-2.2 18a2.2 2.2 0 004.4 0H9.8z" />
            </svg>
            {unreadNotifs > 0 && (
              <span className="absolute -top-1.5 -right-1.5 flex h-5 min-w-[20px] items-center justify-center rounded-full border-2 border-white/90 bg-rose-500 px-1 text-[10px] font-black text-white shadow-[0_2px_0_rgba(0,0,0,0.35)]">
                {unreadNotifs > 9 ? '9+' : unreadNotifs}
              </span>
            )}
          </button>

          {/* Character — fills entire area */}
          {activeChar && (
            <div
              className="absolute inset-0 z-10 flex flex-col items-center"
            >
              {/* Image wrapper — takes all vertical space, top padding clears the buttons.
                  Static radial ellipse below acts as the ground shadow (cheap GPU paint),
                  replacing the expensive `filter: drop-shadow` that used to re-rasterise
                  the sprite every frame of the float animation. */}
              <div className="relative flex min-h-0 flex-1 w-full items-end justify-center pt-16 pb-0">
                <div
                  aria-hidden
                  className="pointer-events-none absolute bottom-2 left-1/2 h-6 w-[55%] -translate-x-1/2 rounded-[50%]"
                  style={{ background: 'radial-gradient(ellipse at center, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.25) 45%, transparent 75%)' }}
                />
                {activeChar.spriteUrl ? (
                  (() => {
                    const isWebm = /\.webm(\?|$)/i.test(activeChar.spriteUrl ?? '');
                    const cls = 'relative max-h-full w-auto max-w-[75%] object-contain animate-float';
                    return isWebm
                      ? <video
                          key={activeChar.spriteUrl}
                          ref={el => { spriteRef.current = el; measureSprite(el); }}
                          src={activeChar.spriteUrl} autoPlay loop muted playsInline
                          className={cls}
                          onLoadedMetadata={e => measureSprite(e.currentTarget)}
                        />
                      : <img
                          key={activeChar.spriteUrl}
                          ref={el => { spriteRef.current = el; }}
                          src={activeChar.spriteUrl} alt={activeChar.name}
                          className={cls}
                          onLoad={e => measureSprite(e.currentTarget)}
                        />;
                  })()
                ) : (
                  <div className="h-40 w-40 rounded-full bg-white/10" />
                )}
              </div>

              {/* Realistic 3-layer contact shadow — scales with sprite width */}
              {/* TODO: shadow disabled temporarily */}
              {/* {(() => {
                const aw = spriteW; // ambient
                const pw = Math.round(aw * 0.65); // penumbra
                const uw = Math.round(aw * 0.38); // umbra
                const containerW = aw + 60;
                return (
                  <div className="pointer-events-none relative" style={{ marginTop: '-4px', height: '36px', width: `${containerW}px`, flexShrink: 0 }}>
                    {/* Ambient occlusion */}
                    {/*<div style={{
                      position: 'absolute', top: '50%', left: '50%',
                      transform: 'translate(-50%, -50%)',
                      width: `${aw + 50}px`, height: `${Math.round(aw * 0.16)}px`,
                      borderRadius: '50%',
                      background: 'radial-gradient(ellipse at center, rgba(0,0,0,0.28) 0%, transparent 70%)',
                      filter: 'blur(14px)',
                    }} />
                    {/* Penumbra */}
                    {/*<div style={{
                      position: 'absolute', top: '50%', left: '50%',
                      transform: 'translate(-50%, -50%)',
                      width: `${pw + 20}px`, height: `${Math.round(pw * 0.14)}px`,
                      borderRadius: '50%',
                      background: 'radial-gradient(ellipse at center, rgba(0,0,0,0.52) 0%, transparent 75%)',
                      filter: 'blur(5px)',
                    }} />
                    {/* Umbra — contact point */}
                    {/*<div style={{
                      position: 'absolute', top: '50%', left: '50%',
                      transform: 'translate(-50%, -50%)',
                      width: `${uw}px`, height: `${Math.round(uw * 0.14)}px`,
                      borderRadius: '50%',
                      background: 'radial-gradient(ellipse at center, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.45) 50%, transparent 100%)',
                      filter: 'blur(2px)',
                    }} />
                  </div>
                );
              })()} */}

              {/* Name label */}
              <div className="mt-2 mb-3 rounded-full bg-black/50 px-4 py-0.5 font-display text-sm uppercase tracking-wide text-game-yellow backdrop-blur-sm drop-shadow-[0_2px_4px_rgba(0,0,0,0.7)]">
                {activeChar.name}
              </div>
            </div>
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

// Rank tier table + RankBadge moved to ../../shared/ui/rank.

// RankBadge moved to ../../shared/ui/rank.
