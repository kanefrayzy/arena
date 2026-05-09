import { useEffect, useState } from 'react';
import { api } from '../../../shared/api/client';
import { Modal, PrimaryButton, GhostButton, Field, inputCls } from '../components/Modal';

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
  abilityId: number | null;
  isActive: boolean;
  spriteUrl: string | null;
  battleSpriteUrl: string | null;
  bulletSpriteUrl: string | null;
  priceUsd: string | null;
  isStarter: boolean;
  skins: Skin[];
  ability?: { id: number; name: string; type: string; iconUrl: string | null } | null;
}

interface Ability {
  id: number;
  slug: string;
  name: string;
  type: string;
  iconUrl: string | null;
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

export function ContentTab() {
  const [chars, setChars] = useState<Character[]>([]);
  const [weapons, setWeapons] = useState<Weapon[]>([]);
  const [abilities, setAbilities] = useState<Ability[]>([]);
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
      const [r, w, ab] = await Promise.all([
        api.get<{ characters: Character[] }>('/characters'),
        api.get<{ weapons: Weapon[] }>('/weapons'),
        api.get<{ abilities: Ability[] }>('/admin/abilities'),
      ]);
      setChars(r.characters);
      setWeapons(w.weapons);
      setAbilities(ab.abilities);
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

  async function uploadCharBattleSprite(c: Character, file: File) {
    setBusy(`cb${c.id}`);
    try {
      const fd = new FormData();
      fd.append('file', file);
      await api.postForm(`/admin/characters/${c.id}/battle-sprite`, fd);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'upload failed');
    } finally {
      setBusy(null);
    }
  }

