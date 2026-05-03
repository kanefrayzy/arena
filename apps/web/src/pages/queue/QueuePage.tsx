import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../../shared/api/client';
import { lobby, type LobbyEvent } from '../../shared/ws/lobby';

export function QueuePage() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const mode = (params.get('mode') ?? 'free') as 'free' | 'casual' | 'stake';
  const [waitMs, setWaitMs] = useState(0);
  const [longWait, setLongWait] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const joinedRef = useRef(false);

  useEffect(() => {
    if (!joinedRef.current) {
      joinedRef.current = true;
      void (async () => {
        try {
          await api.post('/queue/join', { mode });
        } catch (e) {
          setError((e as Error).message);
        }
      })();
    }

    lobby.connect();
    const off = lobby.on((ev: LobbyEvent) => {
      if (ev.type === 'queue:status') {
        if (ev.state === 'idle') return;
        setWaitMs(ev.waitMs ?? 0);
        setLongWait(ev.state === 'long_wait');
      } else if (ev.type === 'match:found') {
        sessionStorage.setItem(
          `match:${ev.matchId}`,
          JSON.stringify({ matchToken: ev.matchToken, gameWsUrl: ev.gameWsUrl, opponent: ev.opponent, room: ev.room }),
        );
        nav(`/match/${ev.matchId}`);
      }
    });

    return () => {
      off();
    };
  }, [mode, nav]);

  const cancel = async () => {
    try {
      await api.post('/queue/leave', {});
    } catch {
      /* ignore */
    }
    nav('/home');
  };

  const seconds = Math.floor(waitMs / 1000);

  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 p-6">
      <div className="text-sm uppercase tracking-widest text-white/50">{t(`home.mode.${mode}`)}</div>
      <div className="relative flex h-32 w-32 items-center justify-center">
        <div className="absolute inset-0 animate-ping rounded-full bg-accent/20" />
        <div className="absolute inset-2 animate-pulse rounded-full bg-accent/40" />
        <div className="relative text-3xl font-bold">{seconds}s</div>
      </div>
      <div className="text-lg">{t(longWait ? 'queue.long_wait' : 'queue.searching')}</div>
      {error && <div className="text-sm text-red-400">{error}</div>}
      <button
        type="button"
        onClick={cancel}
        className="rounded-lg bg-surface px-6 py-3 text-white/80 hover:bg-white/10"
      >
        {t('queue.cancel')}
      </button>
    </div>
  );
}
