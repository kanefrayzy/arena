import { useEffect, useState } from 'react';
import { api } from '../../../shared/api/client';

interface Payment {
  id: string;
  userId: number;
  type: string;
  status: string;
  amountUsd: string;
  provider: string;
  externalId: string | null;
  createdAt: string;
  finishedAt: string | null;
}

const STATUSES = ['', 'PENDING', 'APPROVED', 'REJECTED', 'COMPLETED'];

export function PaymentsTab() {
  const [items, setItems] = useState<Payment[]>([]);
  const [status, setStatus] = useState('PENDING');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    setErr(null);
    try {
      const r = await api.get<{ items: Payment[] }>(`/admin/payments${status ? `?status=${status}` : ''}`);
      setItems(r.items);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'load failed');
    }
  }

  useEffect(() => {
    void load();
  }, [status]);

  async function approve(p: Payment) {
    setBusy(p.id);
    try {
      await api.post(`/admin/payments/${p.id}/approve`);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'failed');
    } finally {
      setBusy(null);
    }
  }

  async function reject(p: Payment) {
    const reason = window.prompt('Reject reason:', 'KYC failed');
    if (!reason) return;
    setBusy(p.id);
    try {
      await api.post(`/admin/payments/${p.id}/reject`, { reason });
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
      {items.length === 0 && <div className="text-xs text-white/50">no payments</div>}
      {items.map((p) => (
        <div key={p.id} className="rounded bg-surface px-2 py-2 text-xs">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px]">{p.id.slice(0, 8)}… · #{p.userId}</span>
            <span className="rounded bg-white/10 px-1 text-[10px]">{p.status}</span>
          </div>
          <div className="mt-1 text-[10px] text-white/60">
            {p.type} · ${p.amountUsd} · {p.provider}
          </div>
          {p.status === 'PENDING' && (
            <div className="mt-2 flex gap-1">
              <button type="button" disabled={busy === p.id} onClick={() => void approve(p)} className="flex-1 rounded bg-green-500/20 py-1 text-[10px] text-green-300">
                approve
              </button>
              <button type="button" disabled={busy === p.id} onClick={() => void reject(p)} className="flex-1 rounded bg-red-500/20 py-1 text-[10px] text-red-300">
                reject
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
