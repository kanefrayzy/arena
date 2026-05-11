import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth, type Me } from '../../shared/store/auth';
import { api } from '../../shared/api/client';
import { toast } from '../../shared/ui/toast';
import { ResultFx } from './ResultFx';

interface ResultData {
  winnerId: number | null;
  reason: 'kill' | 'timeout' | 'disconnect' | 'draw';
  durationMs: number;
  score: Record<string, number>;
  opponent: { id: number; username: string };
  room?: { id: number; name?: string; mode: 'FREE' | 'CASUAL' | 'STAKE'; stakeUsd?: string };
  /** Embedded by MatchPage so the result page renders even when the global
   *  auth store hasn't bootstrapped yet (e.g. after a mid-match page refresh
   *  the user lands on /result without ever passing through HomePage). */
  youId?: number;
  /** Cup value captured when the user entered the match page. */
  cupBefore?: number;
}

export function ResultPage() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const { id } = useParams();
  const me = useAuth((s) => s.me);
  const setMe = useAuth((s) => s.setMe);
  const [data, setData] = useState<ResultData | null>(null);
  /** Result page locks the dismiss button for 1s so players have a moment
   *  to read win/loss + cup delta before tapping away. */
  const [btnEnabled, setBtnEnabled] = useState(false);
  /** Animated cup counter (interpolates from cupBefore to cupAfter). */
  const [displayedCup, setDisplayedCup] = useState<number | null>(null);
  const [cupAfter, setCupAfter] = useState<number | null>(null);

  useEffect(() => {
    if (!id) return;
    const raw = sessionStorage.getItem(`result:${id}`);
    if (!raw) {
      nav('/home');
      return;
    }
    setData(JSON.parse(raw) as ResultData);
  }, [id, nav]);

  // 1-second activation gate for the back button.
  useEffect(() => {
    const t = window.setTimeout(() => setBtnEnabled(true), 1000);
    return () => window.clearTimeout(t);
  }, []);

  // After mount, refresh /auth/me with a short retry loop until cup differs
  // from cupBefore OR ~3 s elapsed. The api updates stats asynchronously via
  // the game server's /internal/matches/finish callback, so the new cup is
  // not necessarily ready at the exact moment this page mounts.
  useEffect(() => {
    if (!data) return;
    const before = data.cupBefore ?? me?.cup ?? 0;
    setDisplayedCup(before);
    let cancelled = false;
    let attempt = 0;
    const tryOnce = async () => {
      try {
        const fresh = await api.get<Me>('/auth/me');
        if (cancelled) return;
        setMe(fresh);
        const after = fresh.cup ?? before;
        if (after !== before || attempt >= 7) {
          setCupAfter(after);
          return;
        }
      } catch {
        /* network blip — try again */
      }
      attempt += 1;
      window.setTimeout(() => { void tryOnce(); }, 400);
    };
    void tryOnce();
    return () => { cancelled = true; };
  }, [data, me?.cup, setMe]);

  // Animate displayedCup from cupBefore → cupAfter (~900 ms ease-out).
  useEffect(() => {
    if (!data || cupAfter == null) return;
    const before = data.cupBefore ?? 0;
    const after = cupAfter;
    if (before === after) return;
    const startedAt = performance.now();
    const dur = 900;
    let raf = 0;
    const step = (now: number) => {
      const k = Math.min(1, (now - startedAt) / dur);
      const eased = 1 - Math.pow(1 - k, 3); // ease-out cubic
      setDisplayedCup(Math.round(before + (after - before) * eased));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [cupAfter, data]);

  if (!data) return null;

  // Prefer the youId baked into the result payload; fall back to the auth
  // store (regular happy-path navigation from HomePage). If neither is
  // available we still render the result with no "you" identification rather
  // than a blank screen.
  const youId = data.youId ?? me?.id ?? -1;
  const youHp = data.score[String(youId)] ?? 0;
  const oppHp = data.score[String(data.opponent.id)] ?? 0;
  const outcome: 'win' | 'loss' | 'draw' =
    data.winnerId === null ? 'draw' : data.winnerId === youId ? 'win' : 'loss';
  const titleClass =
    outcome === 'win'
      ? 'text-game-yellow drop-shadow-[0_4px_0_rgba(0,0,0,0.5)]'
      : outcome === 'loss'
        ? 'text-game-red drop-shadow-[0_4px_0_rgba(0,0,0,0.5)]'
        : 'text-white/80';

  // Payout badge — show for any match with a stake (STAKE or CASUAL with stakeUsd > 0)
  const stake = Number(data.room?.stakeUsd ?? 0);
  const payoutLine =
    stake > 0
      ? outcome === 'win'
        ? { text: `+$${stake.toFixed(2)}`, cls: 'text-game-cyan' }
        : outcome === 'loss'
          ? { text: `-$${stake.toFixed(2)}`, cls: 'text-game-red' }
          : { text: `$0.00`, cls: 'text-white/50' }
      : null;

  const cupBefore = data.cupBefore ?? 0;
  const cupDelta = cupAfter == null ? null : cupAfter - cupBefore;
  const cupShown = displayedCup ?? cupBefore;

  return (
    <div className="relative flex h-full flex-col items-center justify-center gap-6 overflow-hidden p-6">
      <div className="pointer-events-none absolute -top-32 left-1/2 h-72 w-72 -translate-x-1/2 rounded-full bg-game-purple/40 blur-3xl" />
      {outcome === 'win' && (
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_30%,rgba(255,209,59,0.25),transparent_60%)]" />
      )}
      <ResultFx outcome={outcome} />

      <div className={`game-title animate-pop-in max-w-[92vw] px-2 text-center leading-none uppercase break-words text-5xl sm:text-7xl ${titleClass}`}>
        {t(`result.${outcome}`)}
      </div>

      {payoutLine && (
        <div className={`font-display text-4xl font-bold ${payoutLine.cls} drop-shadow-[0_2px_0_rgba(0,0,0,0.6)]`}>
          {payoutLine.text}
        </div>
      )}

      <div className="game-chip">{t(`result.reason.${data.reason}`)}</div>

      {/* Cup pill with animated delta */}
      <div className="relative flex items-center gap-3">
        <div className="inline-flex items-center gap-2 rounded-full border border-amber-500/40 bg-black/50 px-4 py-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
          <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-b from-yellow-200 via-yellow-400 to-amber-600 shadow-[inset_0_1px_0_rgba(255,255,255,0.6)]">
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 text-amber-900" fill="currentColor" aria-hidden>
              <path d="M7 4h10v2h3v3a4 4 0 0 1-4 4h-.18A5 5 0 0 1 13 15.9V18h2v2H9v-2h2v-2.1A5 5 0 0 1 7.18 13H7a4 4 0 0 1-4-4V6h4V4zm0 4H5v1a2 2 0 0 0 2 2V8zm10 0v3a2 2 0 0 0 2-2V8h-2z" />
            </svg>
          </span>
          <span className="font-display text-2xl font-black tabular-nums text-yellow-200">
            {cupShown}
          </span>
        </div>
        {cupDelta != null && cupDelta !== 0 && (
          <div
            className={
              'animate-cup-pop font-display text-3xl font-black tabular-nums drop-shadow-[0_2px_0_rgba(0,0,0,0.6)] ' +
              (cupDelta > 0 ? 'text-game-cyan' : 'text-game-red')
            }
          >
            {cupDelta > 0 ? '+' : ''}{cupDelta}
          </div>
        )}
      </div>

      <div className="grid w-full max-w-xs grid-cols-2 gap-3 text-center">
        <div className="game-card p-4 flex flex-col items-center justify-center">
          <div className="text-xs uppercase text-white/60">{t('result.you')}</div>
          <div className="font-display text-3xl text-game-cyan">{youHp}</div>
        </div>
        <div className="game-card p-4 flex flex-col items-center justify-center">
          <div className="max-w-full truncate text-xs uppercase text-white/60">
            {data.opponent.username}
          </div>
          <div className="font-display text-3xl text-game-pink">{oppHp}</div>
        </div>
      </div>

      <div className="text-sm text-white/60">
        {t('result.duration')}: {Math.round(data.durationMs / 1000)}s
      </div>

      <button
        type="button"
        onClick={() => nav('/home')}
        disabled={!btnEnabled}
        className="game-btn game-btn-yellow game-btn-lg disabled:opacity-50 disabled:cursor-wait"
      >
        {t('result.back')}
      </button>

      <ReportButton matchId={id ?? ''} />
    </div>
  );
}

