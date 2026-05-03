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
  spriteUrl: string | null;
  priceUsd: string | null;
  isStarter: boolean;
  skins: Skin[];
}

interface Weapon {
  id: number;
  slug: string;
  name: string;
  spriteUrl: string | null;
  damage: number;
  fireRateMs: number;
  bulletSpeed: number;
  priceUsd: string | null;
  isStarter: boolean;
  isActive: boolean;
}

const STAT_FIELDS: { key: 'baseHp' | 'baseSpeed' | 'baseDamage' | 'abilityCooldownS'; label: string; suffix: string }[] = [
  { key: 'baseHp', label: 'HP', suffix: '' },
  { key: 'baseSpeed', label: 'Speed', suffix: '' },
  { key: 'baseDamage', label: 'Damage', suffix: '' },
  { key: 'abilityCooldownS', label: 'Cooldown', suffix: 's' },
];

export function ContentTab() {
  const [chars, setChars] = useState<Character[]>([]);
  const [weapons, setWeapons] = useState<Weapon[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [editChar, setEditChar] = useState<Character | null>(null);
  const [editSkin, setEditSkin] = useState<Skin | null>(null);
  const [editWeapon, setEditWeapon] = useState<Weapon | null>(null);
  const [createWeaponOpen, setCreateWeaponOpen] = useState(false);
  const [createCharOpen, setCreateCharOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    setErr(null);
    try {
      const [r, w] = await Promise.all([
        api.get<{ characters: Character[] }>('/characters'),
        api.get<{ weapons: Weapon[] }>('/weapons'),
      ]);
      setChars(r.characters);
      setWeapons(w.weapons);
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

  async function uploadCharSprite(c: Character, file: File) {
    setBusy(`c${c.id}`);
    try {
      const fd = new FormData();
      fd.append('file', file);
      await api.postForm(`/admin/characters/${c.id}/sprite`, fd);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'upload failed');
    } finally {
      setBusy(null);
    }
  }

  async function uploadWeaponSprite(w: Weapon, file: File) {
    setBusy(`w${w.id}`);
    try {
      const fd = new FormData();
      fd.append('file', file);
      await api.postForm(`/admin/weapons/${w.id}/sprite`, fd);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'upload failed');
    } finally {
      setBusy(null);
    }
  }

  async function toggleWeapon(w: Weapon) {
    setBusy(`w${w.id}`);
    try {
      await api.patch(`/admin/weapons/${w.id}`, { isActive: !w.isActive });
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

      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-white/60">Characters</h3>
        <button
          type="button"
          onClick={() => setCreateCharOpen(true)}
          className="rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-bg hover:opacity-90"
        >
          + New character
        </button>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {chars.map((c) => (
          <div key={c.id} className="rounded-lg border border-white/10 bg-surface">
            <header className="flex items-center gap-3 border-b border-white/10 px-4 py-3">
              <SpriteCell url={c.spriteUrl} alt={c.name} />
              <div className="flex-1 min-w-0">
                <div className="font-semibold">{c.name}</div>
                <div className="text-xs text-white/40">/{c.slug} · {c.weaponType} · {c.priceUsd ? `$${c.priceUsd}` : (c.isStarter ? 'starter' : 'free')}</div>
              </div>
              <UploadButton
                onFile={(f) => void uploadCharSprite(c, f)}
                disabled={busy === `c${c.id}`}
                label="Sprite"
              />
              <button
                type="button"
                onClick={() => setEditChar(c)}
                className="rounded-md bg-white/5 px-3 py-1.5 text-xs hover:bg-white/10"
              >
                Edit
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
      <CharCreateModal
        open={createCharOpen}
        onClose={() => setCreateCharOpen(false)}
        onDone={async () => {
          setCreateCharOpen(false);
          await load();
        }}
        setErr={setErr}
      />

      {/* Weapons section */}
      <div className="mt-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-white/60">Weapons</h3>
        <button
          type="button"
          onClick={() => setCreateWeaponOpen(true)}
          className="rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-bg hover:opacity-90"
        >
          + New weapon
        </button>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {weapons.map((w) => (
          <div key={w.id} className="flex items-center gap-3 rounded-lg border border-white/10 bg-surface px-4 py-3">
            <SpriteCell url={w.spriteUrl} alt={w.name} />
            <div className="flex-1 min-w-0">
              <div className={`text-sm font-semibold ${!w.isActive ? 'text-white/40 line-through' : ''}`}>{w.name}</div>
              <div className="text-[11px] text-white/40">
                /{w.slug} · dmg {w.damage} · ROF {w.fireRateMs}ms · {w.priceUsd ? `$${w.priceUsd}` : (w.isStarter ? 'starter' : 'free')}
              </div>
            </div>
            <UploadButton
              onFile={(f) => void uploadWeaponSprite(w, f)}
              disabled={busy === `w${w.id}`}
              label="Sprite"
            />
            <button
              type="button"
              onClick={() => setEditWeapon(w)}
              className="rounded-md bg-white/5 px-2 py-1 text-xs hover:bg-white/10"
            >
              Edit
            </button>
            <button
              type="button"
              disabled={busy === `w${w.id}`}
              onClick={() => void toggleWeapon(w)}
              className="rounded-md bg-white/5 px-2 py-1 text-xs hover:bg-white/10 disabled:opacity-40"
            >
              {w.isActive ? 'disable' : 'enable'}
            </button>
          </div>
        ))}
        {weapons.length === 0 && <div className="text-xs text-white/40">No weapons — click “+ New weapon”</div>}
      </div>

      <WeaponEditModal
        weapon={editWeapon}
        onClose={() => setEditWeapon(null)}
        onDone={async () => {
          setEditWeapon(null);
          await load();
        }}
        setErr={setErr}
      />
      <WeaponCreateModal
        open={createWeaponOpen}
        onClose={() => setCreateWeaponOpen(false)}
        onDone={async () => {
          setCreateWeaponOpen(false);
          await load();
        }}
        setErr={setErr}
      />
    </div>
  );
}

function SpriteCell({ url, alt }: { url: string | null; alt: string }) {
  return (
    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-black/40">
      {url ? (
        <img src={url} alt={alt} className="max-h-full max-w-full object-contain" />
      ) : (
        <span className="text-[10px] text-white/30">no img</span>
      )}
    </div>
  );
}

function UploadButton({ onFile, disabled, label }: { onFile: (file: File) => void; disabled?: boolean; label: string }) {
  return (
    <label className={`cursor-pointer rounded-md bg-white/5 px-3 py-1.5 text-xs hover:bg-white/10 ${disabled ? 'pointer-events-none opacity-50' : ''}`}>
      {label}
      <input
        type="file"
        accept="image/png,image/jpeg,image/webp,image/svg+xml"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = '';
        }}
      />
    </label>
  );
}

function CharCreateModal({
  open,
  onClose,
  onDone,
  setErr,
}: {
  open: boolean;
  onClose: () => void;
  onDone: () => Promise<void>;
  setErr: (s: string | null) => void;
}) {
  const [slug, setSlug] = useState('');
  const [name, setName] = useState('');
  const [hp, setHp] = useState('100');
  const [speed, setSpeed] = useState('220');
  const [damage, setDamage] = useState('20');
  const [weaponType, setWeaponType] = useState('ranged');
  const [abilityType, setAbilityType] = useState('dash');
  const [cd, setCd] = useState('8');
  const [priceUsd, setPriceUsd] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    setSubmitting(true);
    try {
      await api.post('/admin/characters', {
        slug: slug.trim(),
        name: name.trim(),
        baseHp: parseInt(hp, 10),
        baseSpeed: parseFloat(speed),
        baseDamage: parseInt(damage, 10),
        weaponType: weaponType.trim() || 'ranged',
        abilityType: abilityType.trim() || null,
        abilityCooldownS: parseInt(cd, 10) || 0,
        priceUsd: priceUsd.trim() === '' ? null : priceUsd.trim(),
      });
      setSlug(''); setName('');
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
      title="New character"
      footer={
        <>
          <GhostButton onClick={onClose}>Cancel</GhostButton>
          <PrimaryButton onClick={submit} disabled={submitting || !slug.trim() || !name.trim()}>
            {submitting ? 'creating…' : 'Create'}
          </PrimaryButton>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Slug"><input className={inputCls} value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="sniper" /></Field>
        <Field label="Name"><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="Снайпер" /></Field>
        <Field label="HP"><input className={inputCls} value={hp} onChange={(e) => setHp(e.target.value)} type="number" /></Field>
        <Field label="Speed"><input className={inputCls} value={speed} onChange={(e) => setSpeed(e.target.value)} type="number" step="0.1" /></Field>
        <Field label="Damage"><input className={inputCls} value={damage} onChange={(e) => setDamage(e.target.value)} type="number" /></Field>
        <Field label="Weapon type"><input className={inputCls} value={weaponType} onChange={(e) => setWeaponType(e.target.value)} /></Field>
        <Field label="Ability"><input className={inputCls} value={abilityType} onChange={(e) => setAbilityType(e.target.value)} placeholder="dash" /></Field>
        <Field label="Cooldown (s)"><input className={inputCls} value={cd} onChange={(e) => setCd(e.target.value)} type="number" /></Field>
        <Field label="Price (USD, empty = free)"><input className={inputCls} value={priceUsd} onChange={(e) => setPriceUsd(e.target.value)} placeholder="0.00" /></Field>
      </div>
      <p className="mt-2 text-xs text-white/40">After creating, click “Sprite” on the row to upload the character image.</p>
    </Modal>
  );
}

function WeaponCreateModal({
  open,
  onClose,
  onDone,
  setErr,
}: {
  open: boolean;
  onClose: () => void;
  onDone: () => Promise<void>;
  setErr: (s: string | null) => void;
}) {
  const [slug, setSlug] = useState('');
  const [name, setName] = useState('');
  const [damage, setDamage] = useState('20');
  const [rof, setRof] = useState('300');
  const [bulletSpeed, setBulletSpeed] = useState('600');
  const [priceUsd, setPriceUsd] = useState('');
  const [isStarter, setIsStarter] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    setSubmitting(true);
    try {
      await api.post('/admin/weapons', {
        slug: slug.trim(),
        name: name.trim(),
        damage: parseInt(damage, 10) || 20,
        fireRateMs: parseInt(rof, 10) || 300,
        bulletSpeed: parseFloat(bulletSpeed) || 600,
        priceUsd: priceUsd.trim() === '' ? null : priceUsd.trim(),
        isStarter,
      });
      setSlug(''); setName('');
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
      title="New weapon"
      footer={
        <>
          <GhostButton onClick={onClose}>Cancel</GhostButton>
          <PrimaryButton onClick={submit} disabled={submitting || !slug.trim() || !name.trim()}>
            {submitting ? 'creating…' : 'Create'}
          </PrimaryButton>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Slug"><input className={inputCls} value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="shotgun" /></Field>
        <Field label="Name"><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="Shotgun" /></Field>
        <Field label="Damage"><input className={inputCls} value={damage} onChange={(e) => setDamage(e.target.value)} type="number" /></Field>
        <Field label="Fire rate (ms)"><input className={inputCls} value={rof} onChange={(e) => setRof(e.target.value)} type="number" /></Field>
        <Field label="Bullet speed"><input className={inputCls} value={bulletSpeed} onChange={(e) => setBulletSpeed(e.target.value)} type="number" /></Field>
        <Field label="Price (USD, empty = free)"><input className={inputCls} value={priceUsd} onChange={(e) => setPriceUsd(e.target.value)} placeholder="0.00" /></Field>
        <Field label="Starter (auto-granted)">
          <label className="inline-flex items-center gap-2 text-sm">
            <input type="checkbox" checked={isStarter} onChange={(e) => setIsStarter(e.target.checked)} />
            <span>Yes</span>
          </label>
        </Field>
      </div>
      <p className="mt-2 text-xs text-white/40">After creating, click “Sprite” on the row to upload the weapon image.</p>
    </Modal>
  );
}

function WeaponEditModal({
  weapon,
  onClose,
  onDone,
  setErr,
}: {
  weapon: Weapon | null;
  onClose: () => void;
  onDone: () => Promise<void>;
  setErr: (s: string | null) => void;
}) {
  const [name, setName] = useState('');
  const [damage, setDamage] = useState('');
  const [rof, setRof] = useState('');
  const [bulletSpeed, setBulletSpeed] = useState('');
  const [priceUsd, setPriceUsd] = useState('');
  const [isStarter, setIsStarter] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (weapon) {
      setName(weapon.name);
      setDamage(String(weapon.damage));
      setRof(String(weapon.fireRateMs));
      setBulletSpeed(String(weapon.bulletSpeed));
      setPriceUsd(weapon.priceUsd ?? '');
      setIsStarter(weapon.isStarter);
    }
  }, [weapon]);

  async function submit() {
    if (!weapon) return;
    setSubmitting(true);
    try {
      await api.patch(`/admin/weapons/${weapon.id}`, {
        name,
        damage: parseInt(damage, 10),
        fireRateMs: parseInt(rof, 10),
        bulletSpeed: parseFloat(bulletSpeed),
        priceUsd: priceUsd.trim() === '' ? null : priceUsd.trim(),
        isStarter,
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
      open={!!weapon}
      onClose={onClose}
      title={weapon ? `Edit · ${weapon.name}` : ''}
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
        <Field label="Name"><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Damage"><input className={inputCls} value={damage} onChange={(e) => setDamage(e.target.value)} type="number" /></Field>
        <Field label="Fire rate (ms)"><input className={inputCls} value={rof} onChange={(e) => setRof(e.target.value)} type="number" /></Field>
        <Field label="Bullet speed"><input className={inputCls} value={bulletSpeed} onChange={(e) => setBulletSpeed(e.target.value)} type="number" /></Field>
        <Field label="Price (USD, empty = free)"><input className={inputCls} value={priceUsd} onChange={(e) => setPriceUsd(e.target.value)} /></Field>
        <Field label="Starter">
          <label className="inline-flex items-center gap-2 text-sm">
            <input type="checkbox" checked={isStarter} onChange={(e) => setIsStarter(e.target.checked)} />
            <span>Yes</span>
          </label>
        </Field>
      </div>
    </Modal>
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
