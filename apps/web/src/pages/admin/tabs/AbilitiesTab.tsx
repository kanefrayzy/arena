import { useEffect, useState } from 'react';
import { api } from '../../../shared/api/client';
import { Modal, PrimaryButton, GhostButton, Field, inputCls } from '../components/Modal';

const ABILITY_TYPES = ['dash', 'blink', 'shield', 'slow', 'triple_shot', 'bomb', 'heal'] as const;
type AbilityType = (typeof ABILITY_TYPES)[number];

interface Ability {
  id: number;
  slug: string;
  name: string;
  description: string;
  type: AbilityType;
  cooldownMs: number;
  damageAmount: number;
  durationMs: number;
  range: number;
  iconUrl: string | null;
  soundUrl: string | null;
}

export function AbilitiesTab() {
  const [abilities, setAbilities] = useState<Ability[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editAbility, setEditAbility] = useState<Ability | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    setErr(null);
    try {
      const r = await api.get<{ abilities: Ability[] }>('/admin/abilities');
      setAbilities(r.abilities);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'load failed');
    }
  }

  useEffect(() => { void load(); }, []);

  async function deleteAbility(a: Ability) {
    if (!confirm(`Delete ability "${a.name}"?`)) return;
    setBusy(`del${a.id}`);
    try {
      await api.delete(`/admin/abilities/${a.id}`);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'delete failed');
    } finally {
      setBusy(null);
    }
  }

  async function uploadIcon(a: Ability, file: File) {
    setBusy(`icon${a.id}`);
    try {
      const fd = new FormData();
      fd.append('file', file);
      await api.postForm(`/admin/abilities/${a.id}/icon`, fd);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'upload failed');
    } finally {
      setBusy(null);
    }
  }

  async function uploadSound(a: Ability, file: File) {
    setBusy(`snd${a.id}`);
    try {
      const fd = new FormData();
      fd.append('file', file);
      await api.postForm(`/admin/abilities/${a.id}/sound`, fd);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'upload failed');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {err && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{err}</div>
      )}

      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-white/60">Abilities</h3>
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          className="rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-bg hover:opacity-90"
        >
          + New ability
        </button>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {abilities.map((a) => (
          <div key={a.id} className="rounded-lg border border-white/10 bg-surface">
            <header className="flex items-center gap-3 border-b border-white/10 px-4 py-3">
              {/* Icon preview */}
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-black/40">
                {a.iconUrl ? (
                  <img src={a.iconUrl} alt={a.name} className="max-h-full max-w-full object-contain" />
                ) : (
                  <span className="text-lg">⚡</span>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold">{a.name}</div>
                <div className="text-xs text-white/40">/{a.slug} · <span className="text-accent">{a.type}</span></div>
              </div>
              <AbilityUploadButton
                onFile={(f) => void uploadIcon(a, f)}
                disabled={busy === `icon${a.id}`}
                label="Icon"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
              />
              <AbilityUploadButton
                onFile={(f) => void uploadSound(a, f)}
                disabled={busy === `snd${a.id}`}
                label="Sound"
                accept="audio/mpeg,audio/ogg,audio/wav,audio/webm,audio/mp4"
              />
              <button
                type="button"
                onClick={() => setEditAbility(a)}
                className="rounded-md bg-white/5 px-3 py-1.5 text-xs hover:bg-white/10"
              >
                Edit
              </button>
              <button
                type="button"
                disabled={busy === `del${a.id}`}
                onClick={() => void deleteAbility(a)}
                className="rounded-md bg-red-500/10 px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/20 disabled:opacity-40"
              >
                Del
              </button>
            </header>

            <div className="grid grid-cols-4 divide-x divide-white/5 px-0 text-center">
              <StatCell label="Cooldown" value={`${(a.cooldownMs / 1000).toFixed(1)}s`} />
              <StatCell label="Damage" value={String(a.damageAmount)} />
              <StatCell label="Duration" value={`${(a.durationMs / 1000).toFixed(1)}s`} />
              <StatCell label="Range" value={String(a.range)} />
            </div>

            {(a.description || a.soundUrl) && (
              <div className="flex items-start gap-3 px-4 py-3">
                {a.description && (
                  <p className="flex-1 text-xs text-white/50">{a.description}</p>
                )}
                {a.soundUrl && (
                  <audio controls src={a.soundUrl} className="h-7 w-40 shrink-0" />
                )}
              </div>
            )}
          </div>
        ))}
        {abilities.length === 0 && (
          <div className="col-span-2 rounded-lg border border-white/10 bg-surface px-4 py-8 text-center text-sm text-white/40">
            No abilities yet — click "+ New ability"
          </div>
        )}
      </div>

      <AbilityCreateModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onDone={async () => { setCreateOpen(false); await load(); }}
        setErr={setErr}
      />
      <AbilityEditModal
        ability={editAbility}
        onClose={() => setEditAbility(null)}
        onDone={async () => { setEditAbility(null); await load(); }}
        setErr={setErr}
      />
    </div>
  );
}

function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-2 py-3">
      <div className="text-[10px] uppercase text-white/40">{label}</div>
      <div className="mt-0.5 font-mono text-sm tabular-nums">{value}</div>
    </div>
  );
}

function AbilityUploadButton({ onFile, disabled, label, accept }: { onFile: (f: File) => void; disabled?: boolean; label: string; accept: string }) {
  return (
    <label className={`cursor-pointer rounded-md bg-white/5 px-3 py-1.5 text-xs hover:bg-white/10 ${disabled ? 'pointer-events-none opacity-50' : ''}`}>
      {label}
      <input
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }}
      />
    </label>
  );
}

