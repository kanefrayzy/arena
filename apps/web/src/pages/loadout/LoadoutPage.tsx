import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../../shared/api/client';

interface AbilityInfo {
  name: string;
  description: string;
  type: string;
  cooldownMs: number;
  iconUrl: string | null;
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
  ability: AbilityInfo | null;
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
    <div className="relative flex h-full flex-col overflow-hidden">
      <div className="pointer-events-none absolute -top-32 -right-20 h-72 w-72 rounded-full bg-game-purple/40 blur-3xl" />

      <header className="game-panel relative z-10 flex items-center justify-between px-4 py-3">
        <button
          type="button"
          onClick={() => nav('/home')}
          className="game-btn game-btn-ghost game-btn-sm"
        >
          ← {t('loadout.back')}
        </button>
        <h2 className="game-title text-xl text-game-yellow">{t('loadout.title')}</h2>
        <button
          type="button"
          onClick={() => nav('/shop')}
          className="game-btn game-btn-pink game-btn-sm"
        >
          {t('loadout.shop')}
        </button>
      </header>

      <main className="relative z-10 flex flex-1 flex-col gap-4 overflow-y-auto px-5 py-5">
        {myCharacters.length === 0 && (
          <div className="game-card px-4 py-10 text-center font-display text-base text-white/70">
            {t('loadout.empty')}
          </div>
        )}

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {myCharacters.map((c) => {
            const equipped = loadout?.characterId === c.id;
            return (
              <button
                key={c.id}
                type="button"
                disabled={saving}
                onClick={() => void pickCharacter(c.id)}
                className={
                  'game-card game-card-hover relative flex flex-col items-center gap-2 p-3 text-sm transition disabled:opacity-60 ' +
                  (equipped ? 'game-card-active' : '')
                }
              >
                <div className="relative flex h-28 w-28 items-center justify-center overflow-hidden rounded-2xl bg-black/40">
                  <div className="absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/10 to-transparent" />
                  {/* ground shadow */}
                  <div className="absolute bottom-2 left-1/2 h-2 w-16 -translate-x-1/2 rounded-full bg-black/50 blur-sm" />
                  {c.spriteUrl ? (
                    /\.webm(\?|$)/i.test(c.spriteUrl) ? (
                      <video
                        src={c.spriteUrl}
                        autoPlay loop muted playsInline
                        className="relative max-h-[88%] max-w-[88%] animate-float object-contain drop-shadow-[0_4px_4px_rgba(0,0,0,0.5)]"
                      />
                    ) : (
                      <img
                        src={c.spriteUrl}
                        alt={c.name}
                        className="relative max-h-[88%] max-w-[88%] animate-float object-contain drop-shadow-[0_4px_4px_rgba(0,0,0,0.5)]"
                      />
                    )
                  ) : (
                    <div className="relative h-14 w-14 animate-float rounded-full bg-white/20" />
                  )}
                </div>
                <div className="font-display text-base uppercase tracking-wide text-white">
                  {c.name}
                </div>
                <div className="grid w-full grid-cols-3 gap-1 text-[10px]">
                  <Stat label="HP" value={c.baseHp} color="text-game-red" />
                  <Stat label={t('loadout.speed')} value={c.baseSpeed} color="text-game-cyan" />
                  <Stat label={t('loadout.damage')} value={c.baseDamage} color="text-game-yellow" />
                </div>
                {c.ability && (
                  <div className="mt-0.5 flex w-full items-center gap-1.5 rounded-lg bg-black/30 px-2 py-1.5">
                    {c.ability.iconUrl ? (
                      <img src={c.ability.iconUrl} className="h-5 w-5 flex-shrink-0 rounded-full object-cover" alt="" />
                    ) : (
                      <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-game-purple text-[9px] font-bold text-white">Q</span>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[10px] font-bold uppercase tracking-wide text-game-purple">{c.ability.name}</div>
                      {c.ability.description && (
                        <div className="line-clamp-1 text-[9px] text-white/50">{c.ability.description}</div>
                      )}
                    </div>
                    <div className="flex-shrink-0 text-[9px] text-white/40">{Math.round(c.ability.cooldownMs / 1000)}s</div>
                  </div>
                )}
                {equipped && (
                  <div className="absolute -top-2 right-2 rounded-full bg-game-yellow px-2 py-0.5 text-[10px] font-bold uppercase text-[#1a1450] shadow-[0_2px_0_#b88200]">
                    {t('loadout.equipped')}
                  </div>
                )}
              </button>
            );
          })}
        </div>

        {error && (
          <div className="text-center text-sm font-semibold text-game-red">{error}</div>
        )}
      </main>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="rounded-lg bg-black/30 px-1 py-1 text-center">
      <div className="text-[9px] uppercase text-white/50">{label}</div>
      <div className={`font-display text-sm ${color}`}>{value}</div>
    </div>
  );
}
