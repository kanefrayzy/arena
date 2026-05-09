import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../../shared/api/client';
import { lobby, type LobbyEvent } from '../../shared/ws/lobby';

interface QueueStatusResponse {
  inQueue: boolean;
  mode?: string;
  roomId?: number;
  waitMs?: number;
  activeMatch?: {
    matchId: string;
    matchToken: string;
    gameWsUrl: string;
    opponent: { id: number; username: string };
    room: { id: number; mode: 'FREE' | 'CASUAL' | 'STAKE'; stakeUsd?: string };
  };
}

export function QueuePage() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const mode = (params.get('mode') ?? 'free') as 'free' | 'casual' | 'stake';
  const roomId = params.get('roomId');
  const [seconds, setSeconds] = useState(0);
  const [longWait, setLongWait] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const joinedRef = useRef(false);
  const sawSearchingRef = useRef(false);
  const idleAfterSearchCountRef = useRef(0);
  const navigatedRef = useRef(false);
  const baseWaitMsRef = useRef(0);
  const baseAtRef = useRef(Date.now());
  const lastWsEventAtRef = useRef(Date.now());

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

    const navigateToMatch = (m: NonNullable<QueueStatusResponse['activeMatch']>) => {
      if (navigatedRef.current) return;
      navigatedRef.current = true;
      sessionStorage.setItem(
        `match:${m.matchId}`,
        JSON.stringify({
          matchToken: m.matchToken,
          gameWsUrl: m.gameWsUrl,
          opponent: m.opponent,
          room: m.room,
        }),
      );
      nav(`/match/${m.matchId}`);
    };

    lobby.connect();
    const off = lobby.on((ev: LobbyEvent) => {
      lastWsEventAtRef.current = Date.now();
      if (ev.type === 'queue:status') {
        if (ev.state === 'idle') {
          // Server says we're not in the queue. After page reload the lobby WS
          // reconnects and may briefly deliver 'idle' before the server
          // re-delivers match:found. We silently ignore idle ticks here —
          // the HTTP fallback poll will handle the case where the user
          // genuinely fell out of the queue.
          return;
        }
        idleAfterSearchCountRef.current = 0;
        sawSearchingRef.current = true;
        baseWaitMsRef.current = ev.waitMs ?? 0;
        baseAtRef.current = Date.now();
        setLongWait(ev.state === 'long_wait');
      } else if (ev.type === 'match:found') {
        navigateToMatch({
          matchId: ev.matchId,
          matchToken: ev.matchToken,
          gameWsUrl: ev.gameWsUrl,
          opponent: ev.opponent,
          room: ev.room,
        });
      }
    });

    // Local display ticker — independent of server pushes so the UI never
    // appears frozen at "0s" even if the lobby WS goes silent for a moment.
    const displayTimer = window.setInterval(() => {
      const now = Date.now();
      const ms = baseWaitMsRef.current + (now - baseAtRef.current);
      setSeconds(Math.floor(ms / 1000));
    }, 250);

    // HTTP fallback: poll /queue/status if the lobby WS hasn't said anything
    // useful for a while. Catches every scenario where the WS push was lost
    // (Redis pub/sub flake, lobby socket flap, server restart) so the player
    // is never stranded watching a frozen spinner. Also auto-bails to /home if
    // the user is no longer in queue and no active match exists.
    let consecutiveMissing = 0;
    const httpFallback = window.setInterval(() => {
      if (navigatedRef.current) return;
      const silentMs = Date.now() - lastWsEventAtRef.current;
      // Only poll once we've been WS-silent for >4s (avoid hammering API on healthy path).
      if (silentMs < 4000) return;
      void (async () => {
        try {
          const res = await api.get<QueueStatusResponse>('/queue/status');
          if (navigatedRef.current) return;
          if (res.activeMatch) {
            navigateToMatch(res.activeMatch);
            return;
          }
          if (res.inQueue) {
            sawSearchingRef.current = true;
            baseWaitMsRef.current = res.waitMs ?? 0;
            baseAtRef.current = Date.now();
            consecutiveMissing = 0;
            return;
          }
          // Neither queued nor in a match. After 2 consecutive misses (~6s)
          // give up and send the player home with an explanation.
          consecutiveMissing += 1;
          if (consecutiveMissing >= 2 && !navigatedRef.current) {
            navigatedRef.current = true;
            setError(t('queue.lost_connection'));
            window.setTimeout(() => nav('/home'), 1500);
          }
        } catch {
          /* ignore transient HTTP errors */
        }
      })();
    }, 3000);

    return () => {
      off();
      window.clearInterval(displayTimer);
      window.clearInterval(httpFallback);
    };
  }, [mode, nav, roomId, t]);

  const cancel = async () => {
    try {
      await api.post('/queue/leave', {});
    } catch {
      /* ignore */
    }
    nav('/home');
  };

  return (
    <div className="relative flex h-full flex-col items-center justify-center gap-8 overflow-hidden p-6">
      <div className="pointer-events-none absolute -top-32 left-1/2 h-72 w-72 -translate-x-1/2 rounded-full bg-game-purple/40 blur-3xl" />

      {error ? (
        <>
          <div className="game-card flex w-full max-w-xs flex-col items-center gap-4 p-6 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-game-red/20 text-4xl">
              🚫
            </div>
            <div className="font-display text-base uppercase text-white">{error}</div>
            <button
              type="button"
              onClick={() => nav('/wallet')}
              className="game-btn game-btn-yellow w-full"
            >
              {t('wallet.deposit')}
            </button>
            <button
              type="button"
              onClick={() => nav('/home')}
              className="game-btn game-btn-ghost w-full"
            >
              {t('result.back')}
            </button>
          </div>
        </>
      ) : (
        <>
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

          <button type="button" onClick={cancel} className="game-btn game-btn-red">
            {t('queue.cancel')}
          </button>
        </>
      )}
    </div>
  );
}