function ReportButton({ matchId }: { matchId: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<'cheating' | 'bug' | 'abuse' | 'connection' | 'other'>('cheating');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function submit() {
    if (!matchId || message.trim().length < 3) return;
    setBusy(true);
    try {
      await api.post(`/matches/${matchId}/report`, { category, message: message.trim() });
      setSent(true);
      toast.success(t('report.success_title'), t('report.success_body'));
      setTimeout(() => setOpen(false), 600);
    } catch (e) {
      toast.error('Error', e instanceof Error ? e.message : 'failed');
    } finally {
      setBusy(false);
    }
  }

  if (!matchId) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => { setOpen(true); setSent(false); setMessage(''); }}
        className="text-xs text-white/40 underline underline-offset-4 hover:text-white/70"
      >
        {t('report.button')}
      </button>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => !busy && setOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-white/10 bg-game-bg p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 text-lg font-semibold">{t('report.title')}</div>
            <div className="mb-3 text-xs text-white/50">{t('report.subtitle')}</div>
            <label className="mb-1 block text-xs text-white/60">{t('report.category')}</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as typeof category)}
              className="mb-3 w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm"
            >
              <option value="cheating">{t('report.cat.cheating')}</option>
              <option value="bug">{t('report.cat.bug')}</option>
              <option value="abuse">{t('report.cat.abuse')}</option>
              <option value="connection">{t('report.cat.connection')}</option>
              <option value="other">{t('report.cat.other')}</option>
            </select>
            <label className="mb-1 block text-xs text-white/60">{t('report.message')}</label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              maxLength={2000}
              rows={4}
              placeholder={t('report.placeholder') ?? ''}
              className="mb-3 w-full resize-none rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={busy}
                className="rounded-md bg-white/5 px-3 py-1.5 text-sm hover:bg-white/10 disabled:opacity-50"
              >
                {t('report.cancel')}
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={busy || sent || message.trim().length < 3}
                className="rounded-md bg-game-purple px-4 py-1.5 text-sm font-semibold disabled:opacity-50"
              >
                {busy ? '…' : sent ? t('report.sent') : t('report.submit')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
