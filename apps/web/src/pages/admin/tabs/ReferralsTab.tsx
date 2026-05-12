import { useEffect, useState } from 'react';
import { api } from '../../../shared/api/client';
import { Modal, PrimaryButton, GhostButton, Field, inputCls } from '../components/Modal';
import { Badge } from '../components/Badge';

interface Referral {
  id: number;
  code: string;
  name: string;
  notes: string | null;
  isActive: boolean;
  clicks: number;
  signups: number;
  depositsTotalUsd: string;
  createdAt: string;
}

const money = (v: string | number) => {
  const n = typeof v === 'string' ? parseFloat(v) : v;
  if (!Number.isFinite(n)) return '$0.00';
  return `$${n.toFixed(2)}`;
};

export function ReferralsTab() {
  const [items, setItems] = useState<Referral[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [copied, setCopied] = useState<number | null>(null);

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const r = await api.get<{ items: Referral[] }>('/admin/referrals');
      setItems(r.items);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'load failed');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function buildLink(code: string): string {
    return `${window.location.origin}/r/${code}`;
  }

  async function copyLink(r: Referral) {
    try {
      await navigator.clipboard.writeText(buildLink(r.code));
      setCopied(r.id);
      setTimeout(() => setCopied((v) => (v === r.id ? null : v)), 1500);
    } catch {
      // ignore
    }
  }

  async function toggleActive(r: Referral) {
    try {
      await api.patch(`/admin/referrals/${r.id}`, { isActive: !r.isActive });
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'update failed');
    }
  }

  async function remove(r: Referral) {
    if (!confirm(`Удалить ссылку «${r.code}»? Привязки пользователей сохранятся, но статистика будет потеряна.`)) return;
    try {
      await api.delete(`/admin/referrals/${r.id}`);
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'delete failed');
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Реферальные ссылки</h2>
          <p className="text-xs text-white/40">
            Создавайте уникальные ссылки для рекламных кампаний и отслеживайте клики, регистрации и депозиты.
          </p>
        </div>
        <PrimaryButton onClick={() => setShowCreate(true)}>+ Создать</PrimaryButton>
      </div>

      {err && (
        <div className="rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{err}</div>
      )}

      <div className="overflow-hidden rounded-md border border-white/10">
        <table className="w-full text-sm">
          <thead className="bg-white/5 text-left text-[11px] uppercase tracking-wider text-white/50">
            <tr>
              <th className="px-3 py-2">Код / Название</th>
              <th className="px-3 py-2">Ссылка</th>
              <th className="px-3 py-2 text-right">Клики</th>
              <th className="px-3 py-2 text-right">Регистрации</th>
              <th className="px-3 py-2 text-right">Депозиты</th>
              <th className="px-3 py-2">Статус</th>
              <th className="px-3 py-2 text-right">Действия</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {loading && items.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-white/40">
                  Загрузка…
                </td>
              </tr>
            )}
            {!loading && items.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-white/40">
                  Пока нет ссылок. Создайте первую.
                </td>
              </tr>
            )}
            {items.map((r) => {
              const conv = r.clicks > 0 ? ((r.signups / r.clicks) * 100).toFixed(1) : '0.0';
              return (
                <tr key={r.id} className="hover:bg-white/[0.02]">
                  <td className="px-3 py-2">
                    <div className="font-mono text-sm font-semibold text-emerald-300">{r.code}</div>
                    <div className="text-xs text-white/60">{r.name}</div>
                    {r.notes && <div className="mt-0.5 text-[10px] text-white/30">{r.notes}</div>}
                  </td>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() => copyLink(r)}
                      className="font-mono text-xs text-white/60 hover:text-white"
                      title="Скопировать"
                    >
                      {buildLink(r.code)}
                    </button>
                    {copied === r.id && <div className="text-[10px] text-emerald-400">Скопировано</div>}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{r.clicks}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">
                    {r.signups}
                    <div className="text-[10px] text-white/40">{conv}%</div>
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{money(r.depositsTotalUsd)}</td>
                  <td className="px-3 py-2">
                    <button type="button" onClick={() => toggleActive(r)} className="cursor-pointer">
                      {r.isActive ? <Badge tone="success">активна</Badge> : <Badge tone="neutral">выключена</Badge>}
                    </button>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => remove(r)}
                      className="rounded border border-rose-500/30 px-2 py-1 text-xs text-rose-300 hover:bg-rose-500/10"
                    >
                      Удалить
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <CreateModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={() => {
          setShowCreate(false);
          void load();
        }}
      />
    </div>
  );
}

function CreateModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setCode('');
      setName('');
      setNotes('');
      setErr(null);
    }
  }, [open]);

  async function submit() {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      await api.post('/admin/referrals', {
        code: code.trim(),
        name: name.trim(),
        notes: notes.trim() || null,
      });
      onCreated();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'create failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Новая реферальная ссылка"
      footer={
        <>
          <GhostButton onClick={onClose} disabled={busy}>
            Отмена
          </GhostButton>
          <PrimaryButton onClick={submit} disabled={busy || !code || !name}>
            {busy ? 'Создание…' : 'Создать'}
          </PrimaryButton>
        </>
      }
    >
      <div className="space-y-3">
        {err && (
          <div className="rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{err}</div>
        )}
        <Field label="Код" hint="Латиница / цифры / _ -. Будет в URL: /r/КОД">
          <input
            className={inputCls}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="promo1"
            maxLength={40}
          />
        </Field>
        <Field label="Название кампании">
          <input
            className={inputCls}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Telegram реклама — ноябрь"
            maxLength={100}
          />
        </Field>
        <Field label="Заметки (необязательно)">
          <textarea
            className={inputCls}
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Канал, бюджет, цель…"
            maxLength={500}
          />
        </Field>
      </div>
    </Modal>
  );
}
