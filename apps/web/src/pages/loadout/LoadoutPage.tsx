import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../../shared/api/client';

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
}

interface Inventory {
  characters?: Array<{ characterId: number }>;
}

interface Loadout {
  characterId: number;
  skinId: number;
  weaponId: number | null;
}

export function LoadoutPage() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const [characters, setCharacters] = useState<Character[]>([]);
  const [inventory, setInventory] = useState<Inventory | null>(null);
  const [loadout, setLoadout] = useState<Loadout | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

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
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) nav('/');
        else setError(e instanceof Error ? e.message : 'load failed');
      }
    })();
  }, [nav]);

  const ownedCharIds = useMemo(
    () => new Set((inventory?.characters ?? []).map((c) => c.characterId)),
    [inventory],
  );

  // Only characters the user can use: starter or purchased.
  const myCharacters = useMemo(
    () => characters.filter((c) => c.isStarter || ownedCharIds.has(c.id)),
    [characters, ownedCharIds],
  );

  async function pickCharacter(characterId: number) {
    if (loadout?.characterId === characterId) return;
    setError(null);
    setSaving(true);
    try {
      const ld = await api.put<Loadout>('/loadout/me', { characterId });
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
        {myCharacters.length === 0 && (
          <div className="rounded-lg bg-surface px-4 py-8 text-center text-sm text-white/60">
            {t('loadout.empty')}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {myCharacters.map((c) => {
            const equipped = loadout?.characterId === c.id;
            return (
              <button
                key={c.id}
                type="button"
                disabled={saving}
                onClick={() => void pickCharacter(c.id)}
                className={
                  'relative flex flex-col items-center gap-2 rounded-lg border-2 p-3 text-sm transition disabled:opacity-60 ' +
                  (equipped
                    ? 'border-accent bg-accent/10'
                    : 'border-white/10 bg-surface hover:border-white/30')
                }
              >
                <div className="flex h-24 w-24 items-center justify-center rounded-md bg-black/40">
                  {c.spriteUrl ? (
                    <img
                      src={c.spriteUrl}
                      alt={c.name}
                      className="max-h-full max-w-full object-contain"
                    />
                  ) : (
                    <div className="h-12 w-12 rounded-full bg-white/20" />
                  )}
                </div>
                <div className="text-sm font-semibold">{c.name}</div>
                <div className="grid w-full grid-cols-3 gap-1 text-[10px] text-white/60">
                  <div className="text-center">
                    <div className="text-white/40">HP</div>
                    <div className="font-mono text-white">{c.baseHp}</div>
                  </div>
                  <div className="text-center">
                    <div className="text-white/40">{t('loadout.speed')}</div>
                    <div className="font-mono text-white">{c.baseSpeed}</div>
                  </div>
                  <div className="text-center">
                    <div className="text-white/40">{t('loadout.damage')}</div>
                    <div className="font-mono text-white">{c.baseDamage}</div>
                  </div>
                </div>
                {equipped && (
                  <div className="absolute right-2 top-2 rounded bg-accent px-1.5 py-0.5 text-[10px] font-bold text-bg">
                    {t('loadout.equipped')}
                  </div>
                )}
              </button>
            );
          })}
        </div>

        {error && <div className="text-center text-sm text-red-400">{error}</div>}
      </main>
    </div>
  );
}
