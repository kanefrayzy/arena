import { useEffect, useState } from 'react';
import { api } from '../../../shared/api/client';

interface User {
  id: number;
  email: string;
  username: string;
  role: string;
  isBanned: boolean;
  balance: string;
  locked: string;
  mmr: number;
  wins: number;
  losses: number;
}

export function UsersTab() {
  const [items, setItems] = useState<User[]>([]);
  const [search, setSearch] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  async function load() {
    setErr(null);
    try {
      const r = await api.get<{ items: User[] }>(
        `/admin/users${search ? `?search=${encodeURIComponent(search)}` : ''}`,
      );
      setItems(r.items);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'load failed');
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function ban(u: User) {
    setBusy(u.id);
    try {
      await api.post(`/admin/users/${u.id}/${u.isBanned ? 'unban' : 'ban'}`, { reason: 'admin action' });
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'failed');
    } finally {
      setBusy(null);
    }
  }

  async function adjust(u: User) {
    const raw = window.prompt(`Adjust balance for @${u.username} (USD, e.g. 10 or -5):`, '');
    if (!raw) return;
    const reason = window.prompt('Reason:', 'admin grant');
    if (!reason) return;
    setBusy(u.id);
    try {
      await api.post(`/admin/users/${u.id}/adjust-balance`, { amountUsd: raw, reason });
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'failed');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void load()}
          placeholder="search email/username"
          className="flex-1 rounded bg-white/5 px-2 py-1 text-xs"
        />
        <button type="button" onClick={() => void load()} className="rounded bg-white/10 px-2 py-1 text-xs">
          go
        </button>
      </div>
      {err && <div className="text-xs text-red-400">{err}</div>}
      <div className="flex flex-col gap-1">
        {items.map((u) => (
          <div key={u.id} className="rounded bg-surface px-2 py-2 text-xs">
            <div className="flex items-center justify-between">
              <div>
                <span className={u.isBanned ? 'text-red-400' : ''}>@{u.username}</span>
                <span className="ml-1 text-white/40">#{u.id}</span>
                {u.role !== 'PLAYER' && (
                  <span className="ml-2 rounded bg-accent/30 px-1 text-[10px]">{u.role}</span>
                )}
              </div>
              <div className="font-mono">${Number(u.balance).toFixed(2)}</div>
            </div>
            <div className="mt-1 text-[10px] text-white/50">
              {u.email} · MMR {u.mmr} · W{u.wins}/L{u.losses}
            </div>
            <div className="mt-2 flex gap-1">
              <button
                type="button"
                disabled={busy === u.id}
                onClick={() => void adjust(u)}
                className="flex-1 rounded bg-white/10 py-1 text-[10px] hover:bg-white/20 disabled:opacity-50"
              >
                ± balance
              </button>
              <button
                type="button"
                disabled={busy === u.id || u.role === 'ADMIN'}
                onClick={() => void ban(u)}
                className="flex-1 rounded bg-red-500/20 py-1 text-[10px] text-red-300 hover:bg-red-500/30 disabled:opacity-30"
              >
                {u.isBanned ? 'unban' : 'ban'}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
