import { useEffect, useMemo, useState } from 'react';
import { api } from '../../../shared/api/client';
import { Modal, PrimaryButton, GhostButton, Field, inputCls } from '../components/Modal';
import { Badge } from '../components/Badge';
import { GROUP_LABELS, SETTING_META, getMeta, type SettingMeta } from '../settingsMeta';

interface Setting {
  key: string;
  value: unknown;
}

function formatValue(v: unknown): string {
  if (typeof v === 'boolean') return v ? 'On' : 'Off';
  if (v === null) return '—';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') return `"${v}"`;
  if (Array.isArray(v)) return v.length === 0 ? 'Empty list' : v.join(', ');
  return JSON.stringify(v);
}

function valueTone(v: unknown, key: string): 'success' | 'warning' | 'danger' | 'neutral' {
  // Highlight risky settings
  if (key === 'wallet.auto_withdrawal' && v === true) return 'danger';
  if (typeof v === 'boolean') return v ? 'success' : 'neutral';
  if (v === null) return 'neutral';
  return 'neutral';
}

export function SettingsTab() {
  const [items, setItems] = useState<Setting[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState<Setting | null>(null);
  const [creating, setCreating] = useState(false);

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

  async function del(key: string) {
    if (!window.confirm(`Удалить настройку "${key}"?`)) return;
    try {
      await api.delete(`/admin/settings/${encodeURIComponent(key)}`);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'failed');
    }
  }

  // Group items by their meta.group, plus add missing-known keys as suggestions
  const grouped = useMemo(() => {
    const presentKeys = new Set(items.map((i) => i.key));
    const groups: Record<string, { setting: Setting; meta: SettingMeta; missing?: boolean }[]> = {};

    for (const item of items) {
      const meta = getMeta(item.key);
      (groups[meta.group] ||= []).push({ setting: item, meta });
    }
    // Add registered keys that don't exist yet, so admin can create them
    for (const key of Object.keys(SETTING_META)) {
      if (presentKeys.has(key)) continue;
      const meta = SETTING_META[key]!;
      (groups[meta.group] ||= []).push({ setting: { key, value: null }, meta, missing: true });
    }

    // Stable order
    const order: SettingMeta['group'][] = ['gameplay', 'rooms', 'wallet', 'legal', 'other'];
    return order
      .filter((g) => groups[g] && groups[g]!.length > 0)
      .map((g) => ({
        group: g,
        label: GROUP_LABELS[g],
        rows: groups[g]!.sort((a, b) => a.meta.label.localeCompare(b.meta.label)),
      }));
  }, [items]);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-3">
        <p className="max-w-2xl text-sm text-white/60">
          Глобальные параметры платформы. Каждая настройка хранится как JSON. Известные ключи показаны с
          описанием; новые можно добавить вручную через кнопку справа.
        </p>
        <PrimaryButton onClick={() => setCreating(true)}>+ Custom key</PrimaryButton>
      </div>
      {err && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{err}</div>
      )}

      {grouped.map((g) => (
        <section key={g.group}>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-white/40">{g.label}</h3>
          <div className="overflow-hidden rounded-lg border border-white/10">
            {g.rows.map(({ setting, meta, missing }, idx) => (
              <div
                key={setting.key}
                className={
                  'flex flex-col gap-3 bg-surface px-4 py-3 sm:flex-row sm:items-center ' +
                  (idx > 0 ? 'border-t border-white/5 ' : '') +
                  (missing ? 'opacity-60' : '')
                }
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-white">{meta.label}</span>
                    <Badge tone="neutral">{meta.type}</Badge>
                    {missing && <Badge tone="warning">not set</Badge>}
                  </div>
                  <div className="mt-1 text-xs text-white/60">{meta.description}</div>
                  <div className="mt-1 font-mono text-[10px] text-white/30">{setting.key}</div>
                </div>

                <div className="flex shrink-0 items-center gap-3 sm:w-72 sm:justify-end">
                  {!missing && (
                    <Badge tone={valueTone(setting.value, setting.key)}>{formatValue(setting.value)}</Badge>
                  )}
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => setEditing(missing ? { key: setting.key, value: parseExample(meta) } : setting)}
                      className="rounded-md bg-white/5 px-3 py-1.5 text-xs hover:bg-white/10"
                    >
                      {missing ? 'configure' : 'edit'}
                    </button>
                    {!missing && (
                      <button
                        type="button"
                        onClick={() => void del(setting.key)}
                        className="rounded-md bg-red-500/15 px-3 py-1.5 text-xs text-red-300 hover:bg-red-500/25"
                      >
                        delete
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}

      <SettingFormModal
        setting={editing}
        open={!!editing || creating}
        creating={creating && !editing}
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

function parseExample(meta: SettingMeta): unknown {
  if (!meta.example) return null;
  try {
    return JSON.parse(meta.example);
  } catch {
    return meta.example;
  }
}

function SettingFormModal({
  setting,
  open,
  creating,
  onClose,
  onDone,
  setErr,
}: {
  setting: Setting | null;
  open: boolean;
  creating: boolean;
  onClose: () => void;
  onDone: () => Promise<void>;
  setErr: (s: string | null) => void;
}) {
  const [key, setKey] = useState('');
  const [valueStr, setValueStr] = useState('null');
  const [submitting, setSubmitting] = useState(false);
  const [parseErr, setParseErr] = useState<string | null>(null);

  const meta = setting ? getMeta(setting.key) : null;
  const isBoolean = meta?.type === 'boolean';

  useEffect(() => {
    if (setting) {
      setKey(setting.key);
      setValueStr(JSON.stringify(setting.value, null, 2));
    } else if (creating) {
      setKey('');
      setValueStr('null');
    }
    setParseErr(null);
  }, [setting, creating]);

  async function submit(overrideValue?: unknown) {
    setParseErr(null);
    let value: unknown;
    if (overrideValue !== undefined) {
      value = overrideValue;
    } else {
      try {
        value = JSON.parse(valueStr);
      } catch {
        setParseErr('Invalid JSON');
        return;
      }
    }
    if (!key.trim()) {
      setParseErr('Key required');
      return;
    }
    setSubmitting(true);
    try {
      await api.post('/admin/settings', { key: key.trim(), value });
      await onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'failed');
    } finally {
      setSubmitting(false);
    }
  }

  const currentBool = (() => {
    try {
      return JSON.parse(valueStr) === true;
    } catch {
      return false;
    }
  })();

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={meta && setting ? meta.label : creating ? 'New custom setting' : 'Edit'}
      width="max-w-lg"
      footer={
        <>
          <GhostButton onClick={onClose}>Cancel</GhostButton>
          <PrimaryButton onClick={() => void submit()} disabled={submitting}>
            {submitting ? 'saving…' : 'Save'}
          </PrimaryButton>
        </>
      }
    >
      {meta && setting && (
        <div className="mb-4 rounded-md bg-white/5 px-3 py-2 text-xs text-white/70">
          {meta.description}
          {meta.example && (
            <div className="mt-1 text-white/40">
              Example: <code className="font-mono text-white/60">{meta.example}</code>
            </div>
          )}
        </div>
      )}

      <Field label="Key">
        <input
          className={inputCls}
          value={key}
          onChange={(e) => setKey(e.target.value)}
          disabled={!creating}
          placeholder="feature.flag.name"
        />
      </Field>

      {isBoolean ? (
        <Field label="Value">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setValueStr('true')}
              className={
                'flex-1 rounded-md border px-3 py-2 text-sm ' +
                (currentBool
                  ? 'border-green-500/40 bg-green-500/15 text-green-300'
                  : 'border-white/10 bg-bg text-white/60 hover:border-white/20')
              }
            >
              On (true)
            </button>
            <button
              type="button"
              onClick={() => setValueStr('false')}
              className={
                'flex-1 rounded-md border px-3 py-2 text-sm ' +
                (!currentBool
                  ? 'border-white/30 bg-white/10 text-white'
                  : 'border-white/10 bg-bg text-white/60 hover:border-white/20')
              }
            >
              Off (false)
            </button>
          </div>
        </Field>
      ) : (
        <Field label={`Value (JSON${meta ? ` · ${meta.type}` : ''})`}>
          <textarea
            className={inputCls + ' min-h-[120px] font-mono text-xs'}
            value={valueStr}
            onChange={(e) => setValueStr(e.target.value)}
            spellCheck={false}
          />
        </Field>
      )}

      {parseErr && <div className="text-xs text-red-400">{parseErr}</div>}
    </Modal>
  );
}
