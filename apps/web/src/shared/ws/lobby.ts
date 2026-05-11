/**
 * Lobby WebSocket — JSON, cookie-auth.
 * Listens for queue:status, match:found, wallet:update, ping/pong.
 */

export type LobbyEvent =
  | { type: 'queue:status'; state: 'idle' | 'searching' | 'long_wait' | 'matched'; mode?: string; roomId?: number; waitMs?: number; canRetry?: boolean; canCancel?: boolean }
  | {
      type: 'match:found';
      matchId: string;
      matchToken: string;
      gameWsUrl: string;
      opponent: { id: number; username: string };
      room: { id: number; name?: string; mode: 'FREE' | 'CASUAL' | 'STAKE'; stakeUsd?: string };
    }
  | { type: 'wallet:update'; balance: string; locked: string }
  | { type: 'ping'; t: number }
  | { type: 'pong'; t: number };

type Listener = (ev: LobbyEvent) => void;

class LobbyClient {
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private retry = 0;
  private pingTimer: number | null = null;
  private wantOpen = false;

  connect(): void {
    if (this.ws) return;
    this.wantOpen = true;
    this.open();
  }

  private open(): void {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${proto}//${location.host}/ws/lobby`;
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch (e) {
      console.warn('[lobby] ws ctor failed', e);
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    ws.addEventListener('open', () => {
      this.retry = 0;
      this.pingTimer = window.setInterval(() => {
        try {
          ws.send(JSON.stringify({ type: 'ping', t: Date.now() }));
        } catch {
          /* ignore */
        }
      }, 25_000);
    });
    ws.addEventListener('message', (e) => {
      let msg: LobbyEvent;
      try {
        msg = JSON.parse(e.data) as LobbyEvent;
      } catch {
        return;
      }
      if (msg.type === 'ping') {
        try {
          ws.send(JSON.stringify({ type: 'pong', t: msg.t }));
        } catch {
          /* ignore */
        }
        return;
      }
      for (const l of this.listeners) l(msg);
    });
    ws.addEventListener('close', (ev) => {
      if (this.pingTimer) {
        clearInterval(this.pingTimer);
        this.pingTimer = null;
      }
      this.ws = null;
      // Server uses code 4000 "replaced" when the same user opens a second
      // tab and that tab's lobby socket displaces this one. Reconnecting
      // would create a ping-pong where both tabs keep displacing each other
      // multiple times per second — flooding the API with `user X connected`
      // log spam and triggering false `idle` frames on the surviving tab.
      // Stop reconnecting permanently on 4000; the other tab owns the lobby.
      if (ev.code === 4000) {
        this.wantOpen = false;
        return;
      }
      if (this.wantOpen) this.scheduleReconnect();
    });
    ws.addEventListener('error', () => {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    });
  }

  private scheduleReconnect(): void {
    this.retry++;
    const delay = Math.min(15_000, 500 * 2 ** Math.min(this.retry, 5));
    setTimeout(() => {
      if (this.wantOpen) this.open();
    }, delay);
  }

  on(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  disconnect(): void {
    this.wantOpen = false;
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        /* ignore */
      }
      this.ws = null;
    }
  }
}

export const lobby = new LobbyClient();
