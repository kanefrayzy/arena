import { useEffect, useState } from 'react';
import { api } from '../../../shared/api/client';

interface Match {
  id: string;
  roomId: number;
  player1Id: number;
  player2Id: number;
  winnerId: number | null;
  status: string;
  stakeUsd: string;
  startedAt: string | null;
  finishedAt: string | null;
}

const STATUSES = ['', 'PENDING', 'RUNNING', 'FINISHED', 'DISPUTED', 'CANCELLED'];

export function MatchesTab() {
  const [items, setItems] = useState<Match[]>([]);
  const [status, setStatus] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    setErr(null);
    try {
      const r = await api.get<{ items: Match[] }>(`/admin/matches${status ? `?status=${status}` : ''}`);
      setItems(r.items);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'load failed');
    }
  }

  useEffect(() => {
    void load();
  }, [status]);

  async function forceFinish(m: Match) {
    const winnerStr = window.prompt(
      `Force-finish ${m.id}\nwinnerId (${m.player1Id} or ${m.player2Id}, empty=refund both):`,
      String(m.player1Id),
    );
    if (winnerStr === null) return;
    const winnerId = winnerStr.trim() === '' ? null : parseInt(winnerStr, 10);
    const reason = window.prompt('Reason:', 'admin force-finish');
    if (!reason) return;
    setBusy(m.id);
    try {
      await api.post(`/admin/matches/${m.id}/force-finish`, { winnerId, reason });
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'failed');
    } finally {
      setBusy(null);
    }
  }

  async function refund(m: Match) {
    const reason = window.prompt('Refund reason:', 'admin refund');
    if (!reason) return;
    setBusy(m.id);
    try {
      await api.post(`/admin/matches/${m.id}/refund`, { reason });
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'failed');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <select
        value={status}
        onChange={(e) => setStatus(e.target.value)}
        className="rounded bg-white/5 px-2 py-1 text-xs"
      >
        {STATUSES.map((s) => (
          <option key={s} value={s}>
            {s || '(all)'}
          </option>
        ))}
      </select>
      {err && <div className="text-xs text-red-400">{err}</div>}
      {items.map((m) => (
        <div key={m.id} className="rounded bg-surface px-2 py-2 text-xs">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px]">{m.id.slice(0, 8)}…</span>
            <span
              className={
                'rounded px-1 text-[10px] ' +
                (m.status === 'RUNNING'
                  ? 'bg-green-500/20 text-green-300'
                  : m.status === 'DISPUTED'
                  ? 'bg-red-500/20 text-red-300'
                  : 'bg-white/10')
              }
            >
              {m.status}
            </span>
          </div>
          <div className="mt-1 text-[10px] text-white/60">
            #{m.player1Id} vs #{m.player2Id} · ${m.stakeUsd}
            {m.winnerId != null && <> · winner #{m.winnerId}</>}
          </div>
          {(m.status === 'RUNNING' || m.status === 'DISPUTED' || m.status === 'PENDING') && (
            <div className="mt-2 flex gap-1">
              <button type="button" disabled={busy === m.id} onClick={() => void forceFinish(m)} className="flex-1 rounded bg-white/10 py-1 text-[10px]">
                force-finish
              </button>
              <button type="button" disabled={busy === m.id} onClick={() => void refund(m)} className="flex-1 rounded bg-yellow-500/20 py-1 text-[10px] text-yellow-300">
                refund
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
