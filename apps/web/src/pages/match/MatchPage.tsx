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
  const joyDotRef = useRef<HTMLDivElement | null>(null);
  const fireRef = useRef<HTMLButtonElement | null>(null);
  const abRef = useRef<HTMLButtonElement | null>(null);
  const [welcome, setWelcome] = useState<SWelcome | null>(null);
  const [hp, setHp] = useState({ you: 100, opp: 100 });
  const [cdMs, setCdMs] = useState(0);
  const [remainingMs, setRemainingMs] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null); // 3,2,1,0(FIGHT) or null
  const [ping, setPing] = useState(0);
  const [disconnectMsg, setDisconnectMsg] = useState<string | null>(null);
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
    let pingDisplayTimer: number | null = null;
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

      let youId = 0;
      // Buffer the welcome message if it arrives before the renderer is ready.
      let pendingWelcome: SWelcome | null = null;
      let rendererReady = false;

      // ── Connect to game server IMMEDIATELY (before renderer finishes loading).
      //    This cancels the server-side 10-second reconnect timer right away so the
      //    match isn't ended while the renderer is still initialising.
      client = new MatchClient(wsUrl, {
        onWelcome: (msg) => {
          setWelcome(msg);
          youId = msg.you.id;
          if (rendererReady) {
            renderer!.setIdentity(msg);
          } else {
            pendingWelcome = msg;
          }
          if (msg.started) {
            // Reconnecting to already-running match — skip countdown, unlock immediately.
            inputBlockedRef.current = false;
            setCountdown(null);
            sfx.unlockAudio();
          } else {
            // Fresh match start: VS countdown 3-2-1-FIGHT then unlock input.
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
          }
        },
        onSnapshot: (msg: SSnapshot) => {
          // Skip snapshots until the renderer has finished initialising.
          if (!rendererReady) return;
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
          if (msg.reason === 'disconnect') {
            setDisconnectMsg('Противник отключился');
            window.setTimeout(() => {
              sessionStorage.setItem(`result:${matchId}`, JSON.stringify({ ...msg, opponent: info.opponent, room: info.room }));
              nav(`/result/${matchId}`);
            }, 2000);
          } else {
            sessionStorage.setItem(`result:${matchId}`, JSON.stringify({ ...msg, opponent: info.opponent, room: info.room }));
            nav(`/result/${matchId}`);
          }
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
      client.connect(); // ← WS connects here, parallel to renderer.init() below

      // ── Initialise renderer in parallel with WS handshake ──
      await renderer.init();
      if (cancelled) return;
      rendererReady = true;

      // If welcome arrived while renderer was loading, apply it now.
      if (pendingWelcome) {
        renderer.setIdentity(pendingWelcome);
        pendingWelcome = null;
      }

      cleanupControls = controls.attach(host, joyRef.current!, fireRef.current!, abRef.current!);

      // Wire joystick indicator
      controls.onJoystickMove = (dx, dy) => {
        if (joyDotRef.current) {
          const max = 40; // half of inner dot travel
          joyDotRef.current.style.transform = `translate(${dx * max}px, ${dy * max}px)`;
        }
      };

      // Update ping display every 5 s
      pingDisplayTimer = window.setInterval(() => {
        setPing(client!.getLatencyMs());
      }, 5_000);

      // Send input at 30 Hz
      inputTimer = window.setInterval(() => {
        const pos = renderer!.getYouCanvasPos();
        if (pos) {
          controls.playerCanvasX = pos.x;
          controls.playerCanvasY = pos.y;
        }
        const oppPos = renderer!.getOppCanvasPos();
        if (oppPos) {
          controls.oppCanvasX = oppPos.x;
          controls.oppCanvasY = oppPos.y;
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
        // Camera may mirror world by Y so YOU is always at the bottom — invert
        // input axes back into world coordinates before sending to server.
        if (renderer!.isFlipped()) {
          inp.dy = -inp.dy;
          inp.angle = -inp.angle;
        }
        client!.sendInput(inp);
      }, 33);
    };
    void start();

    return () => {
      cancelled = true;
      if (inputTimer) clearInterval(inputTimer);
      if (pingDisplayTimer) clearInterval(pingDisplayTimer);
      cleanupControls?.();
      client?.leave();
      client?.close();
      renderer?.destroy();
    };
  }, [matchId, nav]);

  const remainingS = Math.ceil(remainingMs / 1000);
  const cdS = Math.ceil(cdMs / 1000);

  return (
    <div className="relative h-full w-full overflow-hidden bg-bg">
      <div ref={hostRef} className="absolute inset-0" />
      {/* HUD */}
      <div className="pointer-events-none absolute inset-0 p-3">
        <div className="flex items-start justify-between text-sm">
          <div className="rounded-2xl border-2 border-game-cyan/40 bg-black/60 px-3 py-2 backdrop-blur shadow-[0_4px_0_rgba(0,0,0,0.5)]">
            <div className="text-xs uppercase text-game-cyan">{welcome?.you.username ?? 'YOU'}</div>
            <div className="font-display text-lg text-white">HP {hp.you}</div>
          </div>
          <div className="rounded-2xl border-2 border-game-pink/40 bg-black/60 px-3 py-2 text-right backdrop-blur shadow-[0_4px_0_rgba(0,0,0,0.5)]">
            <div className="text-xs uppercase text-game-pink">{welcome?.opponent.username ?? 'OPP'}</div>
            <div className="font-display text-lg text-white">HP {hp.opp}</div>
          </div>
        </div>
        <div className="mt-2 text-center text-xs text-white/50">
          {cdMs > 0 ? `${t('match.ability_cd')}: ${cdS}s` : t('match.ability_ready')}
        </div>
        {error && <div className="mt-3 text-center text-red-400">{error}</div>}
        {/* Timer — bottom-center, away from opponent spawn */}
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2">
          <div className="rounded-xl border border-game-yellow/40 bg-black/70 px-3 py-1.5 text-center backdrop-blur">
            <div className="font-display text-xl tabular-nums text-game-yellow">{remainingS}s</div>
          </div>
        </div>
        {/* Ping — subtle, top-center */}
        {ping > 0 && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2">
            <span className={
              'rounded-full px-2 py-0.5 text-[10px] font-mono ' +
              (ping < 80 ? 'bg-game-green/20 text-game-green' : ping < 180 ? 'bg-game-yellow/20 text-game-yellow' : 'bg-rose-500/20 text-rose-400')
            }>
              {ping}ms
            </span>
          </div>
        )}
        {/* Disconnect toast */}
        {disconnectMsg && (
          <div className="pointer-events-none absolute inset-x-0 top-1/3 flex justify-center">
            <div className="rounded-2xl border border-rose-400/40 bg-black/80 px-6 py-3 text-base font-semibold text-rose-300 backdrop-blur">
              {disconnectMsg}
            </div>
          </div>
        )}
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
      <div
        className="pointer-events-auto absolute bottom-6 left-6 h-32 w-32 rounded-full bg-white/15 backdrop-blur border border-white/20 md:opacity-30 flex items-center justify-center"
        ref={joyRef as never}
      >
        {/* Inner direction dot */}
        <div
          ref={joyDotRef}
          style={{ transition: 'transform 0.05s linear' }}
          className="h-10 w-10 rounded-full bg-white/60 shadow-[0_0_8px_rgba(255,255,255,0.4)] pointer-events-none"
        />
      </div>
      <button
        ref={fireRef}
        type="button"
        className="pointer-events-auto absolute bottom-6 right-6 h-24 w-24 select-none rounded-full bg-gradient-to-b from-[#ffe066] to-[#f5b800] font-display text-lg uppercase text-[#1a1450] shadow-[0_6px_0_#b88200,0_8px_18px_rgba(255,209,59,0.45)] active:translate-y-[3px] active:shadow-[0_3px_0_#b88200]"
      >
        FIRE
      </button>
      <button
        ref={abRef}
        type="button"
        className="pointer-events-auto absolute bottom-32 right-12 h-16 w-16 select-none rounded-full bg-gradient-to-b from-[#a774ff] to-[#7a3eff] font-display text-lg text-white shadow-[0_5px_0_#4d1fb8,0_6px_14px_rgba(138,79,255,0.45)] active:translate-y-[2px] active:shadow-[0_3px_0_#4d1fb8]"
      >
        Q
      </button>
    </div>
  );
}
