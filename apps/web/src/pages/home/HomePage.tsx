import { useEffect, useRef, useState } from 'react';
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
        {/* Balance — Brawl-Stars-style coin pill → wallet */}
        <button
          type="button"
          onClick={() => nav('/wallet')}
          className="group relative inline-flex items-center gap-1.5 rounded-full border-b-2 border-emerald-800/80 bg-gradient-to-b from-emerald-300 via-emerald-400 to-emerald-600 px-3 py-1 shadow-[0_3px_0_rgba(0,0,0,0.35),inset_0_1px_0_rgba(255,255,255,0.45)] transition active:translate-y-0.5 active:border-b-0 active:shadow-[inset_0_1px_0_rgba(255,255,255,0.45)]"
          title={t('home.balance')}
        >
          <span className="flex h-5 w-5 items-center justify-center rounded-full border border-yellow-700/80 bg-gradient-to-b from-yellow-200 via-yellow-400 to-yellow-600 text-[10px] font-black text-yellow-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.6)]">$</span>
          <span className="font-mono font-black text-emerald-950 drop-shadow-[0_1px_0_rgba(255,255,255,0.4)] tabular-nums">
            {wallet ? Number(wallet.balance).toFixed(2) : '—'}
          </span>
        </button>

        <div className="flex flex-col items-center gap-0.5">
          <div className="game-title text-lg text-white/90">@{me.username}</div>
          <RankBadge cup={me.cup ?? 0} />
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => nav('/settings')}
            className="group relative h-9 w-9 rounded-xl border-b-2 border-slate-700/80 bg-gradient-to-b from-slate-300 via-slate-400 to-slate-600 text-slate-900 shadow-[0_3px_0_rgba(0,0,0,0.35),inset_0_1px_0_rgba(255,255,255,0.5)] transition active:translate-y-0.5 active:border-b-0"
            aria-label={t('settings.title')}
          >
            <svg viewBox="0 0 24 24" className="mx-auto h-5 w-5 transition-transform group-hover:rotate-45" fill="currentColor" aria-hidden>
              <path d="M12 15.5a3.5 3.5 0 110-7 3.5 3.5 0 010 7zm7.4-3.5l1.7-1.3-1.7-3-2 .7a7.5 7.5 0 00-1.5-.9L15.5 5h-3.4l-.4 2.5a7.5 7.5 0 00-1.5.9l-2-.7-1.7 3 1.7 1.3a7.6 7.6 0 000 1.7L4.5 14l1.7 3 2-.7a7.5 7.5 0 001.5.9l.4 2.5h3.4l.4-2.5a7.5 7.5 0 001.5-.9l2 .7 1.7-3-1.7-1.3a7.6 7.6 0 000-1.7z" />
            </svg>
          </button>
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
              {/* Image wrapper — takes all vertical space, top padding clears the buttons */}
              <div className="flex min-h-0 flex-1 w-full items-end justify-center pt-16 pb-0">
                {activeChar.spriteUrl ? (
                  (() => {
                    const isWebm = /\.webm(\?|$)/i.test(activeChar.spriteUrl ?? '');
                    const cls = 'max-h-full w-auto max-w-[75%] object-contain drop-shadow-[0_14px_32px_rgba(0,0,0,0.7)] animate-float';
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

interface RankTier {
  name: string;
  min: number;
  emoji: string;
  /** Tailwind classes for ring + bg gradient + text. */
  ring: string;
  glow: string;
  text: string;
}

const RANK_TIERS: RankTier[] = [
  { name: 'Bronze',   min: 0,    emoji: '🥉', ring: 'ring-amber-700/60',  glow: 'from-amber-700/30 to-amber-900/10',  text: 'text-amber-300' },
  { name: 'Silver',   min: 100,  emoji: '🥈', ring: 'ring-slate-300/60',  glow: 'from-slate-300/30 to-slate-500/10', text: 'text-slate-200' },
  { name: 'Gold',     min: 300,  emoji: '🥇', ring: 'ring-yellow-400/70', glow: 'from-yellow-400/35 to-yellow-700/10', text: 'text-yellow-200' },
  { name: 'Platinum', min: 600,  emoji: '🛡️', ring: 'ring-cyan-300/60',   glow: 'from-cyan-300/30 to-cyan-600/10',   text: 'text-cyan-200' },
  { name: 'Diamond',  min: 1000, emoji: '💎', ring: 'ring-sky-300/70',    glow: 'from-sky-300/35 to-indigo-600/10',  text: 'text-sky-200' },
  { name: 'Master',   min: 1500, emoji: '👑', ring: 'ring-fuchsia-400/70', glow: 'from-fuchsia-400/40 to-purple-700/15', text: 'text-fuchsia-200' },
  { name: 'Legend',   min: 2500, emoji: '⚡', ring: 'ring-rose-400/80',   glow: 'from-rose-400/40 to-orange-500/15', text: 'text-rose-200' },
];

function tierFor(cup: number): { tier: RankTier; next: RankTier | null } {
  let tier = RANK_TIERS[0]!;
  let next: RankTier | null = RANK_TIERS[1] ?? null;
  for (let i = 0; i < RANK_TIERS.length; i++) {
    if (cup >= RANK_TIERS[i]!.min) {
      tier = RANK_TIERS[i]!;
      next = RANK_TIERS[i + 1] ?? null;
    }
  }
  return { tier, next };
}

function RankBadge({ cup }: { cup: number }) {
  const { tier } = tierFor(cup);
  return (
    <div
      className={
        'group relative inline-flex items-center gap-1.5 rounded-full pl-1 pr-3 py-0.5 text-sm ' +
        'bg-gradient-to-b from-black/55 via-black/35 to-black/60 ring-1 ' + tier.ring +
        ' shadow-[0_2px_8px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.08)]'
      }
      title={`${tier.name} · ${cup}`}
    >
      {/* 3D trophy medallion */}
      <span
        aria-hidden="true"
        className={
          'relative -ml-0.5 inline-flex h-6 w-6 items-center justify-center rounded-full ' +
          'border border-yellow-700/80 bg-gradient-to-b from-yellow-200 via-yellow-400 to-amber-600 ' +
          'shadow-[0_1px_0_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.7)]'
        }
      >
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 text-amber-900 drop-shadow-[0_1px_0_rgba(255,255,255,0.4)]" fill="currentColor" aria-hidden>
          <path d="M7 4h10v2h3v3a4 4 0 0 1-4 4h-.18A5 5 0 0 1 13 15.9V18h2v2H9v-2h2v-2.1A5 5 0 0 1 7.18 13H7a4 4 0 0 1-4-4V6h4V4zm0 4H5v1a2 2 0 0 0 2 2V8zm10 0v3a2 2 0 0 0 2-2V8h-2z" />
        </svg>
      </span>
      <span className={'font-display font-black tabular-nums text-base leading-none ' + tier.text + ' drop-shadow-[0_1px_0_rgba(0,0,0,0.6)]'}>{cup}</span>
    </div>
  );
}
