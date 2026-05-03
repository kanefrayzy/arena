import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { MatchClient } from '../../shared/ws/match';
import { Controls } from '../../shared/game/controls';
import { PixiRenderer } from '../../shared/game/pixi-renderer';
import * as sfx from '../../shared/game/audio';
import type { SWelcome, SSnapshot, SMatchEnd } from '@arena/protocol';

interface MatchInfo {
  matchToken: string;
  gameWsUrl: string;
  opponent: { id: number; username: string };
  room: { id: number; mode: 'FREE' | 'CASUAL' | 'STAKE'; stakeUsd?: string };
}

export function MatchPage() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const { id } = useParams();
  const matchId = id ?? '';
  const hostRef = useRef<HTMLDivElement | null>(null);
  const joyRef = useRef<HTMLDivElement | null>(null);
  const fireRef = useRef<HTMLButtonElement | null>(null);
  const abRef = useRef<HTMLButtonElement | null>(null);
  const [welcome, setWelcome] = useState<SWelcome | null>(null);
  const [hp, setHp] = useState({ you: 100, opp: 100 });
  const [cdMs, setCdMs] = useState(0);
  const [remainingMs, setRemainingMs] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null); // 3,2,1,0(FIGHT) or null
  const inputBlockedRef = useRef(true);

  useEffect(() => {
    if (!matchId) return;
    const stash = sessionStorage.getItem(`match:${matchId}`);
    if (!stash) {
      nav('/home');
      return;
    }
    const info = JSON.parse(stash) as MatchInfo;

    let cancelled = false;
    let renderer: PixiRenderer | null = null;
    let client: MatchClient | null = null;
    let inputTimer: number | null = null;
    let cleanupControls: (() => void) | null = null;
    const controls = new Controls();

    const wsUrl = `${info.gameWsUrl}?token=${encodeURIComponent(info.matchToken)}`;

    const start = async () => {
      const host = hostRef.current;
      if (!host) return;
      renderer = new PixiRenderer(host);
      renderer.onEvent = (ev) => {
        if (ev.kind === 'shoot') sfx.shoot();
        else if (ev.kind === 'hit') {
          if (ev.obstacle) sfx.hitObstacle();
          else sfx.hit();
        } else if (ev.kind === 'death') sfx.death();
        else if (ev.kind === 'ability') sfx.dash();
      };
      await renderer.init();
      if (cancelled) return;

      cleanupControls = controls.attach(host, joyRef.current!, fireRef.current!, abRef.current!);

      let youId = 0;

      client = new MatchClient(wsUrl, {
        onWelcome: (msg) => {
          setWelcome(msg);
          renderer!.setIdentity(msg);
          youId = msg.you.id;
          // VS countdown: 3-2-1-FIGHT, then unlock input
          inputBlockedRef.current = true;
          setCountdown(3);
          sfx.unlockAudio();
          sfx.matchStartTick(3);
          let n = 3;
          const tick = window.setInterval(() => {
            n -= 1;
            setCountdown(n);
            if (n > 0) sfx.matchStartTick(n);
            else {
              sfx.matchStartTick(0);
              inputBlockedRef.current = false;
              window.setTimeout(() => setCountdown(null), 700);
              window.clearInterval(tick);
            }
          }, 1000);
        },
        onSnapshot: (msg: SSnapshot) => {
          renderer!.applySnapshot(msg);
          const me = msg.players.find((p) => p.id === youId);
          const opp = msg.players.find((p) => p.id !== youId);
          if (me) setCdMs(me.abilityCdMs);
          setHp({ you: me?.hp ?? 0, opp: opp?.hp ?? 0 });
          setRemainingMs(msg.remainingMs);
        },
        onMatchEnd: (msg: SMatchEnd) => {
          const youWon = msg.winnerId === youId;
          sfx.matchEnd(youWon);
          sessionStorage.setItem(`result:${matchId}`, JSON.stringify({ ...msg, opponent: info.opponent }));
          nav(`/result/${matchId}`);
        },
        onError: (code, message) => {
          setError(`${code}: ${message}`);
        },
        onClose: () => {
          // server closed; if we don't have a result yet, go home
          if (!sessionStorage.getItem(`result:${matchId}`)) {
            nav('/home');
          }
        },
      });
      client.connect();

      // Send input at 30 Hz
      inputTimer = window.setInterval(() => {
        const pos = renderer!.getYouCanvasPos();
        if (pos) {
          controls.playerCanvasX = pos.x;
          controls.playerCanvasY = pos.y;
        }
        const W = host.clientWidth;
        const H = host.clientHeight;
        const inp = controls.read(1, W, H);
        if (inputBlockedRef.current) {
          // Suppress controls during countdown.
          inp.dx = 0;
          inp.dy = 0;
          inp.fire = false;
          inp.ability = false;
        }
        client!.sendInput(inp);
      }, 33);
    };
    void start();

    return () => {
      cancelled = true;
      if (inputTimer) clearInterval(inputTimer);
      cleanupControls?.();
      client?.leave();
      client?.close();
      renderer?.destroy();
    };
  }, [matchId, nav]);

  const remainingS = Math.ceil(remainingMs / 1000);
  const cdS = Math.ceil(cdMs / 1000);
  const [muted, setMutedState] = useState<boolean>(sfx.isMuted());

  return (
    <div className="relative h-full w-full overflow-hidden bg-bg">
      <div ref={hostRef} className="absolute inset-0" />
      {/* HUD */}
      <div className="pointer-events-none absolute inset-0 p-3">
        <div className="flex items-start justify-between text-sm">
          <div className="rounded-lg bg-black/60 px-3 py-2 backdrop-blur">
            <div className="text-white/60">{welcome?.you.username ?? 'YOU'}</div>
            <div className="font-mono">HP {hp.you}</div>
          </div>
          <div className="rounded-lg bg-black/60 px-3 py-2 backdrop-blur text-center">
            <div className="text-2xl font-bold tabular-nums">{remainingS}s</div>
            <div className="text-xs text-white/60">{t('match.timer')}</div>
            <button
              type="button"
              onClick={() => {
                const m = !muted;
                sfx.setMuted(m);
                setMutedState(m);
                if (!m) sfx.unlockAudio();
              }}
              className="pointer-events-auto mt-1 rounded bg-white/10 px-2 py-0.5 text-[11px] text-white/70 hover:bg-white/20"
            >
              {muted ? '🔇' : '🔊'}
            </button>
          </div>
          <div className="rounded-lg bg-black/60 px-3 py-2 text-right backdrop-blur">
            <div className="text-white/60">{welcome?.opponent.username ?? 'OPP'}</div>
            <div className="font-mono">HP {hp.opp}</div>
          </div>
        </div>
        <div className="mt-2 text-center text-xs text-white/50">
          {cdMs > 0 ? `${t('match.ability_cd')}: ${cdS}s` : t('match.ability_ready')}
        </div>
        {error && <div className="mt-3 text-center text-red-400">{error}</div>}
      </div>
      {/* VS countdown overlay */}
      {countdown !== null && welcome && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="flex items-center gap-6 text-2xl md:text-4xl font-bold mb-6">
            <span className="text-[#4ad29a]">{welcome.you.username}</span>
            <span className="text-white/60 text-3xl md:text-5xl">VS</span>
            <span className="text-[#e06c75]">{welcome.opponent.username}</span>
          </div>
          <div
            key={countdown}
            className="text-7xl md:text-9xl font-black animate-[ping_0.7s_ease-out] tabular-nums"
            style={{ color: countdown === 0 ? '#f5c518' : '#fff' }}
          >
            {countdown === 0 ? 'FIGHT!' : countdown}
          </div>
        </div>
      )}
      {/* Mobile controls */}
      <div className="pointer-events-auto absolute bottom-6 left-6 h-32 w-32 rounded-full bg-white/10 backdrop-blur md:opacity-30" ref={joyRef as never} />
      <button
        ref={fireRef}
        type="button"
        className="pointer-events-auto absolute bottom-6 right-6 h-24 w-24 select-none rounded-full bg-accent text-bg font-bold shadow-lg active:scale-95"
      >
        FIRE
      </button>
      <button
        ref={abRef}
        type="button"
        className="pointer-events-auto absolute bottom-32 right-12 h-16 w-16 select-none rounded-full bg-surface text-white font-bold shadow-lg active:scale-95"
      >
        Q
      </button>
    </div>
  );
}
