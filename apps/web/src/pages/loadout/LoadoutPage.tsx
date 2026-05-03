import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../../shared/api/client';

interface Skin {
  id: number;
  characterId: number;
  name: string;
  rarity: string;
  tint: string | null;
  statModifiers: Record<string, number> | null;
  priceUsd: string | null;
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
  spriteUrl: string | null;
  isStarter: boolean;
  skins: Skin[];
}

interface Inventory {
  skins: Array<{ skinId: number; characterId: number }>;
  characters?: Array<{ characterId: number }>;
  weapons?: Array<{ weaponId: number }>;
}

interface Loadout {
  characterId: number;
  skinId: number;
  weaponId: number | null;
}

interface Weapon {
  id: number;
  name: string;
  spriteUrl: string | null;
  priceUsd: string | null;
  isStarter: boolean;
}

export function LoadoutPage() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const [characters, setCharacters] = useState<Character[]>([]);
  const [weapons, setWeapons] = useState<Weapon[]>([]);
  const [inventory, setInventory] = useState<Inventory | null>(null);
  const [loadout, setLoadout] = useState<Loadout | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [activeCharId, setActiveCharId] = useState<number | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const [c, w, inv, ld] = await Promise.all([
          api.get<{ characters: Character[] }>('/characters'),
          api.get<{ weapons: Weapon[] }>('/weapons'),
          api.get<Inventory>('/inventory/me'),
          api.get<Loadout>('/loadout/me'),
        ]);
        setCharacters(c.characters);
        setWeapons(w.weapons);
        setInventory(inv);
        setLoadout(ld);
        setActiveCharId(ld.characterId);
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) nav('/');
        else setError(e instanceof Error ? e.message : 'load failed');
      }
    })();
  }, [nav]);

  const ownedSkinIds = useMemo(
    () => new Set((inventory?.skins ?? []).map((s) => s.skinId)),
    [inventory],
  );
  const ownedWeaponIds = useMemo(
    () => new Set((inventory?.weapons ?? []).map((w) => w.weaponId)),
    [inventory],
  );
  const ownedCharIds = useMemo(
    () => new Set((inventory?.characters ?? []).map((c) => c.characterId)),
    [inventory],
  );

  // Only characters that are starter OR explicitly purchased.
  const myCharacters = useMemo(
    () => characters.filter((c) => c.isStarter || ownedCharIds.has(c.id)),
    [characters, ownedCharIds],
  );
  // Only weapons that are starter OR purchased.
  const myWeapons = useMemo(
    () => weapons.filter((w) => w.isStarter || ownedWeaponIds.has(w.id)),
    [weapons, ownedWeaponIds],
  );

  const activeChar = myCharacters.find((c) => c.id === activeCharId) ?? myCharacters[0] ?? null;

  async function pick(characterId: number, skinId: number) {
    setError(null);
    setSaving(true);
    try {
      const ld = await api.put<Loadout>('/loadout/me', {
        characterId,
        skinId,
        weaponId: loadout?.weaponId ?? null,
      });
      setLoadout(ld);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'save failed');
    } finally {
      setSaving(false);
    }
  }

  async function pickCharacter(characterId: number) {
    setActiveCharId(characterId);
    if (loadout?.characterId === characterId) return;
    setError(null);
    setSaving(true);
    try {
      // Send only characterId; backend auto-selects an appropriate skin.
      const ld = await api.put<Loadout>('/loadout/me', { characterId });
      setLoadout(ld);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'save failed');
    } finally {
      setSaving(false);
    }
  }

  async function pickWeapon(weaponId: number) {
    if (!loadout) return;
    setError(null);
    setSaving(true);
    try {
      const ld = await api.put<Loadout>('/loadout/me', {
        characterId: loadout.characterId,
        skinId: loadout.skinId,
        weaponId,
      });
      setLoadout(ld);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-white/10 px-5 py-3">
        <button
          type="button"
          onClick={() => nav('/home')}
          className="rounded px-2 py-1 text-sm text-white/70 hover:bg-white/10"
        >
          ← {t('loadout.back')}
        </button>
        <h2 className="text-lg font-semibold">{t('loadout.title')}</h2>
        <button
          type="button"
          onClick={() => nav('/shop')}
          className="rounded px-2 py-1 text-sm text-white/70 hover:bg-white/10"
        >
          {t('loadout.shop')}
        </button>
      </header>

      <main className="flex flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
        {/* Character tabs */}
        <div className="flex gap-2 overflow-x-auto">
          {myCharacters.map((c) => {
            const isActive = c.id === activeCharId;
            const isEquipped = loadout?.characterId === c.id;
            return (
              <button
                key={c.id}
                type="button"
                disabled={saving}
                onClick={() => void pickCharacter(c.id)}
                className={
                  'shrink-0 rounded-lg px-4 py-2 text-sm transition ' +
                  (isActive
                    ? 'bg-accent text-bg'
                    : 'bg-surface text-white/70 hover:bg-white/10')
                }
              >
                {c.name}
                {isEquipped && <span className="ml-1">★</span>}
              </button>
            );
          })}
        </div>

        {activeChar && (
          <>
            {/* Stats panel */}
            <div className="rounded-lg bg-surface px-4 py-3 text-sm">
              <div className="mb-2 flex items-center gap-3">
                <div className="flex h-14 w-14 items-center justify-center rounded-md bg-black/40">
                  {activeChar.spriteUrl ? (
                    <img
                      src={activeChar.spriteUrl}
                      alt={activeChar.name}
                      className="max-h-full max-w-full object-contain"
                    />
                  ) : (
                    <div className="h-8 w-8 rounded-full bg-white/20" />
                  )}
                </div>
                <div className="flex-1">
                  <div className="font-semibold">{activeChar.name}</div>
                  <div className="text-xs text-white/50">{activeChar.weaponType}</div>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 text-xs text-white/70">
                <div>
                  <div className="text-white/40">HP</div>
                  <div className="font-mono text-white">{activeChar.baseHp}</div>
                </div>
                <div>
                  <div className="text-white/40">{t('loadout.speed')}</div>
                  <div className="font-mono text-white">{activeChar.baseSpeed}</div>
                </div>
                <div>
                  <div className="text-white/40">{t('loadout.damage')}</div>
                  <div className="font-mono text-white">{activeChar.baseDamage}</div>
                </div>
              </div>
              {activeChar.abilityType && (
                <div className="mt-2 text-xs text-white/50">
                  {t('loadout.ability')}: {activeChar.abilityType} ({activeChar.abilityCooldownS}s)
                </div>
              )}
            </div>

            {/* Skin grid — only when more than one skin exists */}
            {activeChar.skins.length > 1 && (
              <div className="grid grid-cols-2 gap-3">
                {activeChar.skins.map((s) => {
                  const owned = ownedSkinIds.has(s.id);
                  const equipped = loadout?.skinId === s.id;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      disabled={!owned || saving}
                      onClick={() => void pick(activeChar.id, s.id)}
                      className={
                        'relative flex flex-col items-center justify-end rounded-lg border-2 p-3 text-sm transition ' +
                        (equipped
                          ? 'border-accent bg-accent/10'
                          : owned
                            ? 'border-white/20 bg-surface hover:border-white/40'
                            : 'border-white/5 bg-surface/40 opacity-60')
                      }
                    >
                      <div
                        className="mb-2 h-16 w-16 rounded-full"
                        style={{ backgroundColor: s.tint ?? '#888' }}
                      />
                      <div className="font-medium">{s.name}</div>
                      {equipped && (
                        <div className="absolute right-2 top-2 rounded bg-accent px-1.5 py-0.5 text-[10px] font-bold text-bg">
                          {t('loadout.equipped')}
                        </div>
                      )}
                      {!owned && (
                        <div className="absolute right-2 top-2 rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-white/60">
                          🔒
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </>
        )}

        {error && <div className="text-sm text-red-400">{error}</div>}

        {/* Weapons */}
        <div className="mt-2 rounded-lg bg-surface px-4 py-3">
          <div className="mb-2 text-sm font-semibold">{t('loadout.weapon')}</div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {myWeapons.length === 0 && (
              <div className="col-span-full text-xs text-white/50">{t('loadout.no_weapons')}</div>
            )}
            {myWeapons.map((w) => {
              const owned = true;
              const equipped = loadout?.weaponId === w.id;
              return (
                <button
                  key={w.id}
                  type="button"
                  disabled={!owned || saving}
                  onClick={() => void pickWeapon(w.id)}
                  className={
                    'relative flex flex-col items-center justify-end rounded-lg border-2 p-3 text-sm transition ' +
                    (equipped
                      ? 'border-accent bg-accent/10'
                      : owned
                        ? 'border-white/20 bg-bg/40 hover:border-white/40'
                        : 'border-white/5 bg-bg/20 opacity-60')
                  }
                >
                  <div className="mb-2 flex h-12 w-12 items-center justify-center">
                    {w.spriteUrl ? (
                      <img src={w.spriteUrl} alt={w.name} className="max-h-full max-w-full object-contain" />
                    ) : (
                      <div className="h-8 w-8 rounded bg-white/20" />
                    )}
                  </div>
                  <div className="font-medium">{w.name}</div>
                  {equipped && (
                    <div className="absolute right-2 top-2 rounded bg-accent px-1.5 py-0.5 text-[10px] font-bold text-bg">
                      {t('loadout.equipped')}
                    </div>
                  )}
                  {!owned && (
                    <div className="absolute right-2 top-2 rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-white/60">
                      🔒
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </main>
    </div>
  );
}
