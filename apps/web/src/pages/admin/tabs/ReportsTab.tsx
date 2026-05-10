import { useEffect, useState } from 'react';
import { api } from '../../../shared/api/client';

interface ReportItem {
  id: number;
  matchId: string;
  reporter: { id: number; username: string; email: string };
  category: string;
  message: string;
  status: 'pending' | 'reviewed' | 'resolved' | 'dismissed';
  adminNote: string | null;
  createdAt: string;
  reviewedAt: string | null;
  match: {
    id: string;
    status: string;
    winnerId: number | null;
    player1Id: number;
    player2Id: number;
    roomId: number;
    finishedAt: string | null;
  } | null;
}

const STATUSES: Array<ReportItem['status'] | 'all'> = ['pending', 'reviewed', 'resolved', 'dismissed', 'all'];

const TONE: Record<ReportItem['status'], string> = {
  pending:   'bg-amber-500/15 text-amber-300 border-amber-500/30',
  reviewed:  'bg-blue-500/15 text-blue-300 border-blue-500/30',
  resolved:  'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  dismissed: 'bg-white/5 text-white/40 border-white/10',
};

export function ReportsTab() {
  const [items, setItems] = useState<ReportItem[]>([]);
  const [statusFilter, setStatusFilter] = useState<typeof STATUSES[number]>('pending');
  const [busyId, setBusyId] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    setErr(null);
    try {
      const q = statusFilter === 'all' ? '' : `?status=${statusFilter}`;
      const r = await api.get<{ items: ReportItem[] }>(`/admin/reports${q}`);
      setItems(r.items);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'load failed');
    }
  }

  useEffect(() => { void load(); }, [statusFilter]);

  async function review(id: number, status: ReportItem['status'], adminNote?: string) {
    setBusyId(id);
    try {
      await api.post(`/admin/reports/${id}/review`, { status, adminNote });
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'failed');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {STATUSES.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStatusFilter(s)}
            className={
              'rounded-md border px-3 py-1.5 text-xs uppercase tracking-wider transition ' +
              (statusFilter === s
                ? 'border-accent/50 bg-accent/15 text-accent'
                : 'border-white/10 text-white/60 hover:bg-white/5')
            }
          >
            {s}
          </button>
        ))}
      </div>
      {err && <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{err}</div>}

      <div className="space-y-3">
        {items.map((r) => (
          <div key={r.id} className="rounded-lg border border-white/10 bg-white/[0.02] p-4">
            <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
              <span className={`rounded-md border px-2 py-0.5 uppercase ${TONE[r.status]}`}>{r.status}</span>
              <span className="rounded-md bg-white/10 px-2 py-0.5 uppercase tracking-wider">{r.category}</span>
              <span className="text-white/40">#{r.id}</span>
              <span className="text-white/40">·</span>
              <span className="text-white/60">@{r.reporter.username}</span>
              <span className="text-white/30">({r.reporter.email})</span>
              <span className="ml-auto text-white/40">{new Date(r.createdAt).toLocaleString()}</span>
            </div>
            <div className="mb-2 whitespace-pre-wrap break-words text-sm">{r.message}</div>
            <div className="mb-3 text-[11px] text-white/40">
              match <span className="font-mono text-white/60">{r.matchId}</span>
              {r.match && (
                <>
                  {' · '}
                  <span>room {r.match.roomId}</span>
                  {' · '}
                  <span>{r.match.status}</span>
                  {r.match.winnerId && <> · winner <span className="text-emerald-300">#{r.match.winnerId}</span></>}
                </>
              )}
            </div>
            {r.adminNote && (
              <div className="mb-3 rounded-md bg-white/5 p-2 text-xs text-white/70">
                <span className="text-white/40">note: </span>{r.adminNote}
              </div>
            )}
            {r.status === 'pending' && (
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busyId === r.id}
                  onClick={() => review(r.id, 'resolved', prompt('Note (optional):') ?? undefined)}
                  className="rounded-md bg-emerald-500/15 px-3 py-1 text-xs text-emerald-300 hover:bg-emerald-500/25 disabled:opacity-50"
                >resolve</button>
                <button
                  type="button"
                  disabled={busyId === r.id}
                  onClick={() => review(r.id, 'reviewed')}
                  className="rounded-md bg-blue-500/15 px-3 py-1 text-xs text-blue-300 hover:bg-blue-500/25 disabled:opacity-50"
                >mark reviewed</button>
                <button
                  type="button"
                  disabled={busyId === r.id}
                  onClick={() => review(r.id, 'dismissed', prompt('Reason (optional):') ?? undefined)}
                  className="rounded-md bg-white/5 px-3 py-1 text-xs text-white/60 hover:bg-white/10 disabled:opacity-50"
                >dismiss</button>
              </div>
            )}
          </div>
        ))}
        {items.length === 0 && (
          <div className="rounded-lg border border-white/10 bg-white/[0.02] p-8 text-center text-sm text-white/40">
            No reports
          </div>
        )}
      </div>
    </div>
  );
}
