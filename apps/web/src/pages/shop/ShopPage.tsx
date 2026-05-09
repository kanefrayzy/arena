import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../../shared/api/client';

interface ShopCharacter {
  id: number;
  name: string;
  spriteUrl: string | null;
  priceUsd: string | null;
  baseHp: number;
  baseSpeed: number;
  baseDamage: number;
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
  const [loading, setLoading] = useState(true);

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
    } finally {
      setLoading(false);
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
    <div className="relative flex h-full flex-col overflow-hidden">
      <div className="pointer-events-none absolute -top-32 left-0 h-72 w-72 rounded-full bg-game-pink/30 blur-3xl" />

      <header className="game-panel relative z-10 flex items-center justify-between px-4 py-3">
        <button
          type="button"
          onClick={() => nav('/home')}
          className="game-btn game-btn-ghost game-btn-sm"
        >
          ← {t('shop.back')}
        </button>
        <h2 className="game-title text-xl text-game-yellow">{t('shop.title')}</h2>
        <button
          type="button"
          onClick={() => nav('/wallet')}
          className="game-chip game-chip-yellow text-base"
        >
          <span className="text-[#1a1450]">$</span>
          <span className="font-mono">{wallet?.balance ?? '—'}</span>
        </button>
      </header>

      <main className="relative z-10 flex flex-1 flex-col gap-3 overflow-y-auto px-5 py-5">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {loading && (
            <div className="game-card col-span-full px-4 py-10 text-center font-display text-base text-white/40">
              …
            </div>
          )}
          {!loading && chars.length === 0 && (
            <div className="game-card col-span-full px-4 py-10 text-center font-display text-base text-white/70">
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
                baseHp={c.baseHp}
                baseSpeed={c.baseSpeed}
                baseDamage={c.baseDamage}
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
        {error && (
          <div className="text-center text-sm font-semibold text-game-red">{error}</div>
        )}
      </main>
    </div>
  );
}

interface CardProps {
  name: string;
  spriteUrl: string | null;
  priceUsd: string | null;
  baseHp: number;
  baseSpeed: number;
  baseDamage: number;
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
  const isWebm = (p.spriteUrl?.split('?')[0] ?? '').toLowerCase().endsWith('.webm');
  return (
    <div className="game-card relative flex flex-col items-center gap-2 p-3">
      <div className="relative flex h-28 w-28 items-center justify-center overflow-hidden rounded-2xl bg-black/40">
        <div className="absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/10 to-transparent" />
        <div className="absolute bottom-2 left-1/2 h-2 w-16 -translate-x-1/2 rounded-full bg-black/50 blur-sm" />
        {p.spriteUrl ? (
          isWebm ? (
            <video
              src={p.spriteUrl}
              autoPlay loop muted playsInline
              className="relative max-h-[88%] max-w-[88%] animate-float object-contain drop-shadow-[0_4px_4px_rgba(0,0,0,0.5)]"
            />
          ) : (
            <img
              src={p.spriteUrl}
              alt={p.name}
              className="relative max-h-[88%] max-w-[88%] animate-float object-contain drop-shadow-[0_4px_4px_rgba(0,0,0,0.5)]"
            />
          )
        ) : (
          <div className="relative h-14 w-14 animate-float rounded-full bg-white/20" />
        )}
        {isFree && !p.owned && (
          <div className="absolute right-1 top-1 rounded-full bg-game-green px-2 py-0.5 text-[9px] font-bold uppercase text-[#1a1450] shadow-[0_2px_0_#138a4a]">
            FREE
          </div>
        )}
      </div>
      <div className="font-display text-sm uppercase tracking-wide text-white">{p.name}</div>
      <div className="grid w-full grid-cols-3 gap-1 text-[10px]">
        <Stat label="HP" value={p.baseHp} color="text-game-red" />
        <Stat label="SPD" value={p.baseSpeed} color="text-game-cyan" />
        <Stat label="DMG" value={p.baseDamage} color="text-game-yellow" />
      </div>
      {!isFree && (
        <div className="font-display text-base text-game-yellow">${p.priceUsd}</div>
      )}
      {p.owned ? (
        <button type="button" disabled className="game-btn game-btn-green game-btn-sm w-full mt-1 cursor-default opacity-90">
          ✓ {p.ownedLabel}
        </button>
      ) : (
        <button
          type="button"
          disabled={p.busy || (!isFree && !p.canAfford)}
          onClick={p.onBuy}
          className={
            'game-btn game-btn-sm w-full ' +
            (isFree ? 'game-btn-green' : 'game-btn-yellow')
          }
        >
          {p.busy ? '…' : p.buyLabel}
        </button>
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