  async function uploadCharBulletSprite(c: Character, file: File) {
    setBusy(`cbull${c.id}`);
    try {
      const fd = new FormData();
      fd.append('file', file);
      await api.postForm(`/admin/characters/${c.id}/bullet-sprite`, fd);
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

      <div className="grid gap-3 lg:grid-cols-2">
        {chars.map((c) => (
          <div key={c.id} className="rounded-lg border border-white/10 bg-surface">
            {/* Header row */}
            <div className="flex items-center gap-3 px-4 py-3">
              <SpriteCell url={c.spriteUrl} alt={c.name} />
              <div className="flex-1 min-w-0">
                <div className="font-semibold">{c.name}</div>
                <div className="text-xs text-white/40">
                  /{c.slug} · {c.weaponType}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setEditChar(c)}
                className="rounded-md bg-accent/20 px-3 py-1.5 text-xs font-semibold text-accent hover:bg-accent/30"
              >
                Edit
              </button>
            </div>

            {/* Stats row */}
            <div className="grid grid-cols-4 border-t border-white/10">
              <StatCell label="HP" value={c.baseHp} color="text-red-400" />
              <StatCell label="Speed" value={c.baseSpeed} color="text-cyan-400" />
              <StatCell label="Damage" value={c.baseDamage} color="text-yellow-400" />
              <StatCell
                label="Price"
                value={c.priceUsd ? `$${c.priceUsd}` : c.isStarter ? 'starter' : 'free'}
                color="text-green-400"
                mono={false}
              />
            </div>

            {/* Sprite upload row */}
            <div className="flex items-center gap-2 border-t border-white/10 px-3 py-2">
              <span className="text-[10px] uppercase tracking-wide text-white/40 mr-1">Sprites</span>
              <UploadButton onFile={(f) => void uploadCharSprite(c, f)} disabled={busy === `c${c.id}`} label="Idle" accept="image/png,image/jpeg,image/webp,image/svg+xml,image/gif,video/webm" />
              <UploadButton onFile={(f) => void uploadCharBattleSprite(c, f)} disabled={busy === `cb${c.id}`} label="Battle" />
              <UploadButton onFile={(f) => void uploadCharBulletSprite(c, f)} disabled={busy === `cbull${c.id}`} label="Bullet" accept="image/png,image/jpeg,image/webp,image/svg+xml,image/gif,video/webm" />
              {c.spriteUrl && <SpritePreviewThumb url={c.spriteUrl} />}
              {c.battleSpriteUrl && <SpritePreviewThumb url={c.battleSpriteUrl} />}
              {c.bulletSpriteUrl && <SpritePreviewThumb url={c.bulletSpriteUrl} />}
            </div>

            {/* Ability badge */}
            <div className="flex items-center gap-2 border-t border-white/10 px-3 py-2">
              <span className="text-[10px] uppercase tracking-wide text-white/40 mr-1">Ability</span>
              {c.ability ? (
                <>
                  {c.ability.iconUrl ? (
                    <img src={c.ability.iconUrl} className="h-6 w-6 rounded-full object-cover ring-1 ring-accent/30" alt="" />
                  ) : (
                    <div className="flex h-6 w-6 items-center justify-center rounded-full bg-accent/20 text-[10px] font-bold text-accent">Q</div>
                  )}
                  <span className="text-sm font-medium text-white/80">{c.ability.name}</span>
                  <span className="text-xs text-white/40">({c.ability.type})</span>
                </>
              ) : (
                <span className="text-xs text-white/30">none</span>
              )}
            </div>
          </div>
        ))}
      </div>

      <CharEditModal
        char={editChar}
        abilities={abilities}
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
        abilities={abilities}
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

function StatCell({ label, value, color, mono = true }: { label: string; value: string | number; color: string; mono?: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center gap-0.5 py-3 px-2 border-r border-white/5 last:border-r-0">
      <span className="text-[9px] uppercase tracking-widest text-white/40">{label}</span>
      <span className={`${mono ? 'font-mono tabular-nums' : ''} text-sm font-bold ${color}`}>{value}</span>
    </div>
  );
}

function SpritePreviewThumb({ url }: { url: string }) {
  const isWebm = (url.split('?')[0] ?? '').toLowerCase().endsWith('.webm');
  return (
    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-black/40 ring-1 ring-white/10">
      {isWebm
        ? <video src={url} autoPlay loop muted playsInline className="max-h-full max-w-full object-contain" />
        : <img src={url} alt="" className="max-h-full max-w-full object-contain" />
      }
    </div>
  );
}

function SpriteCell({ url, alt }: { url: string | null; alt: string }) {
  const isWebm = (url?.split('?')[0] ?? '').toLowerCase().endsWith('.webm');
  return (
    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-black/40">
      {url ? (
        isWebm ? (
          <video src={url} autoPlay loop muted playsInline className="max-h-full max-w-full object-contain" />
        ) : (
          <img src={url} alt={alt} className="max-h-full max-w-full object-contain" />
        )
      ) : (
        <span className="text-[10px] text-white/30">no img</span>
      )}
    </div>
  );
}

function UploadButton({ onFile, disabled, label, accept }: { onFile: (file: File) => void; disabled?: boolean; label: string; accept?: string }) {
  const acceptStr = accept ?? 'image/png,image/jpeg,image/webp,image/svg+xml';
  return (
    <label className={`cursor-pointer rounded-md bg-white/5 px-3 py-1.5 text-xs hover:bg-white/10 ${disabled ? 'pointer-events-none opacity-50' : ''}`}>
      {label}
      <input
        type="file"
        accept={acceptStr}
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
  abilities,
  onClose,
  onDone,
  setErr,
}: {
  open: boolean;
  abilities: Ability[];
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
  const [abilityId, setAbilityId] = useState('');
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
        abilityId: abilityId ? parseInt(abilityId, 10) : null,
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
        <Field label="Ability" className="col-span-2">
          <select className={inputCls} value={abilityId} onChange={(e) => setAbilityId(e.target.value)}>
            <option value="">— none —</option>
            {abilities.map((a) => (
              <option key={a.id} value={String(a.id)}>{a.name} ({a.type})</option>
            ))}
          </select>
        </Field>
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

function CharEditModal({
  char,
  abilities,
  onClose,
  onDone,
  setErr,
}: {
  char: Character | null;
  abilities: Ability[];
  onClose: () => void;
  onDone: () => Promise<void>;
  setErr: (s: string | null) => void;
}) {
  const [name, setName] = useState('');
  const [hp, setHp] = useState('');
  const [speed, setSpeed] = useState('');
  const [damage, setDamage] = useState('');
  const [priceUsd, setPriceUsd] = useState('');
  const [abilityId, setAbilityId] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (char) {
      setName(char.name);
      setHp(String(char.baseHp));
      setSpeed(String(char.baseSpeed));
      setDamage(String(char.baseDamage));
      setPriceUsd(char.priceUsd ?? '');
      setAbilityId(char.abilityId != null ? String(char.abilityId) : '');
      setConfirmDelete(false);
    }
  }, [char]);

  async function submit() {
    if (!char) return;
    setSubmitting(true);
    try {
      await api.patch(`/admin/characters/${char.id}`, {
        name: name.trim(),
        baseHp: parseInt(hp, 10),
        baseSpeed: parseFloat(speed),
        baseDamage: parseInt(damage, 10),
        priceUsd: priceUsd.trim() === '' ? null : priceUsd.trim(),
        abilityId: abilityId ? parseInt(abilityId, 10) : null,
      });
      await onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'failed');
    } finally {
      setSubmitting(false);
    }
  }

  async function deleteChar() {
    if (!char) return;
    setSubmitting(true);
    try {
      await api.delete(`/admin/characters/${char.id}`);
      await onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'failed');
    } finally {
      setSubmitting(false);
      setConfirmDelete(false);
    }
  }

