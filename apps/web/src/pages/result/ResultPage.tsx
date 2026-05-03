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

  if (!data || !me) return null;

  const youId = me.id;
  const youHp = data.score[String(youId)] ?? 0;
  const oppHp = data.score[String(data.opponent.id)] ?? 0;
  const outcome: 'win' | 'loss' | 'draw' =
    data.winnerId === null ? 'draw' : data.winnerId === youId ? 'win' : 'loss';
  const color =
    outcome === 'win' ? 'text-accent' : outcome === 'loss' ? 'text-red-400' : 'text-white/70';

  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 p-6">
      <div className={`text-6xl font-extrabold uppercase ${color}`}>{t(`result.${outcome}`)}</div>
      <div className="text-sm uppercase tracking-widest text-white/50">{t(`result.reason.${data.reason}`)}</div>
      <div className="grid w-full max-w-xs grid-cols-2 gap-3 text-center">
        <div className="rounded-lg bg-surface p-4">
          <div className="text-xs text-white/50">{t('result.you')}</div>
          <div className="text-2xl font-mono">{youHp}</div>
        </div>
        <div className="rounded-lg bg-surface p-4">
          <div className="text-xs text-white/50">{data.opponent.username}</div>
          <div className="text-2xl font-mono">{oppHp}</div>
        </div>
      </div>
      <div className="text-sm text-white/50">{t('result.duration')}: {Math.round(data.durationMs / 1000)}s</div>
      <button
        type="button"
        onClick={() => nav('/home')}
        className="rounded-lg bg-accent px-6 py-3 font-bold text-bg"
      >
        {t('result.back')}
      </button>
    </div>
  );
}
