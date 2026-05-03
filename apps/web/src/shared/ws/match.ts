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
}

export class MatchClient {
  private ws: WebSocket | null = null;
  private inputSeq = 0;
  private pingTimer: number | null = null;

  constructor(
    private readonly url: string,
    private readonly handlers: MatchClientHandlers,
  ) {}

  connect(): void {
    const ws = new WebSocket(this.url);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    ws.addEventListener('open', () => {
      this.send(MSG.C_HELLO, { matchToken: '' });
      this.pingTimer = window.setInterval(() => {
        this.send(MSG.C_PING, { t: Date.now() });
      }, 5_000);
    });
    ws.addEventListener('message', (e) => {
      try {
        const frame = decodeMsg(e.data as ArrayBuffer);
        switch (frame.tag) {
          case MSG.S_WELCOME:
            this.handlers.onWelcome(frame.payload as SWelcome);
            break;
          case MSG.S_SNAPSHOT:
            this.handlers.onSnapshot(frame.payload as SSnapshot);
            break;
          case MSG.S_MATCH_END:
            this.handlers.onMatchEnd(frame.payload as SMatchEnd);
            break;
          case MSG.S_ERROR: {
            const p = frame.payload as { code: string; message: string };
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
    ws.addEventListener('close', () => {
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.handlers.onClose();
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
    if (this.pingTimer) clearInterval(this.pingTimer);
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
