import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../shared/api/client';
import { useAuth } from '../../shared/store/auth';

interface MatchItem {
  id: string;
  player1: { id: number; username: string };
  player2: { id: number; username: string };
  room: { mode: string; name?: string };
  stakeUsd: string;
  winnerId: number | null;
  status: string;
  durationMs: number | null;
  startedAt: string | null;
  finishedAt: string | null;
}

function formatDuration(ms: number | null): string {
  if (!ms) return '—';
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m > 0 ? `${m}m ${r}s` : `${r}s`;
}

export function MatchHistoryModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const me = useAuth((s) => s.me);
  const [items, setItems] = useState<MatchItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await api.get<{ items: MatchItem[] }>('/matches/me?limit=30');
        setItems(r.items);
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'error');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const userId = me?.id;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" onClick={onClose}>
      <div className="w-full max-w-lg rounded-t-2xl border-t border-white/10 bg-[#15123A] p-0 shadow-2xl" style={{ maxHeight: '80vh' }} onClick={(e) => e.stopPropagation()}>
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="h-1 w-12 rounded-full bg-white/20" />
        </div>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-white/10">
          <div className="flex items-center gap-2">
            <svg viewBox="0 0 24 24" className="h-5 w-5 text-game-yellow" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
            </svg>
            <span className="font-display text-base text-white">{t('history.title', 'История матчей')}</span>
          </div>
          <button type="button" onClick={onClose} className="rounded-full bg-white/10 p-1.5 text-white/60 hover:bg-white/20">
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* List */}
        <div className="overflow-y-auto" style={{ maxHeight: 'calc(80vh - 100px)' }}>
          {loading && (
            <div className="py-10 text-center text-sm text-white/40">{t('common.loading', 'Загрузка...')}</div>
          )}
          {err && (
            <div className="py-8 text-center text-sm text-rose-300">{err}</div>
          )}
          {!loading && !err && items.length === 0 && (
            <div className="py-10 text-center text-sm text-white/40">{t('history.empty', 'Матчей пока нет')}</div>
          )}
          {items.map((m) => {
            const isP1 = m.player1.id === userId;
            const opp = isP1 ? m.player2 : m.player1;
            const won = m.winnerId === userId;
            const lost = m.winnerId !== null && m.winnerId !== userId;
            const draw = m.status === 'FINISHED' && m.winnerId === null;

            let resultLabel: string;
            let resultColor: string;
            if (draw) {
              resultLabel = t('history.draw', 'Ничья');
              resultColor = 'text-white/60';
            } else if (won) {
              resultLabel = t('history.win', 'Победа');
              resultColor = 'text-game-cyan';
            } else if (lost) {
              resultLabel = t('history.loss', 'Поражение');
              resultColor = 'text-game-red';
            } else if (m.status === 'PENDING') {
              resultLabel = 'В очереди';
              resultColor = 'text-white/40';
            } else if (m.status === 'RUNNING') {
              resultLabel = 'Идёт';
              resultColor = 'text-game-yellow';
            } else if (m.status === 'CANCELLED') {
              resultLabel = 'Отменён';
              resultColor = 'text-white/30';
            } else if (m.status === 'DISPUTED') {
              resultLabel = 'Спор';
              resultColor = 'text-amber-400';
            } else {
              resultLabel = m.status;
              resultColor = 'text-white/40';
            }

            const stake = Number(m.stakeUsd);
            const dateStr = m.finishedAt ?? m.startedAt;
            const date = dateStr ? new Date(dateStr).toLocaleDateString('ru-RU') : '—';

            return (
              <div key={m.id} className="flex items-center gap-3 border-b border-white/5 px-5 py-3">
                {/* Result indicator */}
                <div className={`w-16 shrink-0 text-center text-xs font-bold ${resultColor}`}>
                  {resultLabel}
                </div>
                {/* Opponent (non-interactive to avoid revealing identity in bot matches) */}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-white">vs {opp.username}</div>
                  <div className="text-xs text-white/40">
                    {m.room.name || m.room.mode} · {formatDuration(m.durationMs)} · {date}
                  </div>
                </div>
                {/* Stake */}
                {stake > 0 && (
                  <div className="shrink-0 text-xs font-mono text-game-yellow">${stake.toFixed(2)}</div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
