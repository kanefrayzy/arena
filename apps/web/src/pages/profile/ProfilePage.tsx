import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '../../shared/api/client';
import { RankBadge, tierFor } from '../../shared/ui/rank';

interface Profile {
  id: number;
  username: string;
  country: string | null;
  createdAt: string;
  role: 'PLAYER' | 'ADMIN' | 'MODERATOR';
  isBot: boolean;
  cup: number;
  mmr: number;
  wins: number;
  losses: number;
  draws: number;
  matchesPlayed: number;
}

export function ProfilePage() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const { id } = useParams();
  const [p, setP] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) {
      nav('/home', { replace: true });
      return;
    }
    void (async () => {
      try {
        const r = await api.get<Profile>(`/users/${id}/profile`);
        setP(r);
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) {
          setError(t('profile.notFound', 'Игрок не найден'));
        } else {
          setError(e instanceof Error ? e.message : 'error');
        }
      }
    })();
  }, [id, nav, t]);

  const winRate = p && p.matchesPlayed > 0
    ? Math.round((p.wins / p.matchesPlayed) * 100)
    : 0;

  const tier = p ? tierFor(p.cup).tier : null;

  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      {/* decorative blob */}
      <div className="pointer-events-none absolute -top-32 left-1/2 h-72 w-72 -translate-x-1/2 rounded-full bg-game-purple/40 blur-3xl" />

      {/* top bar */}
      <header className="game-panel relative z-10 flex items-center justify-between px-4 py-2.5">
        <button
          type="button"
          onClick={() => nav(-1)}
          className="game-btn game-btn-ghost game-btn-sm"
          aria-label={t('common.back', 'Назад')}
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <div className="game-title text-lg text-white/90">
          {t('profile.title', 'Профиль')}
        </div>
        <div className="w-10" />
      </header>

      <main className="relative z-10 flex flex-1 flex-col items-center gap-4 overflow-y-auto px-6 pt-6">
        {error && (
          <div className="rounded-xl border border-rose-400/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
            {error}
          </div>
        )}

        {p && (
          <>
            {/* avatar / name / rank */}
            <div className="flex flex-col items-center gap-2">
              <div
                className={
                  'relative inline-flex h-24 w-24 items-center justify-center rounded-full ' +
                  'bg-gradient-to-b from-white/15 to-white/[0.04] ring-2 ' + (tier?.ring ?? 'ring-white/20') +
                  ' shadow-[0_6px_18px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.1)]'
                }
              >
                <span className="font-display text-4xl text-white/90 select-none">
                  {p.username.slice(0, 1).toUpperCase()}
                </span>
                {p.isBot && (
                  <span className="absolute -bottom-1 right-0 rounded-full border border-amber-500/60 bg-black/70 px-1.5 py-0.5 text-[10px] font-bold text-amber-300">
                    BOT
                  </span>
                )}
              </div>
              <div className="game-title text-2xl text-white/95">@{p.username}</div>
              <RankBadge cup={p.cup} />
              {tier && (
                <div className={'text-xs uppercase tracking-wider ' + tier.text}>
                  {tier.name}
                </div>
              )}
            </div>

            {/* stat grid */}
            <div className="grid w-full max-w-sm grid-cols-3 gap-3 pt-2">
              <StatCard label={t('profile.matches', 'Матчей')} value={p.matchesPlayed} tone="white" />
              <StatCard label={t('profile.wins', 'Победы')} value={p.wins} tone="cyan" />
              <StatCard label={t('profile.losses', 'Поражения')} value={p.losses} tone="red" />
            </div>
            <div className="grid w-full max-w-sm grid-cols-3 gap-3">
              <StatCard label={t('profile.draws', 'Ничьи')} value={p.draws} tone="white" />
              <StatCard label={t('profile.winRate', 'Винрейт')} value={`${winRate}%`} tone="yellow" />
              <StatCard label={t('profile.cup', 'Кубки')} value={p.cup} tone="purple" />
            </div>

            {p.country && (
              <div className="text-xs text-white/40">
                {t('profile.country', 'Страна')}: {p.country}
              </div>
            )}
            <div className="text-xs text-white/40">
              {t('profile.joined', 'Регистрация')}: {new Date(p.createdAt).toLocaleDateString()}
            </div>
          </>
        )}
      </main>
    </div>
  );
}

function StatCard({ label, value, tone }: { label: string; value: number | string; tone: 'cyan' | 'red' | 'yellow' | 'purple' | 'white' }) {
  const toneCls =
    tone === 'cyan'   ? 'text-game-cyan'   :
    tone === 'red'    ? 'text-game-red'    :
    tone === 'yellow' ? 'text-game-yellow' :
    tone === 'purple' ? 'text-game-purple' :
                        'text-white';
  return (
    <div className="rounded-xl border border-white/10 bg-black/30 px-2 py-3 text-center">
      <div className={'font-display text-2xl tabular-nums ' + toneCls}>{value}</div>
      <div className="mt-1 text-[10px] uppercase tracking-wide text-white/50">{label}</div>
    </div>
  );
}
