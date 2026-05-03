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
  priceUsd: string | null;
}

interface Character {
  id: number;
  name: string;
}

interface Inventory {
  skins: Array<{ skinId: number; characterId: number }>;
}

interface Wallet {
  balance: string;
  locked: string;
}

export function ShopPage() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const [items, setItems] = useState<Skin[]>([]);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [inventory, setInventory] = useState<Inventory | null>(null);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  async function reload() {
    try {
      const [shop, chars, inv, w] = await Promise.all([
        api.get<{ items: Skin[] }>('/shop/skins'),
        api.get<{ characters: Character[] }>('/characters'),
        api.get<Inventory>('/inventory/me'),
        api.get<Wallet>('/wallet'),
      ]);
      setItems(shop.items);
      setCharacters(chars.characters);
      setInventory(inv);
      setWallet(w);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) nav('/');
      else setError(e instanceof Error ? e.message : 'load failed');
    }
  }

  useEffect(() => {
    void reload();
  }, [nav]);

  const ownedSkinIds = useMemo(
    () => new Set((inventory?.skins ?? []).map((s) => s.skinId)),
    [inventory],
  );
  const charNameById = useMemo(
    () => new Map(characters.map((c) => [c.id, c.name])),
    [characters],
  );

  async function buy(skinId: number) {
    setError(null);
    setBusyId(skinId);
    try {
      await api.post(`/shop/skins/${skinId}/buy`);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'buy failed');
    } finally {
      setBusyId(null);
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
          ← {t('shop.back')}
        </button>
        <h2 className="text-lg font-semibold">{t('shop.title')}</h2>
        <div className="text-sm">
          <span className="text-white/50">$ </span>
          <span className="font-mono">{wallet?.balance ?? '—'}</span>
        </div>
      </header>

      <main className="flex flex-1 flex-col gap-3 overflow-y-auto px-5 py-4">
        {items.length === 0 && (
          <div className="text-center text-sm text-white/50">{t('shop.empty')}</div>
        )}
        {items.map((s) => {
          const owned = ownedSkinIds.has(s.id);
          const charName = charNameById.get(s.characterId) ?? `#${s.characterId}`;
          const canAfford = parseFloat(wallet?.balance ?? '0') >= parseFloat(s.priceUsd ?? 'Infinity');
          return (
            <div
              key={s.id}
              className="flex items-center gap-3 rounded-lg bg-surface px-3 py-3"
            >
              <div
                className="h-12 w-12 shrink-0 rounded-full"
                style={{ backgroundColor: s.tint ?? '#888' }}
              />
              <div className="flex-1">
                <div className="text-sm font-semibold">
                  {s.name}{' '}
                  <span className="text-xs font-normal text-white/40">— {charName}</span>
                </div>
                <div className="text-xs text-white/50">{s.rarity}</div>
              </div>
              <div className="text-right">
                {s.priceUsd != null && (
                  <div className="font-mono text-sm">${s.priceUsd}</div>
                )}
                {owned ? (
                  <button
                    type="button"
                    disabled
                    className="mt-1 rounded bg-white/10 px-3 py-1 text-xs text-white/50"
                  >
                    {t('shop.owned')}
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={busyId === s.id || !canAfford}
                    onClick={() => void buy(s.id)}
                    className="mt-1 rounded bg-accent px-3 py-1 text-xs font-semibold text-bg disabled:opacity-50"
                  >
                    {busyId === s.id ? '…' : t('shop.buy')}
                  </button>
                )}
              </div>
            </div>
          );
        })}

        {error && <div className="text-center text-sm text-red-400">{error}</div>}
      </main>
    </div>
  );
}
