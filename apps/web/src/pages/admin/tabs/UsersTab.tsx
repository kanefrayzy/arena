import { useEffect, useState } from 'react';
import { api } from '../../../shared/api/client';
import { Modal, PrimaryButton, GhostButton, Field, inputCls } from '../components/Modal';
import { Badge } from '../components/Badge';

interface User {
  id: number;
  email: string;
  username: string;
  role: string;
  isBanned: boolean;
  balance: string;
  locked: string;
  mmr: number;
  cup: number;
  wins: number;
  losses: number;
}

export function UsersTab() {
  const [items, setItems] = useState<User[]>([]);
  const [search, setSearch] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [adjustOf, setAdjustOf] = useState<User | null>(null);
  const [banOf, setBanOf] = useState<User | null>(null);

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

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void load()}
            placeholder="Search by email or username…"
            className={inputCls + ' pl-9'}
          />
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" width="14" height="14" viewBox="0 0 14 14" fill="none">
            <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.5" />
            <path d="M9.5 9.5L13 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </div>
        <GhostButton onClick={() => void load()}>Search</GhostButton>
      </div>
      {err && <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{err}</div>}

      <div className="overflow-hidden rounded-lg border border-white/10">
        <table className="w-full text-sm">
          <thead className="bg-white/5 text-left text-xs uppercase tracking-wider text-white/50">
            <tr>
              <th className="px-3 py-2.5">User</th>
              <th className="px-3 py-2.5">Role</th>
              <th className="px-3 py-2.5 text-right">Balance</th>
              <th className="hidden px-3 py-2.5 text-right md:table-cell">MMR</th>
              <th className="hidden px-3 py-2.5 text-right md:table-cell">🏆 Cup</th>
              <th className="hidden px-3 py-2.5 text-right md:table-cell">W/L</th>
              <th className="px-3 py-2.5">Status</th>
              <th className="px-3 py-2.5 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {items.map((u) => (
              <tr key={u.id} className="hover:bg-white/[0.02]">
                <td className="px-3 py-2.5">
                  <div className="font-medium">@{u.username}</div>
                  <div className="text-xs text-white/40">{u.email} · #{u.id}</div>
                </td>
                <td className="px-3 py-2.5">
                  {u.role === 'ADMIN' ? <Badge tone="info">ADMIN</Badge> : <span className="text-xs text-white/50">{u.role}</span>}
                </td>
                <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                  ${Number(u.balance).toFixed(2)}
                  {Number(u.locked) > 0 && (
                    <div className="text-[10px] text-white/40">+${Number(u.locked).toFixed(2)} locked</div>
                  )}
                </td>
                <td className="hidden px-3 py-2.5 text-right tabular-nums md:table-cell">{u.mmr}</td>
                <td className="hidden px-3 py-2.5 text-right tabular-nums md:table-cell">{u.cup}</td>
                <td className="hidden px-3 py-2.5 text-right md:table-cell">
                  <span className="text-green-300">{u.wins}</span>
                  <span className="text-white/30">/</span>
                  <span className="text-red-300">{u.losses}</span>
                </td>
                <td className="px-3 py-2.5">
                  {u.isBanned ? <Badge tone="danger">banned</Badge> : <Badge tone="success">active</Badge>}
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex justify-end gap-1">
                    <button
                      type="button"
                      disabled={busy === u.id}
                      onClick={() => setAdjustOf(u)}
                      className="rounded-md bg-white/5 px-2.5 py-1 text-xs hover:bg-white/10 disabled:opacity-40"
                    >
                      ± balance
                    </button>
                    <button
                      type="button"
                      disabled={busy === u.id || u.role === 'ADMIN'}
                      onClick={() => setBanOf(u)}
                      className={`rounded-md px-2.5 py-1 text-xs disabled:opacity-30 ${
                        u.isBanned ? 'bg-green-500/15 text-green-300 hover:bg-green-500/25' : 'bg-red-500/15 text-red-300 hover:bg-red-500/25'
                      }`}
                    >
                      {u.isBanned ? 'unban' : 'ban'}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-sm text-white/40">
                  No users found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <AdjustModal
        user={adjustOf}
        onClose={() => setAdjustOf(null)}
        onDone={async () => {
          setAdjustOf(null);
          await load();
        }}
        setBusy={setBusy}
        setErr={setErr}
      />
      <BanModal
        user={banOf}
        onClose={() => setBanOf(null)}
        onDone={async () => {
          setBanOf(null);
          await load();
        }}
        setBusy={setBusy}
        setErr={setErr}
      />
    </div>
  );
}

function AdjustModal({
  user,
  onClose,
  onDone,
  setBusy,
  setErr,
}: {
  user: User | null;
  onClose: () => void;
  onDone: () => Promise<void>;
  setBusy: (n: number | null) => void;
  setErr: (s: string | null) => void;
}) {
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('admin grant');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (user) {
      setAmount('');
      setReason('admin grant');
    }
  }, [user]);

  async function submit() {
    if (!user || !amount.trim()) return;
    setSubmitting(true);
    setBusy(user.id);
    try {
      await api.post(`/admin/users/${user.id}/adjust-balance`, { amountUsd: amount.trim(), reason });
      await onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'failed');
    } finally {
      setSubmitting(false);
      setBusy(null);
    }
  }

  return (
    <Modal
      open={!!user}
      onClose={onClose}
      title={user ? `Adjust balance · @${user.username}` : ''}
      footer={
        <>
          <GhostButton onClick={onClose}>Cancel</GhostButton>
          <PrimaryButton onClick={submit} disabled={submitting || !amount.trim()}>
            {submitting ? 'applying…' : 'Apply'}
          </PrimaryButton>
        </>
      }
    >
      <Field label="Amount (USD)" hint="Positive credits user, negative debits. e.g. 10 or -5">
        <input className={inputCls} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" autoFocus />
      </Field>
      <Field label="Reason">
        <input className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      {user && (
        <div className="rounded-md bg-white/5 px-3 py-2 text-xs text-white/60">
          Current balance: <span className="font-mono text-white">${Number(user.balance).toFixed(2)}</span>
        </div>
      )}
    </Modal>
  );
}

function BanModal({
  user,
  onClose,
  onDone,
  setBusy,
  setErr,
}: {
  user: User | null;
  onClose: () => void;
  onDone: () => Promise<void>;
  setBusy: (n: number | null) => void;
  setErr: (s: string | null) => void;
}) {
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (user) setReason(user.isBanned ? 'reviewed' : '');
  }, [user]);

  async function submit() {
    if (!user) return;
    setSubmitting(true);
    setBusy(user.id);
    try {
      await api.post(`/admin/users/${user.id}/${user.isBanned ? 'unban' : 'ban'}`, {
        reason: reason || 'admin action',
      });
      await onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'failed');
    } finally {
      setSubmitting(false);
      setBusy(null);
    }
  }

  if (!user) return null;
  return (
    <Modal
      open
      onClose={onClose}
      title={`${user.isBanned ? 'Unban' : 'Ban'} · @${user.username}`}
      footer={
        <>
          <GhostButton onClick={onClose}>Cancel</GhostButton>
          <PrimaryButton onClick={submit} disabled={submitting}>
            {submitting ? '…' : user.isBanned ? 'Unban' : 'Ban'}
          </PrimaryButton>
        </>
      }
    >
      <Field label="Reason">
        <input className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="cheating / chargeback / …" autoFocus />
      </Field>
    </Modal>
  );
}