  const selectedAbility = abilities.find((a) => String(a.id) === abilityId);

  return (
    <Modal
      open={!!char}
      onClose={onClose}
      title={char ? `Edit · ${char.name}` : ''}
      footer={
        <div className="flex w-full items-center justify-between">
          {!confirmDelete ? (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="rounded-md bg-red-500/15 px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/30"
            >
              Delete character
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-xs text-red-400">Sure?</span>
              <button
                type="button"
                onClick={() => void deleteChar()}
                disabled={submitting}
                className="rounded-md bg-red-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-600 disabled:opacity-40"
              >
                Yes, delete
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="rounded-md bg-white/10 px-3 py-1.5 text-xs text-white/70 hover:bg-white/15"
              >
                Cancel
              </button>
            </div>
          )}
          <div className="flex gap-2">
            <GhostButton onClick={onClose}>Cancel</GhostButton>
            <PrimaryButton onClick={() => void submit()} disabled={submitting || !name.trim()}>
              {submitting ? 'saving…' : 'Save'}
            </PrimaryButton>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        {/* Name + Price row */}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name">
            <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </Field>
          <Field label="Price USD (empty = free)">
            <input className={inputCls} value={priceUsd} onChange={(e) => setPriceUsd(e.target.value)} placeholder="0.00" />
          </Field>
        </div>

        {/* Stats row — big number inputs */}
        <div className="grid grid-cols-3 gap-3">
          <Field label="HP">
            <div className="relative">
              <input className={inputCls + ' pr-8'} value={hp} onChange={(e) => setHp(e.target.value)} type="number" min="1" />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-red-400">HP</span>
            </div>
          </Field>
          <Field label="Speed">
            <div className="relative">
              <input className={inputCls + ' pr-10'} value={speed} onChange={(e) => setSpeed(e.target.value)} type="number" step="1" min="1" />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-cyan-400">spd</span>
            </div>
          </Field>
          <Field label="Damage">
            <div className="relative">
              <input className={inputCls + ' pr-8'} value={damage} onChange={(e) => setDamage(e.target.value)} type="number" min="0" />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-yellow-400">dmg</span>
            </div>
          </Field>
        </div>

        {/* Ability selector */}
        <Field label="Ability (Q button)">
          <select className={inputCls} value={abilityId} onChange={(e) => setAbilityId(e.target.value)}>
            <option value="">— none —</option>
            {abilities.map((a) => (
              <option key={a.id} value={String(a.id)}>{a.name} ({a.type})</option>
            ))}
          </select>
        </Field>

        {/* Preview of selected ability */}
        {selectedAbility && (
          <div className="flex items-center gap-3 rounded-lg border border-white/10 bg-black/20 px-3 py-2.5">
            {selectedAbility.iconUrl ? (
              <img src={selectedAbility.iconUrl} className="h-9 w-9 rounded-full object-cover ring-2 ring-accent/40" alt="" />
            ) : (
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-accent/20 text-sm font-bold text-accent">Q</div>
            )}
            <div>
              <div className="text-sm font-semibold text-white">{selectedAbility.name}</div>
              <div className="text-xs text-white/50">{selectedAbility.type} · {Math.round((char?.abilityId === selectedAbility.id ? 8000 : 8000) / 1000)}s cooldown</div>
            </div>
          </div>
        )}
        {!selectedAbility && (
          <div className="rounded-lg border border-dashed border-white/10 px-3 py-2 text-center text-xs text-white/30">
            No ability assigned — Q button will be hidden
          </div>
        )}
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
