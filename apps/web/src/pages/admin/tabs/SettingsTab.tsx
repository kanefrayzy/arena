import { useEffect, useMemo, useState } from 'react';
import { api } from '../../../shared/api/client';
import { GROUP_LABELS, SETTING_META, getMeta, type SettingMeta } from '../settingsMeta';

interface Setting { key: string; value: unknown }

function Toggle({ checked, onChange, danger }: { checked: boolean; onChange: (v: boolean) => void; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={
        'relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ' +
        (checked ? (danger ? 'bg-rose-500' : 'bg-accent') : 'bg-white/15')
      }
      role="switch"
      aria-checked={checked}
    >
      <span
        className={
          'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition duration-200 ' +
          (checked ? 'translate-x-5' : 'translate-x-0')
        }
      />
    </button>
  );
}

export function SettingsTab() {
  const [items, setItems] = useState<Setting[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [editKey, setEditKey] = useState<string | null>(null);
  const [editVal, setEditVal] = useState('');
  const [editErr, setEditErr] = useState<string | null>(null);

  async function load() {
    setErr(null);
    try {
      const r = await api.get<{ items: Setting[] }>('/admin/settings');
      setItems(r.items);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'load failed');
    }
  }

  useEffect(() => { void load(); }, []);

  async function save(key: string, value: unknown) {
    setBusy(key);
    try {
      await api.post('/admin/settings', { key, value });
      setItems((prev) => {
        const idx = prev.findIndex((s) => s.key === key);
        if (idx >= 0) return prev.map((s) => s.key === key ? { ...s, value } : s);
        return [...prev, { key, value }];
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'save failed');
    } finally {
      setBusy(null);
    }
  }

  function openEdit(key: string, value: unknown) {
    setEditKey(key);
    setEditVal(typeof value === 'string' ? value : JSON.stringify(value ?? ''));
    setEditErr(null);
  }

  async function submitEdit() {
    if (!editKey) return;
    const meta = getMeta(editKey);
    let parsed: unknown;
    try {
      if (meta.type === 'number') {
        const n = Number(editVal);
        if (isNaN(n)) throw new Error('Must be a number');
        parsed = n;
      } else if (meta.type === 'array') {
        if (editVal.trim().startsWith('[')) {
          parsed = JSON.parse(editVal);
        } else {
          parsed = editVal.split(',').map((s) => s.trim()).filter(Boolean);
        }
      } else if (meta.type === 'object') {
        parsed = JSON.parse(editVal);
      } else {
        parsed = editVal;
      }
    } catch (e) {
      setEditErr(e instanceof Error ? e.message : 'invalid value');
      return;
    }
    await save(editKey, parsed);
    setEditKey(null);
  }

  const grouped = useMemo(() => {
    const presentKeys = new Set(items.map((i) => i.key));
    const map: Record<string, { setting: Setting; meta: SettingMeta }[]> = {};

    for (const item of items) {
      const meta = getMeta(item.key);
      if (meta.group === 'other' && !SETTING_META[item.key]) continue;
      (map[meta.group] ||= []).push({ setting: item, meta });
    }
    for (const key of Object.keys(SETTING_META)) {
      if (presentKeys.has(key)) continue;
      const meta = SETTING_META[key]!;
      (map[meta.group] ||= []).push({ setting: { key, value: null }, meta });
    }

    const order: SettingMeta['group'][] = ['gameplay', 'bots', 'rooms', 'wallet', 'seo', 'legal', 'other'];
    return order
      .filter((g) => map[g] && map[g]!.length > 0)
      .map((g) => ({ group: g, label: GROUP_LABELS[g], rows: map[g]!.sort((a, b) => a.meta.label.localeCompare(b.meta.label)) }));
  }, [items]);

  return (
    <div className="flex flex-col gap-5">
      {err && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{err}</div>
      )}
      {grouped.map((g) => (
        <section key={g.group}>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-white/40">{g.label}</h3>
          <div className="overflow-hidden rounded-lg border border-white/10">
            {g.rows.map(({ setting, meta }, idx) => {
              const isNull = setting.value === null;
              const isBool = meta.type === 'boolean';
              const isNum = meta.type === 'number';
              const isStr = meta.type === 'string';
              const isLoading = busy === setting.key;
              const isDanger = setting.key === 'wallet.auto_withdrawal';

              return (
                <div
                  key={setting.key}
                  className={
                    'flex items-center gap-3 bg-surface px-4 py-3 ' +
                    (idx > 0 ? 'border-t border-white/5 ' : '') +
                    (isNull && !isBool ? 'opacity-70' : '')
                  }
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-sm font-medium text-white">
                      {meta.label}
                      {isDanger && <span className="rounded bg-rose-500/20 px-1.5 py-0.5 text-[10px] text-rose-300">warning</span>}
                      {isNull && !isBool && <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-white/40">not set</span>}
                    </div>
                    <div className="mt-0.5 text-xs text-white/50">{meta.description}</div>
                  </div>
                  <div className="shrink-0">
                    {isBool ? (
                      <Toggle checked={setting.value === true} danger={isDanger} onChange={(v) => void save(setting.key, v)} />
                    ) : (isNum || isStr) ? (
                      editKey === setting.key ? (
                        <div className="flex items-center gap-1">
                          <input
                            autoFocus type={isNum ? 'number' : 'text'} value={editVal}
                            onChange={(e) => setEditVal(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') void submitEdit(); if (e.key === 'Escape') setEditKey(null); }}
                            className="w-28 rounded border border-white/20 bg-bg px-2 py-1 text-xs text-white outline-none focus:border-accent"
                          />
                          <button type="button" disabled={isLoading} onClick={() => void submitEdit()} className="rounded bg-accent px-2 py-1 text-xs font-semibold text-bg disabled:opacity-50">OK</button>
                          <button type="button" onClick={() => setEditKey(null)} className="rounded bg-white/10 px-2 py-1 text-xs">X</button>
                          {editErr && <span className="text-xs text-rose-300">{editErr}</span>}
                        </div>
                      ) : (
                        <button type="button" onClick={() => openEdit(setting.key, setting.value)} className="rounded border border-white/15 bg-white/5 px-3 py-1 text-xs text-white/80 hover:bg-white/10">
                          {isNull ? 'set' : String(setting.value)}
                        </button>
                      )
                    ) : (
                      editKey === setting.key ? (
                        <div className="flex flex-col gap-1">
                          <textarea autoFocus value={editVal} onChange={(e) => setEditVal(e.target.value)} rows={3}
                            className="w-52 rounded border border-white/20 bg-bg p-1.5 font-mono text-xs text-white outline-none focus:border-accent" />
                          {editErr && <span className="text-xs text-rose-300">{editErr}</span>}
                          <div className="flex gap-1">
                            <button type="button" disabled={isLoading} onClick={() => void submitEdit()} className="rounded bg-accent px-2 py-1 text-xs font-semibold text-bg disabled:opacity-50">Save</button>
                            <button type="button" onClick={() => setEditKey(null)} className="rounded bg-white/10 px-2 py-1 text-xs">Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <button type="button" onClick={() => openEdit(setting.key, meta.type === 'array' && Array.isArray(setting.value) ? (setting.value as string[]).join(', ') : setting.value)} className="rounded border border-white/15 bg-white/5 px-3 py-1 text-xs text-white/80 hover:bg-white/10">
                          {isNull ? 'set' : meta.type === 'array' && Array.isArray(setting.value) ? '[' + String((setting.value as unknown[]).length) + ']' : 'edit'}
                        </button>
                      )
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}