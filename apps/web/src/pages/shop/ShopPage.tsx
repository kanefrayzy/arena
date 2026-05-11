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

interface ShopCharacter {
  id: number;
  name: string;
  spriteUrl: string | null;
  priceUsd: string | null;
  baseHp: number;
  baseSpeed: number;
  baseDamage: number;
  ability: AbilityInfo | null;
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
  const [previewChar, setPreviewChar] = useState<ShopCharacter | null>(null);

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
      if (e instanceof ApiError && e.code === 'INSUFFICIENT_BALANCE') {
        setError(t('shop.insufficient_funds'));
      } else if (e instanceof ApiError && e.code === 'ALREADY_OWNED') {
        await reload();
      } else {
        setError(e instanceof Error ? e.message : 'buy failed');
      }
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
                char={c}
                owned={owned}
                canAfford={canAfford}
                busy={busy === k}
                onBuy={() => void buy(c.id)}
                onPreview={() => setPreviewChar(c)}
                ownedLabel={t('shop.owned')}
                buyLabel={t('shop.buy')}
                t={t}
              />
            );
          })}
        </div>
        {error && (
          <div className="text-center text-sm font-semibold text-game-red">{error}</div>
        )}
      </main>

      {previewChar && (
        <ShopModal
          char={previewChar}
          owned={ownedChars.has(previewChar.id)}
          canAfford={balance >= parseFloat(previewChar.priceUsd ?? '0')}
          busy={busy === `character:${previewChar.id}`}
          onBuy={() => void buy(previewChar.id)}
          onClose={() => setPreviewChar(null)}
          t={t}
        />
      )}
    </div>
  );
}

interface CardProps {
  char: ShopCharacter;
  owned: boolean;
  canAfford: boolean;
  busy: boolean;
  onBuy: () => void;
  onPreview: () => void;
  ownedLabel: string;
  buyLabel: string;
  t: (key: string) => string;
}

function Card(p: CardProps) {
  const c = p.char;
  const priceNum = c.priceUsd != null && c.priceUsd !== '' ? parseFloat(c.priceUsd) : 0;
  const isFree = priceNum <= 0;
  const isWebm = (c.spriteUrl?.split('?')[0] ?? '').toLowerCase().endsWith('.webm');
  return (
    <button
      type="button"
      onClick={p.onPreview}
      className="game-card game-card-hover relative flex flex-col items-center gap-2 p-3 text-left transition w-full"
    >
      <div className="relative flex h-28 w-28 items-center justify-center overflow-hidden rounded-2xl bg-black/40">
        <div className="absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/10 to-transparent" />
        <div className="absolute bottom-2 left-1/2 h-2 w-16 -translate-x-1/2 rounded-full bg-black/50 blur-sm" />
        {c.spriteUrl ? (
          isWebm ? (
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
        {isFree && !p.owned && (
          <div className="absolute right-1 top-1 rounded-full bg-game-green px-2 py-0.5 text-[9px] font-bold uppercase text-[#1a1450] shadow-[0_2px_0_#138a4a]">
            FREE
          </div>
        )}
      </div>
      <div className="font-display text-sm uppercase tracking-wide text-white">{c.name}</div>
      <div className="grid w-full grid-cols-3 gap-1 text-[10px]">
        <Stat label="HP" value={c.baseHp} color="text-game-red" />
        <Stat label="SPD" value={c.baseSpeed} color="text-game-cyan" />
        <Stat label="DMG" value={c.baseDamage} color="text-game-yellow" />
      </div>
      {/* Ability badge */}
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
      {!isFree && (
        <div className="font-display text-base text-game-yellow">${c.priceUsd}</div>
      )}
      {p.owned ? (
        <div className="game-btn game-btn-green game-btn-sm w-full mt-1 cursor-default opacity-90 text-center">
          ✓ {p.ownedLabel}
        </div>
      ) : (
        <div
          className={
            'game-btn game-btn-sm w-full mt-1 text-center ' +
            (isFree ? 'game-btn-green' : 'game-btn-yellow')
          }
        >
          {p.buyLabel}
        </div>
      )}
    </button>
  );
}

function ShopModal({
  char,
  owned,
  canAfford,
  busy,
  onBuy,
  onClose,
  t,
}: {
  char: ShopCharacter;
  owned: boolean;
  canAfford: boolean;
  busy: boolean;
  onBuy: () => void;
  onClose: () => void;
  t: (key: string) => string;
}) {
  const priceNum = char.priceUsd != null && char.priceUsd !== '' ? parseFloat(char.priceUsd) : 0;
  const isFree = priceNum <= 0;
  const insufficient = !owned && !isFree && !canAfford;
  const isWebm = (char.spriteUrl?.split('?')[0] ?? '').toLowerCase().endsWith('.webm');
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
            isWebm ? (
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
            <Stat label="SPD" value={char.baseSpeed} color="text-game-cyan" />
            <Stat label="DMG" value={char.baseDamage} color="text-game-yellow" />
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

          {/* Price + Buy */}
          {!isFree && (
            <div className="text-center font-display text-xl text-game-yellow">${char.priceUsd}</div>
          )}
          {owned ? (
            <button type="button" disabled className="game-btn game-btn-green w-full py-3 font-display text-base uppercase tracking-widest disabled:opacity-90 cursor-default">
              ✓ {t('shop.owned')}
            </button>
          ) : (
            <>
              {insufficient && (
                <div className="rounded-xl border border-game-red/40 bg-game-red/10 px-3 py-2 text-center text-sm font-semibold text-game-red">
                  {t('shop.insufficient_funds')}
                </div>
              )}
              <button
                type="button"
                disabled={busy || insufficient}
                onClick={onBuy}
                className={'game-btn w-full py-3 font-display text-base uppercase tracking-widest transition disabled:opacity-50 disabled:cursor-not-allowed ' + (isFree ? 'game-btn-green' : 'game-btn-yellow')}
              >
                {busy ? '…' : isFree ? t('shop.buy') : `${t('shop.buy')} $${char.priceUsd}`}
              </button>
            </>
          )}
        </div>
      </div>
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
