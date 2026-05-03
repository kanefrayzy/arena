import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../../shared/api/client';
import { lobby, type LobbyEvent } from '../../shared/ws/lobby';

export function QueuePage() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const mode = (params.get('mode') ?? 'free') as 'free' | 'casual' | 'stake';
  const roomId = params.get('roomId');
  const [waitMs, setWaitMs] = useState(0);
  const [longWait, setLongWait] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const joinedRef = useRef(false);

  useEffect(() => {
    if (!joinedRef.current) {
      joinedRef.current = true;
      void (async () => {
        try {
          const body: { mode: string; roomId?: number } = { mode };
          if (roomId) body.roomId = Number(roomId);
          await api.post('/queue/join', body);
        } catch (e) {
          if (e instanceof ApiError && e.code === 'INSUFFICIENT_BALANCE') {
            setError(t('queue.insufficient_balance'));
          } else {
            setError((e as Error).message);
          }
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
    <div className="relative flex h-full flex-col items-center justify-center gap-8 overflow-hidden p-6">
      <div className="pointer-events-none absolute -top-32 left-1/2 h-72 w-72 -translate-x-1/2 rounded-full bg-game-purple/40 blur-3xl" />

      <div className="game-chip game-chip-yellow text-base">
        {t(`home.mode.${mode}`)}
      </div>

      <div className="relative flex h-44 w-44 items-center justify-center">
        {/* outer rings */}
        <div className="absolute inset-0 animate-ping rounded-full bg-game-yellow/25" />
        <div className="absolute inset-3 animate-pulse rounded-full bg-game-yellow/40" />
        {/* core */}
        <div className="relative flex h-32 w-32 items-center justify-center rounded-full bg-gradient-to-b from-[#ffe066] to-[#f5b800] shadow-[0_8px_0_#b88200,0_0_40px_rgba(255,209,59,0.6)]">
          <div className="font-display text-4xl text-[#1a1450]">{seconds}s</div>
        </div>
      </div>

      <div className="font-display text-xl uppercase tracking-wide text-white/90">
        {t(longWait ? 'queue.long_wait' : 'queue.searching')}
      </div>

      {error && <div className="text-sm font-semibold text-game-red">{error}</div>}

      <button type="button" onClick={cancel} className="game-btn game-btn-red">
        {t('queue.cancel')}
      </button>
    </div>
  );
}
