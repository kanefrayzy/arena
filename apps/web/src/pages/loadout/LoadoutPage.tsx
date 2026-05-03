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
  priceCoin: number | null;
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
  skins: Skin[];
}

interface Inventory {
  skins: Array<{ skinId: number; characterId: number }>;
}

interface Loadout {
  characterId: number;
  skinId: number;
}

export function LoadoutPage() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const [characters, setCharacters] = useState<Character[]>([]);
  const [inventory, setInventory] = useState<Inventory | null>(null);
  const [loadout, setLoadout] = useState<Loadout | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [activeCharId, setActiveCharId] = useState<number | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const [c, inv, ld] = await Promise.all([
          api.get<{ characters: Character[] }>('/characters'),
          api.get<Inventory>('/inventory/me'),
          api.get<Loadout>('/loadout/me'),
        ]);
        setCharacters(c.characters);
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

  const activeChar = characters.find((c) => c.id === activeCharId) ?? null;

  async function pick(characterId: number, skinId: number) {
    setError(null);
    setSaving(true);
    try {
      const ld = await api.put<Loadout>('/loadout/me', { characterId, skinId });
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
          {characters.map((c) => {
            const isActive = c.id === activeCharId;
            const isEquipped = loadout?.characterId === c.id;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => setActiveCharId(c.id)}
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
              <div className="mb-2 flex items-center justify-between">
                <span className="font-semibold">{activeChar.name}</span>
                <span className="text-xs text-white/50">{activeChar.weaponType}</span>
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

            {/* Skin grid */}
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
                    <div className="text-xs text-white/50">{s.rarity}</div>
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
          </>
        )}

        {error && <div className="text-sm text-red-400">{error}</div>}
      </main>
    </div>
  );
}