function AbilityFormFields({
  type, setType, slug, setSlug, name, setName, description, setDescription,
  cooldownMs, setCooldownMs, damageAmount, setDamageAmount,
  durationMs, setDurationMs, range, setRange,
}: {
  type: string; setType: (v: string) => void;
  slug: string; setSlug: (v: string) => void;
  name: string; setName: (v: string) => void;
  description: string; setDescription: (v: string) => void;
  cooldownMs: string; setCooldownMs: (v: string) => void;
  damageAmount: string; setDamageAmount: (v: string) => void;
  durationMs: string; setDurationMs: (v: string) => void;
  range: string; setRange: (v: string) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <Field label="Slug">
        <input className={inputCls} value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="dash" />
      </Field>
      <Field label="Name">
        <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="Dash" />
      </Field>
      <Field label="Type" className="col-span-2">
        <select className={inputCls} value={type} onChange={(e) => setType(e.target.value)}>
          {ABILITY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </Field>
      <Field label="Cooldown (ms)">
        <input className={inputCls} value={cooldownMs} onChange={(e) => setCooldownMs(e.target.value)} type="number" placeholder="8000" />
      </Field>
      <Field label="Damage / Heal amount">
        <input className={inputCls} value={damageAmount} onChange={(e) => setDamageAmount(e.target.value)} type="number" placeholder="0" />
      </Field>
      <Field label="Duration (ms)">
        <input className={inputCls} value={durationMs} onChange={(e) => setDurationMs(e.target.value)} type="number" placeholder="0" />
      </Field>
      <Field label="Range (px)">
        <input className={inputCls} value={range} onChange={(e) => setRange(e.target.value)} type="number" placeholder="0" />
      </Field>
      <Field label="Description" className="col-span-2">
        <textarea className={inputCls + ' resize-none'} rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
    </div>
  );
}

function AbilityCreateModal({ open, onClose, onDone, setErr }: { open: boolean; onClose: () => void; onDone: () => Promise<void>; setErr: (s: string | null) => void }) {
  const [slug, setSlug] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState<string>('dash');
  const [cooldownMs, setCooldownMs] = useState('8000');
  const [damageAmount, setDamageAmount] = useState('0');
  const [durationMs, setDurationMs] = useState('0');
  const [range, setRange] = useState('0');
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    setSubmitting(true);
    try {
      await api.post('/admin/abilities', {
        slug: slug.trim(),
        name: name.trim(),
        description: description.trim(),
        type,
        cooldownMs: parseInt(cooldownMs, 10) || 8000,
        damageAmount: parseInt(damageAmount, 10) || 0,
        durationMs: parseInt(durationMs, 10) || 0,
        range: parseInt(range, 10) || 0,
      });
      setSlug(''); setName(''); setDescription('');
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
      title="New ability"
      footer={
        <>
          <GhostButton onClick={onClose}>Cancel</GhostButton>
          <PrimaryButton onClick={submit} disabled={submitting || !slug.trim() || !name.trim()}>
            {submitting ? 'creating…' : 'Create'}
          </PrimaryButton>
        </>
      }
    >
      <AbilityFormFields
        type={type} setType={setType}
        slug={slug} setSlug={setSlug}
        name={name} setName={setName}
        description={description} setDescription={setDescription}
        cooldownMs={cooldownMs} setCooldownMs={setCooldownMs}
        damageAmount={damageAmount} setDamageAmount={setDamageAmount}
        durationMs={durationMs} setDurationMs={setDurationMs}
        range={range} setRange={setRange}
      />
    </Modal>
  );
}

function AbilityEditModal({ ability, onClose, onDone, setErr }: { ability: Ability | null; onClose: () => void; onDone: () => Promise<void>; setErr: (s: string | null) => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState('dash');
  const [slug, setSlug] = useState('');
  const [cooldownMs, setCooldownMs] = useState('8000');
  const [damageAmount, setDamageAmount] = useState('0');
  const [durationMs, setDurationMs] = useState('0');
  const [range, setRange] = useState('0');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (ability) {
      setSlug(ability.slug);
      setName(ability.name);
      setDescription(ability.description);
      setType(ability.type);
      setCooldownMs(String(ability.cooldownMs));
      setDamageAmount(String(ability.damageAmount));
      setDurationMs(String(ability.durationMs));
      setRange(String(ability.range));
    }
  }, [ability]);

  async function submit() {
    if (!ability) return;
    setSubmitting(true);
    try {
      await api.patch(`/admin/abilities/${ability.id}`, {
        name: name.trim(),
        description: description.trim(),
        type,
        cooldownMs: parseInt(cooldownMs, 10) || 8000,
        damageAmount: parseInt(damageAmount, 10) || 0,
        durationMs: parseInt(durationMs, 10) || 0,
        range: parseInt(range, 10) || 0,
      });
      await onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open={!!ability}
      onClose={onClose}
      title={ability ? `Edit · ${ability.name}` : ''}
      footer={
        <>
          <GhostButton onClick={onClose}>Cancel</GhostButton>
          <PrimaryButton onClick={submit} disabled={submitting}>
            {submitting ? 'saving…' : 'Save'}
          </PrimaryButton>
        </>
      }
    >
      <AbilityFormFields
        type={type} setType={setType}
        slug={slug} setSlug={setSlug}
        name={name} setName={setName}
        description={description} setDescription={setDescription}
        cooldownMs={cooldownMs} setCooldownMs={setCooldownMs}
        damageAmount={damageAmount} setDamageAmount={setDamageAmount}
        durationMs={durationMs} setDurationMs={setDurationMs}
        range={range} setRange={setRange}
      />
    </Modal>
  );
}
