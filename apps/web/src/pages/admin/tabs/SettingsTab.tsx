import { useEffect, useState } from 'react';
import { api } from '../../../shared/api/client';

interface Setting {
  key: string;
  value: unknown;
}

export function SettingsTab() {
  const [items, setItems] = useState<Setting[]>([]);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    setErr(null);
    try {
      const r = await api.get<{ items: Setting[] }>('/admin/settings');
      setItems(r.items);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'load failed');
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function edit(s: Setting) {
    const raw = window.prompt(`Value for "${s.key}" (JSON):`, JSON.stringify(s.value));
    if (raw === null) return;
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      setErr('invalid JSON');
      return;
    }
    try {
      await api.post('/admin/settings', { key: s.key, value });
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'failed');
    }
  }

  async function add() {
    const key = window.prompt('Key:');
    if (!key) return;
    const raw = window.prompt('Value (JSON):', 'null');
    if (raw === null) return;
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      setErr('invalid JSON');
      return;
    }
    try {
      await api.post('/admin/settings', { key, value });
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'failed');
    }
  }

  async function del(key: string) {
    if (!window.confirm(`Delete "${key}"?`)) return;
    try {
      await api.delete(`/admin/settings/${encodeURIComponent(key)}`);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'failed');
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <button type="button" onClick={() => void add()} className="rounded bg-accent py-1 text-xs font-semibold text-bg">
        + new setting
      </button>
      {err && <div className="text-xs text-red-400">{err}</div>}
      {items.map((s) => (
        <div key={s.key} className="rounded bg-surface px-2 py-2 text-xs">
          <div className="flex items-center justify-between">
            <span className="font-mono">{s.key}</span>
            <div className="flex gap-1">
              <button type="button" onClick={() => void edit(s)} className="rounded bg-white/10 px-2 py-0.5 text-[10px]">
                edit
              </button>
              <button type="button" onClick={() => void del(s.key)} className="rounded bg-red-500/20 px-2 py-0.5 text-[10px] text-red-300">
                del
              </button>
            </div>
          </div>
          <pre className="mt-1 overflow-x-auto whitespace-pre-wrap text-[10px] text-white/60">{JSON.stringify(s.value, null, 0)}</pre>
        </div>
      ))}
    </div>
  );
}
