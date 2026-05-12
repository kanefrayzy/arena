import { useEffect, useState } from 'react';
import { api } from '../../../shared/api/client';
import { Modal, PrimaryButton, GhostButton, Field, inputCls } from '../components/Modal';
import { Badge, statusTone } from '../components/Badge';
import { SortableTh, Pagination, type SortDir } from '../components/Table';

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
  createdAt: string;
  finishedAt: string | null;
}

const STATUSES = ['', 'PENDING', 'COMPLETED', 'FAILED', 'REJECTED'];

export function PaymentsTab() {
  const [items, setItems] = useState<Payment[]>([]);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState('PENDING');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [sortBy, setSortBy] = useState('createdAt');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [rejectOf, setRejectOf] = useState<Payment | null>(null);

  async function load() {
    setErr(null);
    try {
      const qs = new URLSearchParams({
        type: 'DEPOSIT',
        limit: String(pageSize),
        offset: String(page * pageSize),
        sortBy,
        sortDir,
      });
      if (status) qs.set('status', status);
      const r = await api.get<{ items: Payment[]; total: number }>(`/admin/payments?${qs.toString()}`);
      setItems(r.items);
      setTotal(r.total ?? 0);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'load failed');
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, page, pageSize, sortBy, sortDir]);

  function handleSort(key: string, dir: SortDir) {
    setSortBy(key);
    setSortDir(dir);
    setPage(0);
  }

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
            onClick={() => { setStatus(s); setPage(0); }}
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
              <th className="px-3 py-2.5">User</th>
              <SortableTh label="Amount" sortKey="amountUsd" activeKey={sortBy} dir={sortDir} onChange={handleSort} align="right" />
              <th className="hidden px-3 py-2.5 md:table-cell">Method</th>
              <SortableTh label="Provider" sortKey="provider" activeKey={sortBy} dir={sortDir} onChange={handleSort} className="hidden md:table-cell" />
              <SortableTh label="Status" sortKey="status" activeKey={sortBy} dir={sortDir} onChange={handleSort} />
              <SortableTh label="Created" sortKey="createdAt" activeKey={sortBy} dir={sortDir} onChange={handleSort} />
              <th className="px-3 py-2.5 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {items.map((p) => (
              <tr key={p.id} className="hover:bg-white/[0.02]">
                <td className="px-3 py-2.5">
                  <div className="font-medium text-sm">@{p.username ?? `user${p.userId}`}</div>
                  <div className="text-[10px] text-white/40">{p.email ?? `#${p.userId}`}</div>
                </td>
                <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                  <div>${Number(p.amountUsd).toFixed(2)}</div>
                  {p.amountRaw && p.currency && p.currency !== 'USD' && (
                    <div className="text-[10px] text-white/50">{Number(p.amountRaw).toFixed(2)} {p.currency}</div>
                  )}
                </td>
                <td className="hidden px-3 py-2.5 text-xs text-white/70 md:table-cell">{p.methodSlug ?? '—'}</td>
                <td className="hidden px-3 py-2.5 text-xs text-white/60 md:table-cell">{p.provider}</td>
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
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-sm text-white/40">No deposits</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Pagination
        page={page}
        pageSize={pageSize}
        total={total}
        onChange={setPage}
        onPageSizeChange={(n) => { setPageSize(n); setPage(0); }}
      />

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
