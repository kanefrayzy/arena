import { useEffect, useState } from 'react';
import { api } from '../../../shared/api/client';

interface Room {
  id: number;
  name: string;
  mode: string;
  stakeUsd: string | null;
  commissionPct: number;
  matchDurationS: number;
  winCondition: string;
  isActive: boolean;
  minBalanceRequired: boolean;
}

export function RoomsTab() {
  const [items, setItems] = useState<Room[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  async function load() {
    setErr(null);
    try {
      const r = await api.get<{ items: Room[] }>('/admin/rooms');
      setItems(r.items);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'load failed');
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function toggle(r: Room) {
    setBusy(r.id);
    try {
      await api.patch(`/admin/rooms/${r.id}`, { isActive: !r.isActive });
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'failed');
    } finally {
      setBusy(null);
    }
  }

  async function editStake(r: Room) {
    const v = window.prompt(`stakeUsd for "${r.name}" (empty for null):`, r.stakeUsd ?? '');
    if (v === null) return;
    setBusy(r.id);
    try {
      await api.patch(`/admin/rooms/${r.id}`, { stakeUsd: v.trim() === '' ? null : v.trim() });
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'failed');
    } finally {
      setBusy(null);
    }
  }

  async function editCommission(r: Room) {
    const v = window.prompt(`commissionPct (0-50):`, String(r.commissionPct));
    if (v === null) return;
    const n = parseInt(v, 10);
    if (Number.isNaN(n)) return;
    setBusy(r.id);
    try {
      await api.patch(`/admin/rooms/${r.id}`, { commissionPct: n });
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'failed');
    } finally {
      setBusy(null);
    }
  }

  async function create() {
    const name = window.prompt('Room name:');
    if (!name) return;
    const mode = window.prompt('Mode (FREE/CASUAL/STAKE):', 'STAKE');
    if (!mode) return;
    const stakeUsd = mode === 'FREE' ? null : window.prompt('stakeUsd:', '1');
    try {
      await api.post('/admin/rooms', {
        name,
        mode,
        stakeUsd: stakeUsd && stakeUsd.trim() !== '' ? stakeUsd : null,
      });
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'failed');
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <button type="button" onClick={() => void create()} className="rounded bg-accent py-1 text-xs font-semibold text-bg">
        + new room
      </button>
      {err && <div className="text-xs text-red-400">{err}</div>}
      {items.map((r) => (
        <div key={r.id} className="rounded bg-surface px-2 py-2 text-xs">
          <div className="flex items-center justify-between">
            <div>
              <span className={!r.isActive ? 'line-through text-white/40' : ''}>{r.name}</span>
              <span className="ml-2 rounded bg-white/10 px-1 text-[10px]">{r.mode}</span>
            </div>
            <div className="font-mono text-[10px]">
              ${r.stakeUsd ?? '—'} · {r.commissionPct}% · {r.matchDurationS}s
            </div>
          </div>
          <div className="mt-2 flex gap-1">
            <button type="button" disabled={busy === r.id} onClick={() => void editStake(r)} className="flex-1 rounded bg-white/10 py-1 text-[10px]">
              stake
            </button>
            <button type="button" disabled={busy === r.id} onClick={() => void editCommission(r)} className="flex-1 rounded bg-white/10 py-1 text-[10px]">
              comm%
            </button>
            <button type="button" disabled={busy === r.id} onClick={() => void toggle(r)} className="flex-1 rounded bg-white/10 py-1 text-[10px]">
              {r.isActive ? 'disable' : 'enable'}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
