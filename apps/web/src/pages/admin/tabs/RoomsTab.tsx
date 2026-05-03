import { useEffect, useState } from 'react';
import { api } from '../../../shared/api/client';
import { Modal, PrimaryButton, GhostButton, Field, inputCls } from '../components/Modal';
import { Badge } from '../components/Badge';
import { MapEditor, type Obstacle } from '../components/MapEditor';

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
  obstacles?: Obstacle[];
}

const MODES = ['FREE', 'CASUAL', 'STAKE'];

export function RoomsTab() {
  const [items, setItems] = useState<Room[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [editing, setEditing] = useState<Room | null>(null);
  const [creating, setCreating] = useState(false);

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

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <PrimaryButton onClick={() => setCreating(true)}>+ New room</PrimaryButton>
      </div>
      {err && <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{err}</div>}

      <div className="overflow-hidden rounded-lg border border-white/10">
        <table className="w-full text-sm">
          <thead className="bg-white/5 text-left text-xs uppercase tracking-wider text-white/50">
            <tr>
              <th className="px-3 py-2.5">Name</th>
              <th className="px-3 py-2.5">Mode</th>
              <th className="px-3 py-2.5 text-right">Stake</th>
              <th className="px-3 py-2.5 text-right">Comm.</th>
              <th className="hidden px-3 py-2.5 text-right md:table-cell">Duration</th>
              <th className="px-3 py-2.5">Status</th>
              <th className="px-3 py-2.5 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {items.map((r) => (
              <tr key={r.id} className="hover:bg-white/[0.02]">
                <td className="px-3 py-2.5 font-medium">{r.name}</td>
                <td className="px-3 py-2.5">
                  <Badge tone={r.mode === 'STAKE' ? 'info' : 'neutral'}>{r.mode}</Badge>
                </td>
                <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                  {r.stakeUsd ? `$${Number(r.stakeUsd).toFixed(2)}` : '—'}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums">{r.commissionPct}%</td>
                <td className="hidden px-3 py-2.5 text-right tabular-nums md:table-cell">{r.matchDurationS}s</td>
                <td className="px-3 py-2.5">
                  {r.isActive ? <Badge tone="success">active</Badge> : <Badge tone="neutral">disabled</Badge>}
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex justify-end gap-1">
                    <button
                      type="button"
                      disabled={busy === r.id}
                      onClick={() => setEditing(r)}
                      className="rounded-md bg-white/5 px-2.5 py-1 text-xs hover:bg-white/10 disabled:opacity-40"
                    >
                      edit
                    </button>
                    <button
                      type="button"
                      disabled={busy === r.id}
                      onClick={() => void toggle(r)}
                      className="rounded-md bg-white/5 px-2.5 py-1 text-xs hover:bg-white/10 disabled:opacity-40"
                    >
                      {r.isActive ? 'disable' : 'enable'}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-sm text-white/40">No rooms</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <RoomFormModal
        room={editing}
        open={!!editing || creating}
        creating={creating}
        onClose={() => {
          setEditing(null);
          setCreating(false);
        }}
        onDone={async () => {
          setEditing(null);
          setCreating(false);
          await load();
        }}
        setErr={setErr}
      />
    </div>
  );
}

function RoomFormModal({
  room,
  open,
  creating,
  onClose,
  onDone,
  setErr,
}: {
  room: Room | null;
  open: boolean;
  creating: boolean;
  onClose: () => void;
  onDone: () => Promise<void>;
  setErr: (s: string | null) => void;
}) {
  const [name, setName] = useState('');
  const [mode, setMode] = useState('STAKE');
  const [stakeUsd, setStakeUsd] = useState('');
  const [commissionPct, setCommissionPct] = useState('15');
  const [matchDurationS, setMatchDurationS] = useState('180');
  const [obstacles, setObstacles] = useState<Obstacle[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (room) {
      setName(room.name);
      setMode(room.mode);
      setStakeUsd(room.stakeUsd ?? '');
      setCommissionPct(String(room.commissionPct));
      setMatchDurationS(String(room.matchDurationS));
      setObstacles(room.obstacles ?? []);
    } else if (creating) {
      setName('');
      setMode('STAKE');
      setStakeUsd('1');
      setCommissionPct('15');
      setMatchDurationS('180');
      setObstacles([]);
    }
  }, [room, creating]);

  async function submit() {
    setSubmitting(true);
    try {
      const stake = stakeUsd.trim() === '' || mode === 'FREE' ? null : stakeUsd.trim();
      const payload: Record<string, unknown> = {
        name,
        mode,
        stakeUsd: stake,
        commissionPct: parseInt(commissionPct, 10),
        matchDurationS: parseInt(matchDurationS, 10),
        obstacles,
      };
      if (room) {
        await api.patch(`/admin/rooms/${room.id}`, payload);
      } else {
        await api.post('/admin/rooms', payload);
      }
      await onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={room ? `Edit room · ${room.name}` : 'New room'}
      width="max-w-3xl"
      footer={
        <>
          <GhostButton onClick={onClose}>Cancel</GhostButton>
          <PrimaryButton onClick={submit} disabled={submitting || !name.trim()}>
            {submitting ? 'saving…' : 'Save'}
          </PrimaryButton>
        </>
      }
    >
      <div className="grid gap-4 md:grid-cols-[1fr_300px]">
        <div className="space-y-3">
          <Field label="Name">
            <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </Field>
          <Field label="Mode">
            <select className={inputCls} value={mode} onChange={(e) => setMode(e.target.value)}>
              {MODES.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </Field>
          {mode !== 'FREE' && (
            <Field label="Stake (USD)">
              <input className={inputCls} value={stakeUsd} onChange={(e) => setStakeUsd(e.target.value)} placeholder="1.00" />
            </Field>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Commission %">
              <input className={inputCls} value={commissionPct} onChange={(e) => setCommissionPct(e.target.value)} type="number" min={0} max={50} />
            </Field>
            <Field label="Duration (s)">
              <input className={inputCls} value={matchDurationS} onChange={(e) => setMatchDurationS(e.target.value)} type="number" min={30} />
            </Field>
          </div>
        </div>
        <div className="md:w-full">
          <div className="mb-1 text-xs font-medium uppercase tracking-wider text-white/50">Карта</div>
          <MapEditor value={obstacles} onChange={setObstacles} />
        </div>
      </div>
    </Modal>
  );
}
