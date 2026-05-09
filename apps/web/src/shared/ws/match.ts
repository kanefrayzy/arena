import {
  MSG,
  decodeMsg,
  encodeMsg,
  type CInput,
  type SWelcome,
  type SSnapshot,
  type SMatchEnd,
} from '@arena/protocol';

export interface MatchClientHandlers {
  onWelcome: (msg: SWelcome) => void;
  onSnapshot: (msg: SSnapshot) => void;
  onMatchEnd: (msg: SMatchEnd) => void;
  onError: (code: string, message: string) => void;
  onClose: () => void;
  /** Both players are connected and the simulation is starting — trigger countdown. */
  onMatchBegin?: () => void;
  /** A reconnect attempt is in progress. attempt is 1-based. */
  onReconnecting?: (attempt: number) => void;
  /** A reconnect attempt succeeded; the WS is open again. */
  onReconnected?: () => void;
  /** All reconnect attempts failed; the connection is permanently lost. */
  onReconnectGaveUp?: () => void;
}

/** Backoff schedule (ms) between automatic reconnect attempts. The length of
 *  this array also caps the number of retries. Total budget here is ~16 s,
 *  comfortably inside the server's 15 s reconnect window because the first
 *  retry fires almost immediately. */
const RECONNECT_DELAYS_MS = [500, 1_500, 3_000, 5_000, 7_000];

export class MatchClient {
  private ws: WebSocket | null = null;
  private inputSeq = 0;
  private pingTimer: number | null = null;
  private _latencyMs = 0;
  /** Set to true once we receive S_WELCOME at least once — used to know if a
   *  close should trigger a reconnect (no point reconnecting if we never
   *  even handshook successfully). */
  private welcomed = false;
  /** Set to true once the match is over (S_MATCH_END received or .close() called)
   *  so that we never auto-reconnect after intentional teardown. */
  private terminated = false;
  private reconnectAttempt = 0;
  private reconnectTimer: number | null = null;

  constructor(
    private readonly url: string,
    private readonly handlers: MatchClientHandlers,
  ) {}

  /** Round-trip latency in ms (updated every 5 s). */
  getLatencyMs(): number {
    return this._latencyMs;
  }

  connect(): void {
    this.openSocket();
  }

  private openSocket(): void {
    if (this.terminated) return;
    const ws = new WebSocket(this.url);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    ws.addEventListener('open', () => {
      this.send(MSG.C_HELLO, { matchToken: '' });
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.pingTimer = window.setInterval(() => {
        this.send(MSG.C_PING, { t: Date.now() });
      }, 5_000);
      // If this socket is the result of a successful retry, notify the UI.
      if (this.reconnectAttempt > 0) {
        this.reconnectAttempt = 0;
        this.handlers.onReconnected?.();
      }
    });
    ws.addEventListener('message', (e) => {
      try {
        const frame = decodeMsg(e.data as ArrayBuffer);
        switch (frame.tag) {
          case MSG.S_WELCOME:
            this.welcomed = true;
            this.handlers.onWelcome(frame.payload as SWelcome);
            break;
          case MSG.S_MATCH_BEGIN:
            this.handlers.onMatchBegin?.();
            break;
          case MSG.S_SNAPSHOT:
            this.handlers.onSnapshot(frame.payload as SSnapshot);
            break;
          case MSG.S_MATCH_END:
            // No more reconnects after the match ends.
            this.terminated = true;
            this.handlers.onMatchEnd(frame.payload as SMatchEnd);
            break;
          case MSG.S_PONG: {
            const p = frame.payload as { t: number };
            this._latencyMs = Math.round((Date.now() - p.t) / 2);
            break;
          }
          case MSG.S_ERROR: {
            const p = frame.payload as { code: string; message: string };
            // Auth/seed errors are unrecoverable — don't retry.
            if (p.code === 'TOKEN_EXPIRED' || p.code === 'BAD_TOKEN' || p.code === 'NO_MATCH' || p.code === 'FORBIDDEN') {
              this.terminated = true;
            }
            this.handlers.onError(p.code, p.message);
            break;
          }
          default:
            break;
        }
      } catch (err) {
        console.warn('[match] decode failed', err);
      }
    });
    ws.addEventListener('close', (ev) => {
      if (this.pingTimer) {
        clearInterval(this.pingTimer);
        this.pingTimer = null;
      }
      // Decide whether to retry. We retry only when:
      //   1. The match isn't intentionally over (terminated=false).
      //   2. We had at least one successful welcome (so we know the URL is valid).
      //   3. We haven't blown the retry budget yet.
      // Server-issued normal closes (1000) are treated as terminal.
      if (this.terminated || ev.code === 1000) {
        this.handlers.onClose();
        return;
      }
      if (!this.welcomed) {
        // Never handshook — likely auth or seed problem; don't loop.
        this.handlers.onClose();
        return;
      }
      if (this.reconnectAttempt >= RECONNECT_DELAYS_MS.length) {
        this.handlers.onReconnectGaveUp?.();
        this.handlers.onClose();
        return;
      }
      const delay = RECONNECT_DELAYS_MS[this.reconnectAttempt] ?? 5_000;
      this.reconnectAttempt += 1;
      this.handlers.onReconnecting?.(this.reconnectAttempt);
      this.reconnectTimer = window.setTimeout(() => {
        this.reconnectTimer = null;
        this.openSocket();
      }, delay);
    });
    ws.addEventListener('error', () => undefined);
  }

  sendInput(input: Omit<CInput, 'seq'>): void {
    this.send(MSG.C_INPUT, { seq: ++this.inputSeq, ...input } satisfies CInput);
  }

  leave(): void {
    this.send(MSG.C_LEAVE, {});
  }

  close(): void {
    this.terminated = true;
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
  }

  private send(tag: number, payload: unknown): void {
    if (!this.ws || this.ws.readyState !== this.ws.OPEN) return;
    try {
      this.ws.send(encodeMsg(tag as never, payload));
    } catch {
      /* ignore */
    }
  }
}
