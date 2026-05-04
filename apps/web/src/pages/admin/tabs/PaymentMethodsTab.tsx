import { useEffect, useRef, useState } from 'react';
import { api } from '../../../shared/api/client';

interface Method {
  id: number;
  slug: string;
  label: string;
  kind: 'betra_card' | 'betra_payout' | 'westwallet';
  currency: string;
  iconUrl: string | null;
  minAmount: string | null;
  maxAmount: string | null;
  usdRate: string | null;
  isDeposit: boolean;
  isWithdraw: boolean;
  isActive: boolean;
  sortOrder: number;
}

const KINDS: Method['kind'][] = ['betra_card', 'betra_payout', 'westwallet'];

export function PaymentMethodsTab() {
  const [items, setItems] = useState<Method[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);

  const reload = async () => {
    setErr(null);
    try {
      const r = await api.get<{ items: Method[] }>('/admin/payment-methods');
      setItems(r.items);
    } catch (e) {
      setErr(String(e));
    }
  };
  useEffect(() => { void reload(); }, []);

  const patch = async (id: number, patch: Partial<Method>) => {
    setBusy(id); setErr(null);
    try {
      await api.patch(`/admin/payment-methods/${id}`, patch);
      await reload();
    } catch (e) { setErr(String(e)); }
    finally { setBusy(null); }
  };

  const remove = async (id: number) => {
    if (!confirm('Удалить метод?')) return;
    setBusy(id); setErr(null);
    try {
      await api.delete(`/admin/payment-methods/${id}`);
      await reload();
    } catch (e) { setErr(String(e)); }
    finally { setBusy(null); }
  };

  const uploadIcon = async (id: number, file: File) => {
    setBusy(id); setErr(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(`/api/admin/payment-methods/${id}/icon`, {
        method: 'POST', credentials: 'include', body: fd,
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        throw new Error(j?.error?.message ?? `HTTP ${res.status}`);
      }
      await reload();
    } catch (e) { setErr(String(e)); }
    finally { setBusy(null); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-white/70">
          Методы пополнения / вывода. Иконки до 1 МБ (PNG / JPG / WebP / SVG).
          USD-курс: умножается на сумму в валюте метода для получения USD на балансе.
        </div>
        <button onClick={() => setAdding(true)} className="rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-bg">
          + Добавить
        </button>
      </div>

      {err && <div className="rounded bg-rose-500/20 px-3 py-2 text-sm text-rose-200">{err}</div>}

      <div className="grid gap-3 md:grid-cols-2">
        {items.map((m) => (
          <MethodCard key={m.id} m={m} busy={busy === m.id}
            onPatch={(p) => patch(m.id, p)} onRemove={() => remove(m.id)} onUpload={(f) => uploadIcon(m.id, f)} />
        ))}
      </div>

      {adding && (
        <AddModal
          onClose={() => setAdding(false)}
          onSaved={async () => { setAdding(false); await reload(); }}
        />
      )}
    </div>
  );
}

function MethodCard({ m, busy, onPatch, onRemove, onUpload }: {
  m: Method; busy: boolean;
  onPatch: (p: Partial<Method>) => Promise<void>;
  onRemove: () => Promise<void>;
  onUpload: (f: File) => Promise<void>;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [edit, setEdit] = useState(false);
  const [draft, setDraft] = useState(m);
  useEffect(() => { setDraft(m); }, [m]);

  const save = async () => {
    await onPatch({
      label: draft.label, kind: draft.kind, currency: draft.currency,
      minAmount: draft.minAmount, maxAmount: draft.maxAmount, usdRate: draft.usdRate,
      isDeposit: draft.isDeposit, isWithdraw: draft.isWithdraw, isActive: draft.isActive,
      sortOrder: Number(draft.sortOrder),
    });
    setEdit(false);
  };

  return (
    <div className="rounded-lg border border-white/10 bg-surface/40 p-3">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-md bg-black/40 hover:bg-black/60"
          title="Загрузить иконку"
        >
          {m.iconUrl ? (
            <img src={m.iconUrl} alt={m.label} className="h-12 w-12 object-contain" />
          ) : (
            <span className="text-[10px] text-white/50">upload</span>
          )}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/svg+xml"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onUpload(f);
            e.target.value = '';
          }}
        />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{m.label}</div>
          <div className="text-xs text-white/50">
            {m.slug} · {m.kind} · {m.currency}
            {!m.isActive && <span className="ml-2 rounded bg-rose-500/20 px-1.5 py-0.5 text-[10px] text-rose-200">off</span>}
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <label className="flex items-center gap-1 text-[11px] text-white/70">
            <input type="checkbox" checked={m.isActive} disabled={busy}
              onChange={(e) => onPatch({ isActive: e.target.checked })} /> active
          </label>
          <button onClick={() => setEdit((v) => !v)} className="rounded bg-white/10 px-2 py-0.5 text-[11px]">
            {edit ? 'cancel' : 'edit'}
          </button>
        </div>
      </div>

      {edit && (
        <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
          <Lab label="Label">
            <input className={inp} value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} />
          </Lab>
          <Lab label="Kind">
            <select className={inp} value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as Method['kind'] })}>
              {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
          </Lab>
          <Lab label="Currency">
            <input className={inp} value={draft.currency} onChange={(e) => setDraft({ ...draft, currency: e.target.value.toUpperCase() })} />
          </Lab>
          <Lab label="USD rate (×amount)">
            <input className={inp} value={draft.usdRate ?? ''} onChange={(e) => setDraft({ ...draft, usdRate: e.target.value || null })} placeholder="0.59" />
          </Lab>
          <Lab label="Min">
            <input className={inp} value={draft.minAmount ?? ''} onChange={(e) => setDraft({ ...draft, minAmount: e.target.value || null })} />
          </Lab>
          <Lab label="Max">
            <input className={inp} value={draft.maxAmount ?? ''} onChange={(e) => setDraft({ ...draft, maxAmount: e.target.value || null })} />
          </Lab>
          <Lab label="Sort">
            <input className={inp} type="number" value={draft.sortOrder} onChange={(e) => setDraft({ ...draft, sortOrder: Number(e.target.value) })} />
          </Lab>
          <Lab label="Flags">
            <div className="flex gap-3 pt-1">
              <label className="flex items-center gap-1"><input type="checkbox" checked={draft.isDeposit} onChange={(e) => setDraft({ ...draft, isDeposit: e.target.checked })} /> deposit</label>
              <label className="flex items-center gap-1"><input type="checkbox" checked={draft.isWithdraw} onChange={(e) => setDraft({ ...draft, isWithdraw: e.target.checked })} /> withdraw</label>
            </div>
          </Lab>
          <div className="col-span-2 flex justify-between pt-2">
            <button onClick={() => void onRemove()} disabled={busy} className="rounded bg-rose-500/30 px-3 py-1 text-rose-100">delete</button>
            <button onClick={() => void save()} disabled={busy} className="rounded bg-accent px-3 py-1 font-semibold text-bg">save</button>
          </div>
        </div>
      )}
    </div>
  );
}

function AddModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => Promise<void> }) {
  const [d, setD] = useState({
    slug: '', label: '', kind: 'betra_card' as Method['kind'], currency: 'AZN',
    usdRate: '', minAmount: '', maxAmount: '',
    isDeposit: true, isWithdraw: false, isActive: true, sortOrder: 100,
  });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true); setErr(null);
    try {
      await api.post('/admin/payment-methods', {
        ...d,
        usdRate: d.usdRate || null,
        minAmount: d.minAmount || null,
        maxAmount: d.maxAmount || null,
      });
      await onSaved();
    } catch (e) { setErr(String(e)); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-lg border border-white/10 bg-surface p-4" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 text-sm font-semibold">Новый метод</div>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <Lab label="Slug (a-z0-9_-)">
            <input className={inp} value={d.slug} onChange={(e) => setD({ ...d, slug: e.target.value.toLowerCase() })} />
          </Lab>
          <Lab label="Label">
            <input className={inp} value={d.label} onChange={(e) => setD({ ...d, label: e.target.value })} />
          </Lab>
          <Lab label="Kind">
            <select className={inp} value={d.kind} onChange={(e) => setD({ ...d, kind: e.target.value as Method['kind'] })}>
              {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
          </Lab>
          <Lab label="Currency">
            <input className={inp} value={d.currency} onChange={(e) => setD({ ...d, currency: e.target.value.toUpperCase() })} />
          </Lab>
          <Lab label="USD rate">
            <input className={inp} value={d.usdRate} onChange={(e) => setD({ ...d, usdRate: e.target.value })} placeholder="0.59 / 1.0" />
          </Lab>
          <Lab label="Sort">
            <input className={inp} type="number" value={d.sortOrder} onChange={(e) => setD({ ...d, sortOrder: Number(e.target.value) })} />
          </Lab>
          <Lab label="Min">
            <input className={inp} value={d.minAmount} onChange={(e) => setD({ ...d, minAmount: e.target.value })} />
          </Lab>
          <Lab label="Max">
            <input className={inp} value={d.maxAmount} onChange={(e) => setD({ ...d, maxAmount: e.target.value })} />
          </Lab>
          <Lab label="Flags">
            <div className="flex gap-3 pt-1">
              <label className="flex items-center gap-1"><input type="checkbox" checked={d.isDeposit} onChange={(e) => setD({ ...d, isDeposit: e.target.checked })} /> deposit</label>
              <label className="flex items-center gap-1"><input type="checkbox" checked={d.isWithdraw} onChange={(e) => setD({ ...d, isWithdraw: e.target.checked })} /> withdraw</label>
              <label className="flex items-center gap-1"><input type="checkbox" checked={d.isActive} onChange={(e) => setD({ ...d, isActive: e.target.checked })} /> active</label>
            </div>
          </Lab>
        </div>
        {err && <div className="mt-2 text-xs text-rose-300">{err}</div>}
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="rounded bg-white/10 px-3 py-1.5 text-xs">cancel</button>
          <button onClick={() => void save()} disabled={busy || !d.slug || !d.label} className="rounded bg-accent px-3 py-1.5 text-xs font-semibold text-bg disabled:opacity-50">create</button>
        </div>
      </div>
    </div>
  );
}

const inp = 'w-full rounded bg-black/40 px-2 py-1 outline-none focus:ring-1 focus:ring-accent';

function Lab({ label, children }: { label: string; children: any }) {
  return (
    <label className="block">
      <span className="mb-0.5 block text-[10px] uppercase tracking-wide text-white/50">{label}</span>
      {children}
    </label>
  );
}
