import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../../shared/api/client';

interface ShopCharacter {
  id: number;
  name: string;
  spriteUrl: string | null;
  priceUsd: string | null;
}
interface MyInventory {
  characters: Array<{ characterId: number }>;
}
interface Wallet {
  balance: string;
  locked: string;
}

export function ShopPage() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const [chars, setChars] = useState<ShopCharacter[]>([]);
  const [inv, setInv] = useState<MyInventory>({ characters: [] });
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function reload() {
    try {
      const [c, i, walletRes] = await Promise.all([
        api.get<{ items: ShopCharacter[] }>('/shop/characters'),
        api.get<MyInventory>('/inventory/me'),
        api.get<Wallet>('/wallet'),
      ]);
      setChars(c.items);
      setInv({ characters: i.characters ?? [] });
      setWallet(walletRes);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) nav('/');
      else setError(e instanceof Error ? e.message : 'load failed');
    }
  }

  useEffect(() => {
    void reload();
  }, [nav]);

  const ownedChars = useMemo(() => new Set(inv.characters.map((c) => c.characterId)), [inv]);
  const balance = parseFloat(wallet?.balance ?? '0');

  async function buy(id: number) {
    setError(null);
    setBusy(`character:${id}`);
    try {
      await api.post(`/shop/characters/${id}/buy`);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'buy failed');
    } finally {
      setBusy(null);
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
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {chars.length === 0 && (
            <div className="col-span-full rounded-lg bg-surface px-4 py-8 text-center text-sm text-white/60">
              {t('shop.empty.characters')}
            </div>
          )}
          {chars.map((c) => {
            const owned = ownedChars.has(c.id);
            const price = parseFloat(c.priceUsd ?? '0');
            const canAfford = balance >= price;
            const k = `character:${c.id}`;
            return (
              <Card
                key={c.id}
                name={c.name}
                spriteUrl={c.spriteUrl}
                priceUsd={c.priceUsd}
                owned={owned}
                canAfford={canAfford}
                busy={busy === k}
                onBuy={() => void buy(c.id)}
                ownedLabel={t('shop.owned')}
                buyLabel={t('shop.buy')}
              />
            );
          })}
        </div>
        {error && <div className="text-center text-sm text-red-400">{error}</div>}
      </main>
    </div>
  );
}

interface CardProps {
  name: string;
  spriteUrl: string | null;
  priceUsd: string | null;
  owned: boolean;
  canAfford: boolean;
  busy: boolean;
  onBuy: () => void;
  ownedLabel: string;
  buyLabel: string;
}

function Card(p: CardProps) {
  const priceNum = p.priceUsd != null && p.priceUsd !== '' ? parseFloat(p.priceUsd) : 0;
  const isFree = priceNum <= 0;
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg bg-surface p-3">
      <div className="flex h-24 w-24 items-center justify-center rounded-md bg-black/40">
        {p.spriteUrl ? (
          <img src={p.spriteUrl} alt={p.name} className="max-h-full max-w-full object-contain" />
        ) : (
          <div className="h-12 w-12 rounded-full bg-white/20" />
        )}
      </div>
      <div className="text-sm font-semibold">{p.name}</div>
      <div className="font-mono text-sm">{isFree ? 'FREE' : `$${p.priceUsd}`}</div>
      {p.owned ? (
        <button
          type="button"
          disabled
          className="w-full rounded bg-white/10 px-3 py-1.5 text-xs text-white/50"
        >
          {p.ownedLabel}
        </button>
      ) : (
        <button
          type="button"
          disabled={p.busy || (!isFree && !p.canAfford)}
          onClick={p.onBuy}
          className="w-full rounded bg-accent px-3 py-1.5 text-xs font-semibold text-bg disabled:opacity-50"
        >
          {p.busy ? '…' : p.buyLabel}
        </button>
      )}
    </div>
  );
}
