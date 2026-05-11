import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { MatchClient } from '../../shared/ws/match';
import { Controls } from '../../shared/game/controls';
import { PixiRenderer } from '../../shared/game/pixi-renderer';
import * as sfx from '../../shared/game/audio';
import { useAuth } from '../../shared/store/auth';
import type { SWelcome, SSnapshot, SMatchEnd } from '@arena/protocol';
import { DesktopControlsHint } from '../../shared/ui/desktop-controls-hint';

interface MatchInfo {
  matchToken: string;
  gameWsUrl: string;
  opponent: { id: number; username: string };
  room: { id: number; name?: string; mode: 'FREE' | 'CASUAL' | 'STAKE'; stakeUsd?: string };
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
  /** True between welcome (waitingForOpponent=true) and S_MATCH_BEGIN. */
  const [waitingForOpp, setWaitingForOpp] = useState(false);
  /** Set to attempt# (1+) while a reconnect is in flight; null otherwise. */
  const [reconnecting, setReconnecting] = useState<number | null>(null);
  // Detect touch / coarse-pointer once on mount. We still render the joystick
  // and action buttons in the DOM (controls.attach needs them to bind touch
  // listeners on hot-swap to a mobile browser), but they are hidden on
  // desktop where the player aims with mouse + WASD.
  const [touchUi] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    if (window.matchMedia?.('(pointer: coarse)').matches) return true;
    if ('ontouchstart' in window || (navigator?.maxTouchPoints ?? 0) > 0) return true;
    return false;
  });
  /** True after all reconnect attempts have failed and the user must go home. */
  const [lost, setLost] = useState(false);
  const inputBlockedRef = useRef(true);
  const countdownStartedRef = useRef(false);
  const lostRef = useRef(false);
  /**
   * True once the LOCAL player's HP reaches 0 in a server snapshot. Movement,
   * fire and ability inputs are zeroed for the remainder of the match so the
   * dead body doesn't keep walking around the map (especially important on
   * the client because of input prediction — without this gate the predicted
   * sprite would happily slide for the ~1.5s grace before MatchEnd arrives).
   */
  const youDeadRef = useRef(false);

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
      // Buffer messages if they arrive before the renderer is ready. We always
      // process HUD state (HP/timer/cooldown) immediately so the player sees
      // the match is alive even while sprite assets are still loading; only the
      // visual snapshot application is deferred.
      let pendingWelcome: SWelcome | null = null;
      let pendingSnapshot: SSnapshot | null = null;
      let rendererReady = false;
      let welcomedRef = false;
      // Safety net: if the server never sends welcome (NO_MATCH/seed gone),
      // bail out to home instead of leaving the user staring at a blue screen.
      const welcomeTimeout = window.setTimeout(() => {
        if (!welcomedRef && !cancelled) {
          sessionStorage.removeItem(`match:${matchId}`);
          nav('/home');
        }
      }, 12_000);

      // ── Connect to game server IMMEDIATELY (before renderer finishes loading).
      //    This cancels the server-side 10-second reconnect timer right away so the
      //    match isn't ended while the renderer is still initialising.
      const startCountdown = () => {
        if (countdownStartedRef.current) return;
        countdownStartedRef.current = true;
        setWaitingForOpp(false);
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
      };

      client = new MatchClient(wsUrl, {
        onWelcome: (msg) => {
          welcomedRef = true;
          window.clearTimeout(welcomeTimeout);
          setWelcome(msg);
          youId = msg.you.id;
          if (rendererReady) {
            renderer!.setIdentity(msg);
          } else {
            pendingWelcome = msg;
          }
          if (msg.started) {
            // Reconnecting to already-running match — skip countdown, unlock immediately.
            setWaitingForOpp(false);
            inputBlockedRef.current = false;
            setCountdown(null);
            countdownStartedRef.current = true; // never re-trigger
            sfx.unlockAudio();
          } else if ((msg as SWelcome & { waitingForOpponent?: boolean }).waitingForOpponent) {
            // First to arrive — opponent still loading. Show overlay; do not start
            // the countdown until the server says S_MATCH_BEGIN.
            setWaitingForOpp(true);
            inputBlockedRef.current = true;
            setCountdown(null);
            sfx.unlockAudio();
          } else {
            // Both already attached server-side at welcome time (e.g. nearly-simultaneous
            // joins). S_MATCH_BEGIN will follow almost immediately, but if it's already
            // been delivered we kick the countdown now.
            startCountdown();
          }
        },
        onMatchBegin: () => {
          // Both players are connected — start the synced countdown.
          startCountdown();
        },
        onReconnecting: (attempt) => {
          setReconnecting(attempt);
        },
        onReconnected: () => {
          setReconnecting(null);
        },
        onReconnectGaveUp: () => {
          setReconnecting(null);
          lostRef.current = true;
          setLost(true);
        },
        onSnapshot: (msg: SSnapshot) => {
          // Snapshots arriving = match has begun. This is the ground truth and
          // a robust fallback in case S_MATCH_BEGIN was lost or arrived before
          // the handler was wired (e.g. flaky network, stale tab). startCountdown
          // is idempotent (guarded by countdownStartedRef), so calling it here
          // is safe even when the welcome `else` branch already kicked it off.
          if (!countdownStartedRef.current) startCountdown();
          // Defensive: if the overlay is somehow still up by the time real
          // gameplay snapshots are flowing, force-hide it. Snapshots are the
          // ground truth that the opponent is here and the simulation is live.
          setWaitingForOpp(false);
          // HUD updates ALWAYS run, even if the renderer isn't ready yet —
          // otherwise the player sees a frozen 0-second timer and HP bars
          // while sprite assets are still downloading. The visual snapshot is
          // buffered and applied as soon as the renderer is ready.
          const me = msg.players.find((p) => p.id === youId);
          const opp = msg.players.find((p) => p.id !== youId);
          if (me) setCdMs(me.abilityCdMs);
          setHp({ you: me?.hp ?? 0, opp: opp?.hp ?? 0 });
          // Latch death flag as soon as the server reports hp<=0. Once dead,
          // stay dead for the rest of the match — server may bounce us back to
          // 100 hp on respawn modes, but in 1v1 there's no respawn.
          if (me && me.hp <= 0) youDeadRef.current = true;
          setRemainingMs(msg.remainingMs);
          if (!rendererReady) {
            pendingSnapshot = msg;
            return;
          }
          renderer!.applySnapshot(msg);
        },
        onMatchEnd: (msg: SMatchEnd) => {
          const youWon = msg.winnerId === youId;
          sfx.matchEnd(youWon);
          // Stash the result IMMEDIATELY so the result page can render even
          // if MatchPage unmounts before any delay timer fires (the WS close
          // that follows S_MATCH_END races with the disconnect-toast timeout
          // — if onClose's nav('/home') wins, sessionStorage was never set
          // and the result page sees a blank screen).
          //
          // We also include `youId` because ResultPage is reached via plain
          // navigation (no guard) and after a mid-match page refresh the
          // global auth store may not yet be populated — useAuth().me would
          // be null and the page would render `null` (“blue” screen). With
          // youId baked into the result payload the page can render without
          // depending on the auth store.
          sessionStorage.setItem(`result:${matchId}`, JSON.stringify({
            ...msg,
            opponent: info.opponent,
            room: info.room,
            youId,
            // Cup value captured the moment the user entered the match page,
            // so the result screen can compute & animate the +/- cup delta
            // without an extra API roundtrip.
            cupBefore: useAuth.getState().me?.cup ?? 0,
          }));
          if (msg.reason === 'disconnect') {
            // Tell the player whose perspective they're seeing this from:
            // if YOU lost on disconnect, it's YOUR connection that dropped
            // (page refresh / network), not the opponent's.
            setDisconnectMsg(youWon ? 'Противник отключился' : 'Соединение потеряно');
            window.setTimeout(() => {
              nav(`/result/${matchId}`);
            }, 2000);
          } else {
            // 1.5 s grace so players actually SEE the kill / final state on the
            // map before being yanked to the result screen. The result
            // payload is already stashed above, so onClose's nav-to-home
            // short-circuit still works if the WS closes during this window.
            window.setTimeout(() => {
              nav(`/result/${matchId}`);
            }, 1500);
          }
        },
        onError: (code, message) => {
          // Terminal errors from the game server: the match doesn't exist on
          // this node, the token is bad/expired, or we aren't a participant.
          // Don't leave the user on a blue screen — clear the stash and bail.
          if (code === 'NO_MATCH' || code === 'FORBIDDEN' || code === 'TOKEN_EXPIRED' || code === 'BAD_TOKEN') {
            window.clearTimeout(welcomeTimeout);
            sessionStorage.removeItem(`match:${matchId}`);
            nav('/home');
            return;
          }
          setError(`${code}: ${message}`);
        },
        onClose: () => {
          // server closed; if we don't have a result yet AND we aren't already
          // showing the "connection lost" screen (which has its own button), go home.
          if (!sessionStorage.getItem(`result:${matchId}`) && !lostRef.current) {
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
      // Drain the most recent buffered snapshot so players appear on the map
      // immediately, instead of having to wait for the next 33 ms tick.
      if (pendingSnapshot) {
        renderer.applySnapshot(pendingSnapshot);
        pendingSnapshot = null;
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
        if (youDeadRef.current) {
          // Dead = no movement, no shooting. Match-end timeout will move the
          // user to the result screen shortly.
          inp.dx = 0;
          inp.dy = 0;
          inp.fire = false;
          inp.ability = false;
        }
        // Feed the local input vector to the renderer for client-side
        // prediction BEFORE we flip dy for the server — the renderer thinks
        // in display-space (camera-flipped) coords.
        renderer!.setLocalInput(inp.dx, inp.dy);
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
      // Do NOT call client.leave() here. Component unmount happens for many
      // reasons (back nav, tab switch, route change) and is not a reliable
      // signal of an intentional forfeit. We just close the socket; the
      // server grants a reconnect grace window so the player can return.
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
      {/* Waiting for opponent overlay */}
      {waitingForOpp && countdown === null && !lost && reconnecting === null && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center bg-black/55 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-4">
            <div className="relative h-16 w-16">
              <div className="absolute inset-0 animate-ping rounded-full bg-game-yellow/30" />
              <div className="absolute inset-2 rounded-full bg-gradient-to-b from-[#ffe066] to-[#f5b800] shadow-[0_0_24px_rgba(255,209,59,0.5)]" />
            </div>
            <div className="font-display text-2xl uppercase tracking-wide text-white">
              Ожидание противника…
            </div>
            <div className="text-sm text-white/60">Подключаем второго игрока</div>
          </div>
        </div>
      )}
      {/* Reconnecting overlay */}
      {reconnecting !== null && !lost && (
        <div className="pointer-events-auto absolute inset-0 flex flex-col items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-4 rounded-2xl border border-game-yellow/40 bg-black/80 px-8 py-6">
            <div className="h-10 w-10 animate-spin rounded-full border-2 border-game-yellow border-t-transparent" />
            <div className="font-display text-xl uppercase tracking-wide text-game-yellow">
              Соединение прервано
            </div>
            <div className="text-sm text-white/70">
              Переподключение… попытка {reconnecting}
            </div>
          </div>
        </div>
      )}
      {/* Connection lost (retries exhausted) */}
      {lost && (
        <div className="pointer-events-auto absolute inset-0 flex flex-col items-center justify-center bg-black/85 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-5 rounded-2xl border border-rose-400/40 bg-black/90 px-8 py-7 text-center">
            <div className="text-4xl">📡</div>
            <div className="font-display text-2xl uppercase tracking-wide text-rose-300">
              Соединение потеряно
            </div>
            <div className="max-w-xs text-sm text-white/70">
              Не удалось переподключиться к серверу. Проверьте интернет.
            </div>
            <button
              type="button"
              onClick={() => nav('/home')}
              className="game-btn game-btn-yellow"
            >
              На главную
            </button>
          </div>
        </div>
      )}
      {/* VS / countdown intro — Brawl-Stars-style portrait clash */}
      {countdown !== null && welcome && (
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          {/* Animated darkening background w/ diagonal sweep */}
          <div className="absolute inset-0 bg-gradient-to-br from-black/85 via-black/60 to-black/85 backdrop-blur-md" />
          <div className="absolute -inset-x-1/4 top-1/2 h-40 -translate-y-1/2 -rotate-6 bg-gradient-to-r from-transparent via-white/10 to-transparent animate-[shimmer_2.5s_linear_infinite]" />
          {/* Radial spotlights */}
          <div className="absolute -left-20 top-1/2 h-72 w-72 -translate-y-1/2 rounded-full bg-emerald-400/30 blur-3xl animate-pulse" />
          <div className="absolute -right-20 top-1/2 h-72 w-72 -translate-y-1/2 rounded-full bg-rose-500/30 blur-3xl animate-pulse" />

          {/* Portrait clash row */}
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="relative flex w-full max-w-3xl items-center justify-between px-6 md:px-12">
              {/* YOU — slides from left */}
              <div className="flex flex-col items-center gap-2 animate-slide-in-left">
                <div className="relative h-28 w-28 md:h-36 md:w-36 rounded-3xl border-4 border-emerald-400 bg-gradient-to-br from-emerald-400/40 to-emerald-700/20 shadow-[0_0_40px_rgba(74,210,154,0.55)] overflow-hidden">
                  {welcome.you.characterSpriteUrl ? (
                    <img src={welcome.you.characterSpriteUrl} alt="" className="h-full w-full object-cover" draggable={false} />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-5xl">🤺</div>
                  )}
                  <div className="pointer-events-none absolute inset-x-0 top-0 h-1/3 bg-gradient-to-b from-white/30 to-transparent" />
                </div>
                <div className="rounded-full bg-emerald-500/90 px-3 py-0.5 text-sm font-black uppercase tracking-wide text-emerald-950 shadow-[0_2px_0_rgba(0,0,0,0.4)] max-w-[8rem] truncate">
                  {welcome.you.username}
                </div>
              </div>

              {/* VS badge — pops in */}
              <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 animate-pop-vs">
                <div className="relative flex h-20 w-20 md:h-24 md:w-24 items-center justify-center rounded-full bg-gradient-to-br from-yellow-300 via-amber-400 to-orange-500 shadow-[0_0_50px_rgba(255,200,40,0.8)] ring-4 ring-yellow-200/60">
                  <span className="font-display text-2xl md:text-3xl font-black tracking-tight text-amber-950 drop-shadow-[0_2px_0_rgba(255,255,255,0.5)]">VS</span>
                  <span className="absolute inset-0 animate-ping rounded-full bg-yellow-300/40" />
                </div>
              </div>

              {/* OPP — slides from right */}
              <div className="flex flex-col items-center gap-2 animate-slide-in-right">
                <div className="relative h-28 w-28 md:h-36 md:w-36 rounded-3xl border-4 border-rose-400 bg-gradient-to-br from-rose-400/40 to-rose-700/20 shadow-[0_0_40px_rgba(224,108,117,0.55)] overflow-hidden">
                  {welcome.opponent.characterSpriteUrl ? (
                    <img src={welcome.opponent.characterSpriteUrl} alt="" className="h-full w-full object-cover" draggable={false} />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-5xl">👤</div>
                  )}
                  <div className="pointer-events-none absolute inset-x-0 top-0 h-1/3 bg-gradient-to-b from-white/30 to-transparent" />
                </div>
                <div className="rounded-full bg-rose-500/90 px-3 py-0.5 text-sm font-black uppercase tracking-wide text-rose-950 shadow-[0_2px_0_rgba(0,0,0,0.4)] max-w-[8rem] truncate">
                  {welcome.opponent.username}
                </div>
              </div>
            </div>
          </div>

          {/* Countdown number — bottom */}
          <div className="absolute inset-x-0 bottom-[18%] flex flex-col items-center justify-center">
            <div
              key={countdown}
              className="font-display animate-count-pop tabular-nums"
              style={{
                fontSize: countdown === 0 ? '5rem' : '7rem',
                lineHeight: 1,
                color: countdown === 0 ? '#f5c518' : '#fff',
                textShadow: countdown === 0
                  ? '0 0 30px rgba(245,197,24,0.9), 0 4px 0 rgba(0,0,0,0.4)'
                  : '0 0 25px rgba(255,255,255,0.6), 0 4px 0 rgba(0,0,0,0.4)',
                fontWeight: 900,
                letterSpacing: countdown === 0 ? '0.05em' : '0',
              }}
            >
              {countdown === 0 ? 'FIGHT!' : countdown}
            </div>
          </div>
          {!touchUi && (
            <div className="absolute inset-x-0 bottom-6 flex justify-center px-4 pointer-events-none">
              <DesktopControlsHint />
            </div>
          )}
        </div>
      )}
      {/* Mobile controls — hidden on desktop (pointer:fine, no touch) but still
       *  rendered so the controls.attach() refs are always wired in case the
       *  user hot-plugs a touch device or rotates a 2-in-1 into tablet mode. */}
      <div
        className={
          'pointer-events-auto absolute bottom-6 left-6 h-32 w-32 rounded-full bg-white/15 backdrop-blur border border-white/20 md:opacity-30 flex items-center justify-center ' +
          (touchUi ? '' : 'hidden')
        }
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
        className={
          'pointer-events-auto absolute bottom-6 right-6 h-24 w-24 select-none rounded-full bg-gradient-to-b from-[#ffe066]/25 to-[#f5b800]/25 font-display text-lg uppercase text-white/60 shadow-[0_4px_0_rgba(184,130,0,0.2)] active:translate-y-[3px] active:shadow-[0_2px_0_rgba(184,130,0,0.2)] backdrop-blur-sm border border-[#ffe066]/20 ' +
          (touchUi ? '' : 'hidden')
        }
      >
        FIRE
      </button>
      <button
        ref={abRef}
        type="button"
        className={
          'pointer-events-auto absolute bottom-32 right-12 h-16 w-16 select-none rounded-full bg-gradient-to-b from-[#a774ff]/25 to-[#7a3eff]/25 overflow-hidden shadow-[0_4px_0_rgba(77,31,184,0.2)] active:translate-y-[2px] active:shadow-[0_2px_0_rgba(77,31,184,0.2)] backdrop-blur-sm border border-[#a774ff]/20 flex items-center justify-center ' +
          (touchUi ? '' : 'hidden')
        }
      >
        {/* Ability icon or fallback letter */}
        {welcome?.you.ability?.iconUrl ? (
          <img
            src={welcome.you.ability.iconUrl}
            className="h-full w-full object-cover"
            alt=""
            draggable={false}
          />
        ) : (
          <span className="font-display text-lg text-white">Q</span>
        )}
        {/* Dark overlay when on cooldown */}
        {cdMs > 0 && (
          <div className="absolute inset-0 rounded-full bg-black/55 pointer-events-none" />
        )}
        {/* Circular cooldown arc — draws remaining CD (shrinks clockwise as CD expires) */}
        {cdMs > 0 && (
          <svg
            className="absolute inset-0 -rotate-90 pointer-events-none"
            viewBox="0 0 64 64"
          >
            <circle
              cx="32"
              cy="32"
              r="28"
              fill="none"
              stroke="rgba(200,160,255,0.9)"
              strokeWidth="4"
              strokeLinecap="round"
              strokeDasharray="175.93"
              strokeDashoffset={175.93 * (1 - cdMs / (welcome?.you.ability?.cooldownMs ?? 8000))}
            />
          </svg>
        )}
        {/* Seconds remaining */}
        {cdMs > 0 && (
          <span className="absolute inset-0 flex items-center justify-center text-sm font-bold text-white drop-shadow-[0_1px_3px_rgba(0,0,0,1)] pointer-events-none">
            {Math.ceil(cdMs / 1000)}
          </span>
        )}
        {/* Ready glow ring */}
        {cdMs === 0 && (
          <div className="absolute inset-0 rounded-full ring-2 ring-[#c8a0ff]/60 pointer-events-none" />
        )}
      </button>
    </div>
  );
}
