import { useEffect, useState } from 'react';
import { api } from '../../../shared/api/client';
import { Modal, PrimaryButton, GhostButton, Field, inputCls } from '../components/Modal';
import { Badge } from '../components/Badge';

interface Skin {
  id: number;
  characterId: number;
  name: string;
  rarity: string;
  tint: string | null;
  priceUsd: string | null;
  isActive: boolean;
}

interface Character {
  id: number;
  slug: string;
  name: string;
  baseHp: number;
  baseSpeed: number;
  baseDamage: number;
  weaponType: string;
  abilityType: string | null;
  abilityCooldownS: number;
  isActive: boolean;
  skins: Skin[];
}

const STAT_FIELDS: { key: 'baseHp' | 'baseSpeed' | 'baseDamage' | 'abilityCooldownS'; label: string; suffix: string }[] = [
  { key: 'baseHp', label: 'HP', suffix: '' },
  { key: 'baseSpeed', label: 'Speed', suffix: '' },
  { key: 'baseDamage', label: 'Damage', suffix: '' },
  { key: 'abilityCooldownS', label: 'Cooldown', suffix: 's' },
];

export function ContentTab() {
  const [chars, setChars] = useState<Character[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [editChar, setEditChar] = useState<Character | null>(null);
  const [editSkin, setEditSkin] = useState<Skin | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    setErr(null);
    try {
      const r = await api.get<{ characters: Character[] }>('/characters');
      setChars(r.characters);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'load failed');
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function toggleSkin(s: Skin) {
    setBusy(`s${s.id}`);
    try {
      await api.patch(`/admin/skins/${s.id}`, { isActive: !s.isActive });
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'failed');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {err && <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{err}</div>}

      <div className="grid gap-4 lg:grid-cols-2">
        {chars.map((c) => (
          <div key={c.id} className="rounded-lg border border-white/10 bg-surface">
            <header className="flex items-center justify-between border-b border-white/10 px-4 py-3">
              <div>
                <div className="font-semibold">{c.name}</div>
                <div className="text-xs text-white/40">/{c.slug} · {c.weaponType}</div>
              </div>
              <button
                type="button"
                onClick={() => setEditChar(c)}
                className="rounded-md bg-white/5 px-3 py-1.5 text-xs hover:bg-white/10"
              >
                Edit stats
              </button>
            </header>

            <div className="grid grid-cols-4 divide-x divide-white/5 border-b border-white/10 text-center">
              {STAT_FIELDS.map((f) => (
                <div key={f.key} className="px-2 py-3">
                  <div className="text-[10px] uppercase text-white/40">{f.label}</div>
                  <div className="mt-0.5 font-mono text-sm tabular-nums">
                    {c[f.key]}{f.suffix}
                  </div>
                </div>
              ))}
            </div>

            <div className="flex flex-col">
              {c.skins.map((s) => (
                <div key={s.id} className="flex items-center gap-3 border-b border-white/5 px-4 py-2.5 last:border-b-0">
                  <span className="h-4 w-4 shrink-0 rounded-full ring-1 ring-white/10" style={{ backgroundColor: s.tint ?? '#888' }} />
                  <div className="flex-1 min-w-0">
                    <div className={`text-sm ${!s.isActive ? 'text-white/40 line-through' : ''}`}>{s.name}</div>
                    <div className="text-[10px] uppercase text-white/40">{s.rarity}</div>
                  </div>
                  <span className="font-mono text-sm tabular-nums text-white/80">
                    {s.priceUsd ? `$${s.priceUsd}` : <span className="text-white/30">free</span>}
                  </span>
                  <button
                    type="button"
                    disabled={busy === `s${s.id}`}
                    onClick={() => setEditSkin(s)}
                    className="rounded-md bg-white/5 px-2 py-1 text-xs hover:bg-white/10 disabled:opacity-40"
                  >
                    price
                  </button>
                  <button
                    type="button"
                    disabled={busy === `s${s.id}`}
                    onClick={() => void toggleSkin(s)}
                    className="rounded-md bg-white/5 px-2 py-1 text-xs hover:bg-white/10 disabled:opacity-40"
                  >
                    {s.isActive ? 'disable' : 'enable'}
                  </button>
                </div>
              ))}
              {c.skins.length === 0 && <div className="px-4 py-3 text-xs text-white/40">No skins</div>}
            </div>
          </div>
        ))}
      </div>

      <CharStatsModal
        char={editChar}
        onClose={() => setEditChar(null)}
        onDone={async () => {
          setEditChar(null);
          await load();
        }}
        setErr={setErr}
      />
      <SkinPriceModal
        skin={editSkin}
        onClose={() => setEditSkin(null)}
        onDone={async () => {
          setEditSkin(null);
          await load();
        }}
        setErr={setErr}
      />
    </div>
  );
}

function CharStatsModal({
  char,
  onClose,
  onDone,
  setErr,
}: {
  char: Character | null;
  onClose: () => void;
  onDone: () => Promise<void>;
  setErr: (s: string | null) => void;
}) {
  const [hp, setHp] = useState('');
  const [speed, setSpeed] = useState('');
  const [damage, setDamage] = useState('');
  const [cd, setCd] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (char) {
      setHp(String(char.baseHp));
      setSpeed(String(char.baseSpeed));
      setDamage(String(char.baseDamage));
      setCd(String(char.abilityCooldownS));
    }
  }, [char]);

  async function submit() {
    if (!char) return;
    setSubmitting(true);
    try {
      await api.patch(`/admin/characters/${char.id}`, {
        baseHp: parseInt(hp, 10),
        baseSpeed: parseFloat(speed),
        baseDamage: parseInt(damage, 10),
        abilityCooldownS: parseInt(cd, 10),
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
      open={!!char}
      onClose={onClose}
      title={char ? `Stats · ${char.name}` : ''}
      footer={
        <>
          <GhostButton onClick={onClose}>Cancel</GhostButton>
          <PrimaryButton onClick={submit} disabled={submitting}>
            {submitting ? 'saving…' : 'Save'}
          </PrimaryButton>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="HP">
          <input className={inputCls} value={hp} onChange={(e) => setHp(e.target.value)} type="number" />
        </Field>
        <Field label="Speed">
          <input className={inputCls} value={speed} onChange={(e) => setSpeed(e.target.value)} type="number" step="0.1" />
        </Field>
        <Field label="Damage">
          <input className={inputCls} value={damage} onChange={(e) => setDamage(e.target.value)} type="number" />
        </Field>
        <Field label="Cooldown (s)">
          <input className={inputCls} value={cd} onChange={(e) => setCd(e.target.value)} type="number" />
        </Field>
      </div>
    </Modal>
  );
}

function SkinPriceModal({
  skin,
  onClose,
  onDone,
  setErr,
}: {
  skin: Skin | null;
  onClose: () => void;
  onDone: () => Promise<void>;
  setErr: (s: string | null) => void;
}) {
  const [price, setPrice] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (skin) setPrice(skin.priceUsd ?? '');
  }, [skin]);

  async function submit() {
    if (!skin) return;
    setSubmitting(true);
    try {
      await api.patch(`/admin/skins/${skin.id}`, { priceUsd: price.trim() === '' ? null : price.trim() });
      await onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open={!!skin}
      onClose={onClose}
      title={skin ? `Price · ${skin.name}` : ''}
      footer={
        <>
          <GhostButton onClick={onClose}>Cancel</GhostButton>
          <PrimaryButton onClick={submit} disabled={submitting}>
            {submitting ? 'saving…' : 'Save'}
          </PrimaryButton>
        </>
      }
    >
      <Field label="Price (USD)" hint="Leave empty to mark as free / not for sale">
        <input className={inputCls} value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0.00" autoFocus />
      </Field>
    </Modal>
  );
}
