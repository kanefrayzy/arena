import { useEffect, useState } from 'react';
import { api } from '../../../shared/api/client';
import { Modal, PrimaryButton, GhostButton, Field, inputCls } from '../components/Modal';
import { Badge, statusTone } from '../components/Badge';

interface Payment {
  id: string;
  userId: number;
  username: string | null;
  email: string | null;
  type: string;
  status: string;
  amountUsd: string;
  amountRaw: string | null;
  currency: string | null;
  provider: string;
  methodSlug: string | null;
  externalId: string | null;
  meta: Record<string, unknown> | null;
  createdAt: string;
  finishedAt: string | null;
}

interface UserDetail {
  id: number; email: string; username: string; role: string;
  isBanned: boolean; balance: string; locked: string;
  mmr: number; cup: number; wins: number; losses: number;
}

const STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'COMPLETED', 'FAILED', ''];

export function WithdrawalsTab() {
  const [items, setItems] = useState<Payment[]>([]);
  const [status, setStatus] = useState('PENDING');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [rejectOf, setRejectOf] = useState<Payment | null>(null);
  const [viewUserOf, setViewUserOf] = useState<Payment | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  async function load() {
    setErr(null);
    try {
      const qs = new URLSearchParams({ type: 'WITHDRAWAL' });
      if (status) qs.set('status', status);
      const r = await api.get<{ items: Payment[] }>(`/admin/payments?${qs.toString()}`);
      setItems(r.items);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'load failed');
    }
  }

  useEffect(() => { void load(); }, [status]);

  async function approve(p: Payment) {
    if (!confirm(`Одобрить вывод $${p.amountUsd} для @${p.username ?? p.userId}?\n\nДеньги будут списаны окончательно.`)) return;
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

  async function copy(s: string) {
    try { await navigator.clipboard.writeText(s); setCopied(s); setTimeout(() => setCopied(null), 1200); } catch { /* noop */ }
  }

  function destinationOf(p: Payment): { kind: string; value: string } | null {
    const m = p.meta as Record<string, unknown> | null;
    if (!m) return null;
    if (typeof m.card === 'string' && m.card) return { kind: 'card', value: m.card };
    if (typeof m.address === 'string' && m.address) return { kind: 'address', value: m.address };
    return null;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-1.5">
        {STATUSES.map((s) => (
          <button
            key={s || 'all'}
            type="button"
            onClick={() => setStatus(s)}
            className={
              'rounded-md px-3 py-1.5 text-xs font-medium transition ' +
              (status === s ? 'bg-accent text-bg' : 'bg-white/5 text-white/70 hover:bg-white/10')
            }
          >
            {s || 'All'}
          </button>
        ))}
        <div className="ml-auto text-xs text-white/40 self-center">
          {items.length} item{items.length === 1 ? '' : 's'}
        </div>
      </div>
      {err && <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{err}</div>}

      <div className="overflow-hidden rounded-lg border border-white/10">
        <table className="w-full text-sm">
          <thead className="bg-white/5 text-left text-xs uppercase tracking-wider text-white/50">
            <tr>
              <th className="px-3 py-2.5">User</th>
              <th className="px-3 py-2.5 text-right">Amount</th>
              <th className="px-3 py-2.5">Method</th>
              <th className="px-3 py-2.5">Destination</th>
              <th className="px-3 py-2.5">Status</th>
              <th className="px-3 py-2.5">Created</th>
              <th className="px-3 py-2.5 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {items.map((p) => {
              const dest = destinationOf(p);
              return (
                <tr key={p.id} className="hover:bg-white/[0.02] align-top">
                  <td className="px-3 py-2.5">
                    <button
                      type="button"
                      onClick={() => setViewUserOf(p)}
                      className="text-left hover:underline"
                    >
                      <div className="font-medium">@{p.username ?? `user${p.userId}`}</div>
                      <div className="text-[10px] text-white/40">{p.email ?? `#${p.userId}`}</div>
                    </button>
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                    <div className="font-semibold">${Number(p.amountUsd).toFixed(2)}</div>
                    {p.amountRaw && p.currency && p.currency !== 'USD' && (
                      <div className="text-[10px] text-white/50">
                        {Number(p.amountRaw).toFixed(p.currency === 'BTC' || p.currency === 'ETH' ? 8 : 2)} {p.currency}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-white/70">
                    <div>{p.methodSlug ?? p.provider}</div>
                    <div className="text-[10px] text-white/40">{p.provider}</div>
                  </td>
                  <td className="px-3 py-2.5 text-xs">
                    {dest ? (
                      <button
                        type="button"
                        onClick={() => void copy(dest.value)}
                        className="group inline-flex items-center gap-1.5 rounded-md bg-white/5 px-2 py-1 font-mono text-[11px] text-white/90 hover:bg-white/10"
                        title="click to copy"
                      >
                        <span className="break-all max-w-[220px] truncate">{dest.value}</span>
                        <span className="text-[9px] text-white/40 group-hover:text-white/70">
                          {copied === dest.value ? '✓' : 'copy'}
                        </span>
                      </button>
                    ) : (
                      <span className="text-white/30">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    <Badge tone={statusTone(p.status)}>{p.status}</Badge>
                  </td>
                  <td className="px-3 py-2.5 text-xs text-white/60 whitespace-nowrap">
                    {new Date(p.createdAt).toLocaleString()}
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex justify-end gap-1">
                      {p.status === 'PENDING' && (
                        <>
                          <button
                            type="button"
                            disabled={busy === p.id}
                            onClick={() => void approve(p)}
                            className="rounded-md bg-green-500/15 px-2.5 py-1 text-xs text-green-300 hover:bg-green-500/25 disabled:opacity-40"
                          >
                            approve
                          </button>
                          <button
                            type="button"
                            disabled={busy === p.id}
                            onClick={() => setRejectOf(p)}
                            className="rounded-md bg-red-500/15 px-2.5 py-1 text-xs text-red-300 hover:bg-red-500/25 disabled:opacity-40"
                          >
                            reject
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {items.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-sm text-white/40">
                  Нет заявок на вывод
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <RejectModal
        payment={rejectOf}
        onClose={() => setRejectOf(null)}
        onDone={async () => { setRejectOf(null); await load(); }}
        setBusy={setBusy}
        setErr={setErr}
      />
      <UserDetailModal
        payment={viewUserOf}
        onClose={() => setViewUserOf(null)}
        setErr={setErr}
      />
    </div>
  );
}

function RejectModal({
  payment, onClose, onDone, setBusy, setErr,
}: {
  payment: Payment | null;
  onClose: () => void;
  onDone: () => Promise<void>;
  setBusy: (s: string | null) => void;
  setErr: (s: string | null) => void;
}) {
  const [reason, setReason] = useState('Документы не прошли проверку');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (payment) setReason('Документы не прошли проверку');
  }, [payment]);

  async function submit() {
    if (!payment) return;
    setSubmitting(true);
    setBusy(payment.id);
    try {
      await api.post(`/admin/payments/${payment.id}/reject`, { reason });
      await onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'failed');
    } finally {
      setSubmitting(false);
      setBusy(null);
    }
  }

  if (!payment) return null;
  return (
    <Modal
      open
      onClose={onClose}
      title={`Отклонить вывод $${payment.amountUsd}`}
      footer={
        <>
          <GhostButton onClick={onClose}>Отмена</GhostButton>
          <PrimaryButton onClick={submit} disabled={submitting}>
            {submitting ? '…' : 'Отклонить и вернуть деньги'}
          </PrimaryButton>
        </>
      }
    >
      <div className="mb-3 text-xs text-white/60">
        Деньги вернутся на баланс пользователя <b>@{payment.username ?? payment.userId}</b>.
      </div>
      <Field label="Причина">
        <input className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
      </Field>
    </Modal>
  );
}

function UserDetailModal({
  payment, onClose, setErr,
}: {
  payment: Payment | null;
  onClose: () => void;
  setErr: (s: string | null) => void;
}) {
  const [u, setU] = useState<UserDetail | null>(null);
  const [recent, setRecent] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!payment) { setU(null); setRecent([]); return; }
    setLoading(true);
    void (async () => {
      try {
        // Search by username (most precise lookup we have for users list).
        const r = await api.get<{ items: UserDetail[] }>(
          `/admin/users?search=${encodeURIComponent(payment.username ?? String(payment.userId))}`,
        );
        setU(r.items.find((x) => x.id === payment.userId) ?? null);
        // Recent payments for this user across all types.
        const rp = await api.get<{ items: Payment[] }>(
          `/admin/payments?limit=20`,
        );
        setRecent(rp.items.filter((x) => x.userId === payment.userId).slice(0, 10));
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'load failed');
      } finally {
        setLoading(false);
      }
    })();
  }, [payment, setErr]);

  if (!payment) return null;
  return (
    <Modal
      open
      onClose={onClose}
      title={`Пользователь @${payment.username ?? payment.userId}`}
      footer={<GhostButton onClick={onClose}>Закрыть</GhostButton>}
    >
      {loading && <div className="py-6 text-center text-sm text-white/40">Загрузка…</div>}
      {!loading && u && (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="rounded-md bg-white/5 px-3 py-2">
              <div className="text-[10px] uppercase text-white/40">ID</div>
              <div className="font-mono">#{u.id}</div>
            </div>
            <div className="rounded-md bg-white/5 px-3 py-2">
              <div className="text-[10px] uppercase text-white/40">Роль</div>
              <div>{u.role}</div>
            </div>
            <div className="rounded-md bg-white/5 px-3 py-2">
              <div className="text-[10px] uppercase text-white/40">Баланс</div>
              <div className="font-mono">${Number(u.balance).toFixed(2)}</div>
              {Number(u.locked) > 0 && (
                <div className="text-[10px] text-white/40">+${Number(u.locked).toFixed(2)} locked</div>
              )}
            </div>
            <div className="rounded-md bg-white/5 px-3 py-2">
              <div className="text-[10px] uppercase text-white/40">Статус</div>
              <div>{u.isBanned ? <span className="text-red-300">banned</span> : <span className="text-green-300">active</span>}</div>
            </div>
            <div className="rounded-md bg-white/5 px-3 py-2">
              <div className="text-[10px] uppercase text-white/40">MMR / Cup</div>
              <div className="font-mono">{u.mmr} / 🏆 {u.cup}</div>
            </div>
            <div className="rounded-md bg-white/5 px-3 py-2">
              <div className="text-[10px] uppercase text-white/40">W / L</div>
              <div className="font-mono"><span className="text-green-300">{u.wins}</span> / <span className="text-red-300">{u.losses}</span></div>
            </div>
          </div>
          <div className="rounded-md bg-white/5 px-3 py-2 text-sm">
            <div className="text-[10px] uppercase text-white/40">Email</div>
            <div className="break-all">{u.email}</div>
          </div>
          {recent.length > 0 && (
            <div>
              <div className="mb-1 text-[10px] uppercase text-white/40">Последние операции</div>
              <ul className="divide-y divide-white/5 rounded-md border border-white/10">
                {recent.map((p) => (
                  <li key={p.id} className="flex items-center justify-between px-3 py-1.5 text-xs">
                    <span>
                      <span className="text-white/50">{p.type}</span>
                      <span className="ml-2 text-white/30">{p.provider}</span>
                    </span>
                    <span className="font-mono tabular-nums">
                      {p.type === 'WITHDRAWAL' ? '-' : '+'}${Number(p.amountUsd).toFixed(2)}{' '}
                      <Badge tone={statusTone(p.status)}>{p.status}</Badge>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      {!loading && !u && (
        <div className="py-6 text-center text-sm text-white/40">Пользователь не найден</div>
      )}
    </Modal>
  );
}
