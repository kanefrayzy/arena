import { useEffect, useState } from 'react';
import { api } from '../../../shared/api/client';

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

export function ContentTab() {
  const [chars, setChars] = useState<Character[]>([]);
  const [err, setErr] = useState<string | null>(null);
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

  async function patchChar(c: Character, field: 'baseHp' | 'baseSpeed' | 'baseDamage' | 'abilityCooldownS') {
    const v = window.prompt(`${field} for ${c.name}:`, String(c[field]));
    if (v === null) return;
    const n = field === 'baseSpeed' ? parseFloat(v) : parseInt(v, 10);
    if (Number.isNaN(n)) return;
    setBusy(`c${c.id}`);
    try {
      await api.patch(`/admin/characters/${c.id}`, { [field]: n });
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'failed');
    } finally {
      setBusy(null);
    }
  }

  async function patchSkinPrice(s: Skin) {
    const v = window.prompt(`priceUsd for "${s.name}" (empty=null):`, s.priceUsd ?? '');
    if (v === null) return;
    setBusy(`s${s.id}`);
    try {
      await api.patch(`/admin/skins/${s.id}`, { priceUsd: v.trim() === '' ? null : v.trim() });
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'failed');
    } finally {
      setBusy(null);
    }
  }

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
    <div className="flex flex-col gap-3">
      {err && <div className="text-xs text-red-400">{err}</div>}
      {chars.map((c) => (
        <div key={c.id} className="rounded bg-surface px-2 py-2 text-xs">
          <div className="font-semibold">
            {c.name} <span className="text-white/40">/{c.slug}</span>
          </div>
          <div className="mt-1 grid grid-cols-2 gap-1 text-[10px]">
            <button type="button" onClick={() => void patchChar(c, 'baseHp')} className="rounded bg-white/10 py-1">
              HP {c.baseHp}
            </button>
            <button type="button" onClick={() => void patchChar(c, 'baseSpeed')} className="rounded bg-white/10 py-1">
              SPD {c.baseSpeed}
            </button>
            <button type="button" onClick={() => void patchChar(c, 'baseDamage')} className="rounded bg-white/10 py-1">
              DMG {c.baseDamage}
            </button>
            <button type="button" onClick={() => void patchChar(c, 'abilityCooldownS')} className="rounded bg-white/10 py-1">
              CD {c.abilityCooldownS}s
            </button>
          </div>
          <div className="mt-2 flex flex-col gap-1">
            {c.skins.map((s) => (
              <div key={s.id} className="flex items-center gap-2 rounded bg-white/5 px-2 py-1 text-[10px]">
                <span className="h-3 w-3 rounded-full" style={{ backgroundColor: s.tint ?? '#888' }} />
                <span className={!s.isActive ? 'line-through text-white/40' : ''}>{s.name}</span>
                <span className="text-white/40">{s.rarity}</span>
                <span className="ml-auto font-mono">{s.priceUsd ? `$${s.priceUsd}` : '—'}</span>
                <button type="button" disabled={busy === `s${s.id}`} onClick={() => void patchSkinPrice(s)} className="rounded bg-white/10 px-1">
                  $
                </button>
                <button type="button" disabled={busy === `s${s.id}`} onClick={() => void toggleSkin(s)} className="rounded bg-white/10 px-1">
                  {s.isActive ? '✓' : '✗'}
                </button>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
