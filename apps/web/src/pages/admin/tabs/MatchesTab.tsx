import { useEffect, useState } from 'react';
import { api } from '../../../shared/api/client';
import { Modal, PrimaryButton, GhostButton, Field, inputCls } from '../components/Modal';
import { Badge, statusTone } from '../components/Badge';

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
  const [forceFinishOf, setForceFinishOf] = useState<Match | null>(null);
  const [refundOf, setRefundOf] = useState<Match | null>(null);

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
              <th className="px-3 py-2.5">Match</th>
              <th className="px-3 py-2.5">Players</th>
              <th className="px-3 py-2.5 text-right">Stake</th>
              <th className="px-3 py-2.5">Status</th>
              <th className="px-3 py-2.5">Winner</th>
              <th className="px-3 py-2.5 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {items.map((m) => (
              <tr key={m.id} className="hover:bg-white/[0.02]">
                <td className="px-3 py-2.5 font-mono text-xs text-white/60">{m.id.slice(0, 8)}…</td>
                <td className="px-3 py-2.5 text-xs">
                  <span className="font-medium">#{m.player1Id}</span>
                  <span className="mx-1.5 text-white/40">vs</span>
                  <span className="font-medium">#{m.player2Id}</span>
                </td>
                <td className="px-3 py-2.5 text-right font-mono tabular-nums">${m.stakeUsd}</td>
                <td className="px-3 py-2.5">
                  <Badge tone={statusTone(m.status)}>{m.status}</Badge>
                </td>
                <td className="px-3 py-2.5 text-xs">
                  {m.winnerId != null ? <span>#{m.winnerId}</span> : <span className="text-white/30">—</span>}
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex justify-end gap-1">
                    {(m.status === 'RUNNING' || m.status === 'DISPUTED' || m.status === 'PENDING') && (
                      <>
                        <button
                          type="button"
                          disabled={busy === m.id}
                          onClick={() => setForceFinishOf(m)}
                          className="rounded-md bg-white/5 px-2.5 py-1 text-xs hover:bg-white/10 disabled:opacity-40"
                        >
                          force-finish
                        </button>
                        <button
                          type="button"
                          disabled={busy === m.id}
                          onClick={() => setRefundOf(m)}
                          className="rounded-md bg-yellow-500/15 px-2.5 py-1 text-xs text-yellow-300 hover:bg-yellow-500/25 disabled:opacity-40"
                        >
                          refund
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-sm text-white/40">No matches</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <ForceFinishModal
        match={forceFinishOf}
        onClose={() => setForceFinishOf(null)}
        onDone={async () => {
          setForceFinishOf(null);
          await load();
        }}
        setBusy={setBusy}
        setErr={setErr}
      />
      <RefundModal
        match={refundOf}
        onClose={() => setRefundOf(null)}
        onDone={async () => {
          setRefundOf(null);
          await load();
        }}
        setBusy={setBusy}
        setErr={setErr}
      />
    </div>
  );
}

function ForceFinishModal({
  match,
  onClose,
  onDone,
  setBusy,
  setErr,
}: {
  match: Match | null;
  onClose: () => void;
  onDone: () => Promise<void>;
  setBusy: (s: string | null) => void;
  setErr: (s: string | null) => void;
}) {
  const [winnerId, setWinnerId] = useState<number | null>(null);
  const [reason, setReason] = useState('admin force-finish');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (match) {
      setWinnerId(match.player1Id);
      setReason('admin force-finish');
    }
  }, [match]);

  async function submit() {
    if (!match) return;
    setSubmitting(true);
    setBusy(match.id);
    try {
      await api.post(`/admin/matches/${match.id}/force-finish`, { winnerId, reason });
      await onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'failed');
    } finally {
      setSubmitting(false);
      setBusy(null);
    }
  }

  if (!match) return null;
  return (
    <Modal
      open
      onClose={onClose}
      title="Force-finish match"
      footer={
        <>
          <GhostButton onClick={onClose}>Cancel</GhostButton>
          <PrimaryButton onClick={submit} disabled={submitting}>
            {submitting ? '…' : 'Confirm'}
          </PrimaryButton>
        </>
      }
    >
      <Field label="Winner">
        <div className="flex flex-col gap-2">
          {[match.player1Id, match.player2Id].map((id) => (
            <label key={id} className="flex cursor-pointer items-center gap-2 rounded-md border border-white/10 bg-bg px-3 py-2 hover:border-white/20">
              <input
                type="radio"
                name="winner"
                checked={winnerId === id}
                onChange={() => setWinnerId(id)}
                className="accent-accent"
              />
              <span className="text-sm">Player #{id}</span>
            </label>
          ))}
          <label className="flex cursor-pointer items-center gap-2 rounded-md border border-white/10 bg-bg px-3 py-2 hover:border-white/20">
            <input
              type="radio"
              name="winner"
              checked={winnerId === null}
              onChange={() => setWinnerId(null)}
              className="accent-accent"
            />
            <span className="text-sm">No winner (refund both)</span>
          </label>
        </div>
      </Field>
      <Field label="Reason">
        <input className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
    </Modal>
  );
}

function RefundModal({
  match,
  onClose,
  onDone,
  setBusy,
  setErr,
}: {
  match: Match | null;
  onClose: () => void;
  onDone: () => Promise<void>;
  setBusy: (s: string | null) => void;
  setErr: (s: string | null) => void;
}) {
  const [reason, setReason] = useState('admin refund');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (match) setReason('admin refund');
  }, [match]);

  async function submit() {
    if (!match) return;
    setSubmitting(true);
    setBusy(match.id);
    try {
      await api.post(`/admin/matches/${match.id}/refund`, { reason });
      await onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'failed');
    } finally {
      setSubmitting(false);
      setBusy(null);
    }
  }

  if (!match) return null;
  return (
    <Modal
      open
      onClose={onClose}
      title="Refund match"
      footer={
        <>
          <GhostButton onClick={onClose}>Cancel</GhostButton>
          <PrimaryButton onClick={submit} disabled={submitting}>
            {submitting ? '…' : 'Refund both'}
          </PrimaryButton>
        </>
      }
    >
      <p className="mb-3 text-sm text-white/70">
        Both players will receive their ${match.stakeUsd} stake back.
      </p>
      <Field label="Reason">
        <input className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
      </Field>
    </Modal>
  );
}
