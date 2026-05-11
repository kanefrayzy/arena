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

  const [previewChar, setPreviewChar] = useState<Character | null>(null);

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
                onClick={() => setPreviewChar(c)}
                className={
                  'game-card game-card-hover relative flex flex-col items-center gap-2 p-3 text-sm transition ' +
                  (equipped ? 'game-card-active' : '')
                }
              >
                <div className="relative flex h-28 w-28 items-center justify-center overflow-hidden rounded-2xl bg-black/40">
                  <div className="absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/10 to-transparent" />
                  <div className="absolute bottom-2 left-1/2 h-2 w-16 -translate-x-1/2 rounded-full bg-black/50 blur-sm" />
                  {c.spriteUrl ? (
                    /\.webm(\?|$)/i.test(c.spriteUrl) ? (
                      <video src={c.spriteUrl} autoPlay loop muted playsInline className="relative max-h-[88%] max-w-[88%] animate-float object-contain drop-shadow-[0_4px_4px_rgba(0,0,0,0.5)]" />
                    ) : (
                      <img src={c.spriteUrl} alt={c.name} className="relative max-h-[88%] max-w-[88%] animate-float object-contain drop-shadow-[0_4px_4px_rgba(0,0,0,0.5)]" />
                    )
                  ) : (
                    <div className="relative h-14 w-14 animate-float rounded-full bg-white/20" />
                  )}
                </div>
                <div className="font-display text-base uppercase tracking-wide text-white">{c.name}</div>
                <div className="grid w-full grid-cols-3 gap-1 text-[10px]">
                  <Stat label="HP" value={c.baseHp} color="text-game-red" />
                  <Stat label={t('loadout.speed')} value={c.baseSpeed} color="text-game-cyan" />
                  <Stat label={t('loadout.damage')} value={c.baseDamage} color="text-game-yellow" />
                </div>
                {/* Ability icon badge */}
                {c.ability && (
                  <div className="flex w-full items-center gap-1.5 rounded-lg bg-black/30 px-2 py-1.5">
                    {c.ability.iconUrl ? (
                      <img src={c.ability.iconUrl} className="h-5 w-5 flex-shrink-0 rounded-full object-cover ring-1 ring-game-purple/50" alt="" />
                    ) : (
                      <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-game-purple text-[9px] font-bold text-white">Q</span>
                    )}
                    <span className="truncate text-[10px] font-bold uppercase tracking-wide text-game-purple">{c.ability.name}</span>
                    <span className="ml-auto flex-shrink-0 text-[9px] text-white/40">{Math.round(c.ability.cooldownMs / 1000)}s</span>
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

      {/* Character detail modal */}
      {previewChar && (
        <CharInfoModal
          char={previewChar}
          equipped={loadout?.characterId === previewChar.id}
          saving={saving}
          onEquip={async () => {
            await pickCharacter(previewChar.id);
            setPreviewChar(null);
          }}
          onClose={() => setPreviewChar(null)}
          t={t}
        />
      )}
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

function CharInfoModal({
  char,
  equipped,
  saving,
  onEquip,
  onClose,
  t,
}: {
  char: Character;
  equipped: boolean;
  saving: boolean;
  onEquip: () => Promise<void>;
  onClose: () => void;
  t: (key: string) => string;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center"
      onClick={onClose}
    >
      <div
        className="game-card relative w-full max-w-sm rounded-t-3xl sm:rounded-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Purple glow top */}
        <div className="pointer-events-none absolute -top-16 left-1/2 h-40 w-60 -translate-x-1/2 rounded-full bg-game-purple/30 blur-2xl" />

        {/* Close button */}
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-white/10 text-white/60 hover:bg-white/20"
        >
          ✕
        </button>

        {/* Sprite */}
        <div className="relative flex h-44 w-full items-end justify-center overflow-hidden bg-black/20">
          <div className="absolute bottom-0 left-1/2 h-6 w-32 -translate-x-1/2 rounded-full bg-black/40 blur-md" />
          {char.spriteUrl ? (
            /\.webm(\?|$)/i.test(char.spriteUrl) ? (
              <video src={char.spriteUrl} autoPlay loop muted playsInline className="relative mb-4 max-h-36 object-contain drop-shadow-[0_8px_8px_rgba(0,0,0,0.6)]" />
            ) : (
              <img src={char.spriteUrl} alt={char.name} className="relative mb-4 max-h-36 object-contain drop-shadow-[0_8px_8px_rgba(0,0,0,0.6)]" />
            )
          ) : (
            <div className="relative mb-8 h-20 w-20 rounded-full bg-white/20" />
          )}
        </div>

        {/* Content */}
        <div className="flex flex-col gap-4 px-5 py-5">
          <h3 className="text-center font-display text-2xl uppercase tracking-widest text-game-yellow">
            {char.name}
          </h3>

          {/* Stats */}
          <div className="grid grid-cols-3 gap-2">
            <Stat label="HP" value={char.baseHp} color="text-game-red" />
            <Stat label={t('loadout.speed')} value={char.baseSpeed} color="text-game-cyan" />
            <Stat label={t('loadout.damage')} value={char.baseDamage} color="text-game-yellow" />
          </div>

          {/* Ability block */}
          {char.ability ? (
            <div className="rounded-2xl border border-game-purple/30 bg-game-purple/10 p-4">
              <div className="mb-2 flex items-center gap-3">
                {char.ability.iconUrl ? (
                  <img src={char.ability.iconUrl} className="h-11 w-11 rounded-full object-cover ring-2 ring-game-purple/60 shadow-[0_0_12px_rgba(150,100,255,0.4)]" alt="" />
                ) : (
                  <div className="flex h-11 w-11 items-center justify-center rounded-full bg-game-purple text-lg font-bold text-white ring-2 ring-game-purple/60">Q</div>
                )}
                <div>
                  <div className="font-display text-sm font-bold uppercase tracking-widest text-game-purple">{char.ability.name}</div>
                  <div className="text-xs text-white/50">Cooldown: {Math.round(char.ability.cooldownMs / 1000)}s</div>
                </div>
              </div>
              {char.ability.description && (
                <p className="text-sm leading-relaxed text-white/70">{char.ability.description}</p>
              )}
            </div>
          ) : (
            <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-center text-sm text-white/40">
              No ability
            </div>
          )}

          {/* Equip button */}
          <button
            type="button"
            disabled={saving || equipped}
            onClick={() => void onEquip()}
            className={
              'game-btn w-full py-3 font-display text-base uppercase tracking-widest transition disabled:opacity-60 ' +
              (equipped ? 'game-btn-green cursor-default' : 'game-btn-yellow')
            }
          >
            {equipped ? `✓ ${t('loadout.equipped')}` : t('loadout.equip')}
          </button>
        </div>
      </div>
    </div>
  );
}
