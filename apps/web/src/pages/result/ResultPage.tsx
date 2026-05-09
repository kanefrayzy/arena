import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../shared/store/auth';

interface ResultData {
  winnerId: number | null;
  reason: 'kill' | 'timeout' | 'disconnect' | 'draw';
  durationMs: number;
  score: Record<string, number>;
  opponent: { id: number; username: string };
  room?: { id: number; mode: 'FREE' | 'CASUAL' | 'STAKE'; stakeUsd?: string };
  /** Embedded by MatchPage so the result page renders even when the global
   *  auth store hasn't bootstrapped yet (e.g. after a mid-match page refresh
   *  the user lands on /result without ever passing through HomePage). */
  youId?: number;
}

export function ResultPage() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const { id } = useParams();
  const me = useAuth((s) => s.me);
  const [data, setData] = useState<ResultData | null>(null);

  useEffect(() => {
    if (!id) return;
    const raw = sessionStorage.getItem(`result:${id}`);
    if (!raw) {
      nav('/home');
      return;
    }
    setData(JSON.parse(raw) as ResultData);
  }, [id, nav]);

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

  return (
    <div className="relative flex h-full flex-col items-center justify-center gap-6 overflow-hidden p-6">
      <div className="pointer-events-none absolute -top-32 left-1/2 h-72 w-72 -translate-x-1/2 rounded-full bg-game-purple/40 blur-3xl" />
      {outcome === 'win' && (
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_30%,rgba(255,209,59,0.25),transparent_60%)]" />
      )}

      <div className={`game-title text-7xl uppercase animate-pop-in ${titleClass}`}>
        {t(`result.${outcome}`)}
      </div>

      {payoutLine && (
        <div className={`font-display text-4xl font-bold ${payoutLine.cls} drop-shadow-[0_2px_0_rgba(0,0,0,0.6)]`}>
          {payoutLine.text}
        </div>
      )}

      <div className="game-chip">{t(`result.reason.${data.reason}`)}</div>

      <div className="grid w-full max-w-xs grid-cols-2 gap-3 text-center">
        <div className="game-card p-4">
          <div className="text-xs uppercase text-white/60">{t('result.you')}</div>
          <div className="font-display text-3xl text-game-cyan">{youHp}</div>
        </div>
        <div className="game-card p-4">
          <div className="truncate text-xs uppercase text-white/60">
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
        className="game-btn game-btn-yellow game-btn-lg"
      >
        {t('result.back')}
      </button>
    </div>
  );
}
