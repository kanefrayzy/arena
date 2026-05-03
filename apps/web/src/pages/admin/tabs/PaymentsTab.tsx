import { useEffect, useState } from 'react';
import { api } from '../../../shared/api/client';
import { Modal, PrimaryButton, GhostButton, Field, inputCls } from '../components/Modal';
import { Badge, statusTone } from '../components/Badge';

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
  const [rejectOf, setRejectOf] = useState<Payment | null>(null);

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

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-1.5">
        {STATUSES.map((s) => (
          <button
            key={s}
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
      </div>
      {err && <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{err}</div>}

      <div className="overflow-hidden rounded-lg border border-white/10">
        <table className="w-full text-sm">
          <thead className="bg-white/5 text-left text-xs uppercase tracking-wider text-white/50">
            <tr>
              <th className="px-3 py-2.5">ID</th>
              <th className="px-3 py-2.5">User</th>
              <th className="px-3 py-2.5">Type</th>
              <th className="px-3 py-2.5 text-right">Amount</th>
              <th className="hidden px-3 py-2.5 md:table-cell">Provider</th>
              <th className="px-3 py-2.5">Status</th>
              <th className="px-3 py-2.5 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {items.map((p) => (
              <tr key={p.id} className="hover:bg-white/[0.02]">
                <td className="px-3 py-2.5 font-mono text-xs text-white/60">{p.id.slice(0, 8)}…</td>
                <td className="px-3 py-2.5 text-xs">#{p.userId}</td>
                <td className="px-3 py-2.5 text-xs">{p.type}</td>
                <td className="px-3 py-2.5 text-right font-mono tabular-nums">${p.amountUsd}</td>
                <td className="hidden px-3 py-2.5 text-xs text-white/60 md:table-cell">{p.provider}</td>
                <td className="px-3 py-2.5">
                  <Badge tone={statusTone(p.status)}>{p.status}</Badge>
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
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-sm text-white/40">No payments</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <RejectModal
        payment={rejectOf}
        onClose={() => setRejectOf(null)}
        onDone={async () => {
          setRejectOf(null);
          await load();
        }}
        setBusy={setBusy}
        setErr={setErr}
      />
    </div>
  );
}

function RejectModal({
  payment,
  onClose,
  onDone,
  setBusy,
  setErr,
}: {
  payment: Payment | null;
  onClose: () => void;
  onDone: () => Promise<void>;
  setBusy: (s: string | null) => void;
  setErr: (s: string | null) => void;
}) {
  const [reason, setReason] = useState('KYC failed');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (payment) setReason('KYC failed');
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
      title="Reject payment"
      footer={
        <>
          <GhostButton onClick={onClose}>Cancel</GhostButton>
          <PrimaryButton onClick={submit} disabled={submitting}>
            {submitting ? '…' : 'Reject'}
          </PrimaryButton>
        </>
      }
    >
      <Field label="Reason">
        <input className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
      </Field>
    </Modal>
  );
}
