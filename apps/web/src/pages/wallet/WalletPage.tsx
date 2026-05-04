import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../../shared/api/client';

interface Wallet { balance: string; locked: string; updatedAt: string }
interface PaymentMethod {
  slug: string; label: string; kind: 'betra_card' | 'betra_payout' | 'westwallet';
  currency: string; iconUrl: string | null;
  minAmount: string | null; maxAmount: string | null;
  isDeposit: boolean; isWithdraw: boolean;
}
interface PaymentItem {
  id: string; type: string; status: string; amountUsd: string;
  amountRaw: string | null; currency: string | null;
  provider: string; methodSlug: string | null; createdAt: string;
}
interface BetraReqs {
  id: number; status: string; card: string | null; cardHolder: string | null;
  bank: string | null; qrLink: string | null; expiredAt: string | null;
  amount: number; currency: string;
}
interface DepositResponse {
  paymentId: string; status: string;
  betra?: BetraReqs;
  crypto?: { address: string; destTag?: string; currency: string };
}

type Tab = 'deposit' | 'withdraw' | 'history';

// --- copy helper that works on http origins (where navigator.clipboard is blocked) ---
async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* fall through */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-1000px';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch { return false; }
}

function qrUrl(text: string, size = 240): string {
  return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&margin=8&data=${encodeURIComponent(text)}`;
}

export function WalletPage() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [history, setHistory] = useState<PaymentItem[]>([]);
  const [tab, setTab] = useState<Tab>('deposit');
  const [methodSlug, setMethodSlug] = useState<string | null>(null);
  const [amount, setAmount] = useState('10');
  const [card, setCard] = useState('');
  const [address, setAddress] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [reqs, setReqs] = useState<DepositResponse | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetMin, setSheetMin] = useState(false);

  const reload = async () => {
    try {
      const w = await api.get<Wallet>('/wallet');
      setWallet(w);
      const m = await api.get<{ items: PaymentMethod[] }>('/payments/methods');
      setMethods(m.items);
      const p = await api.get<{ items: PaymentItem[] }>('/payments/me?limit=50');
      setHistory(p.items);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) nav('/');
    }
  };
  useEffect(() => { void reload(); }, []);

  const filtered = methods.filter((m) => (tab === 'deposit' ? m.isDeposit : tab === 'withdraw' ? m.isWithdraw : false));
  const selected = methods.find((m) => m.slug === methodSlug) ?? null;
  const isCrypto = selected?.kind === 'westwallet';

  // Auto-fetch crypto address when a crypto deposit method is selected
  useEffect(() => {
    if (tab !== 'deposit' || !selected || selected.kind !== 'westwallet') return;
    setReqs(null); setErr(null); setBusy(true);
    void (async () => {
      try {
        const r = await api.post<{ address: string; destTag?: string | null; currency: string }>(
          '/payments/crypto-address', { currency: selected.currency },
        );
        setReqs({ paymentId: '', status: 'STATIC', crypto: { address: r.address, destTag: r.destTag ?? undefined, currency: r.currency } });
      } catch (e) {
        setErr(e instanceof ApiError ? e.code : (e as Error).message);
      } finally { setBusy(false); }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, methodSlug]);

  const submitDeposit = async () => {
    if (!selected) return;
    setBusy(true); setErr(null); setReqs(null);
    try {
      const r = await api.post<DepositResponse>('/payments/deposit', { method: selected.slug, amount });
      setReqs(r);
      setSheetMin(false);
      await reload();
    } catch (e) {
      setErr(e instanceof ApiError ? `${e.code}` : (e as Error).message);
    } finally { setBusy(false); }
  };

  const submitWithdraw = async () => {
    if (!selected) return;
    setBusy(true); setErr(null);
    try {
      const body: any = { method: selected.slug, amount };
      if (selected.kind === 'betra_payout') body.card = card;
      else if (selected.kind === 'westwallet') body.address = address;
      await api.post('/payments/withdraw', body);
      setErr(null);
      await reload();
    } catch (e) {
      setErr(e instanceof ApiError ? `${e.code}` : (e as Error).message);
    } finally { setBusy(false); }
  };

  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      <div className="pointer-events-none absolute -top-32 -left-20 h-72 w-72 rounded-full bg-game-green/30 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-32 -right-20 h-72 w-72 rounded-full bg-game-purple/30 blur-3xl" />

      <header className="game-panel relative z-10 flex items-center justify-between px-4 py-3">
        <button type="button" onClick={() => nav('/home')} className="game-btn game-btn-ghost game-btn-sm">
          ← {t('wallet.back')}
        </button>
        <h2 className="game-title text-xl text-game-yellow">{t('wallet.title')}</h2>
        <div className="w-12" />
      </header>

      <div className="relative z-10 flex flex-1 flex-col overflow-y-auto pb-32">
        <section className="flex flex-col items-center gap-2 px-6 pt-6">
          <div className="text-xs font-semibold uppercase tracking-widest text-white/60">{t('wallet.balance')}</div>
          <div className="game-title text-5xl text-game-yellow drop-shadow-[0_4px_0_rgba(0,0,0,0.4)]">
            ${wallet ? Number(wallet.balance).toFixed(2) : '—'}
          </div>
          {wallet && Number(wallet.locked) > 0 && (
            <div className="game-chip text-xs">{t('wallet.locked')}: ${Number(wallet.locked).toFixed(2)}</div>
          )}
        </section>

        <div className="mt-4 flex gap-2 px-6">
          {(['deposit', 'withdraw', 'history'] as Tab[]).map((tt) => (
            <button
              key={tt}
              onClick={() => { setTab(tt); setMethodSlug(null); setReqs(null); setErr(null); }}
              className={'game-btn game-btn-sm flex-1 ' + (tab === tt ? 'game-btn-yellow' : 'game-btn-ghost')}
            >
              {t(`wallet.tab_${tt}`)}
            </button>
          ))}
        </div>

        {tab !== 'history' && (
          <section className="px-6 pt-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {filtered.length === 0 && (
                <div className="game-card col-span-full px-3 py-6 text-center text-white/60">{t('wallet.no_methods')}</div>
              )}
              {filtered.map((m) => (
                <button
                  key={m.slug}
                  onClick={() => {
                    setMethodSlug(m.slug);
                    setReqs(null); setErr(null);
                    // Open sheet immediately when selecting deposit method
                    if (tab === 'deposit') { setSheetOpen(true); setSheetMin(false); }
                  }}
                  className={
                    'game-card flex flex-col items-center gap-2 p-3 transition ' +
                    (methodSlug === m.slug ? 'ring-2 ring-game-yellow' : 'hover:scale-[1.02]')
                  }
                >
                  {m.iconUrl ? (
                    <img src={m.iconUrl} alt={m.label} className="h-12 w-12 object-contain" />
                  ) : (
                    <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-white/10 font-display text-xs text-white/70">
                      {m.currency.slice(0, 4)}
                    </div>
                  )}
                  <div className="text-center text-xs font-semibold text-white/90">{m.label}</div>
                </button>
              ))}
            </div>
          </section>
        )}

        {tab !== 'history' && selected && tab === 'withdraw' && (
          <section className="flex flex-col gap-3 px-6 pt-4">
            <input
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
              className="game-input font-mono text-xl"
              placeholder={`Amount in ${selected.currency}`}
            />
            {selected.kind === 'betra_payout' && (
              <input
                value={card}
                onChange={(e) => setCard(e.target.value.replace(/[^0-9]/g, ''))}
                className="game-input font-mono"
                placeholder={t('wallet.card_number')}
                maxLength={20}
              />
            )}
            {selected.kind === 'westwallet' && (
              <input
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                className="game-input font-mono text-sm"
                placeholder={`${selected.currency} address`}
              />
            )}
            <button
              type="button"
              disabled={busy || !amount}
              onClick={() => void submitWithdraw()}
              className="game-btn game-btn-purple"
            >
              {t('wallet.withdraw')}
            </button>
            {err && <div className="text-center text-sm font-semibold text-game-red">{err}</div>}
          </section>
        )}

        {tab === 'history' && (
          <section className="px-6 pt-4">
            <ul className="space-y-2 text-sm">
              {history.length === 0 && (
                <li className="game-card px-3 py-4 text-center text-white/60">{t('wallet.empty')}</li>
              )}
              {history.map((p) => (
                <li key={p.id} className="flex items-center justify-between rounded-xl border-2 border-white/10 bg-black/30 px-3 py-2">
                  <div>
                    <div className="font-display text-sm uppercase text-white/90">
                      {p.type} <span className="text-xs text-white/50">({p.provider})</span>
                    </div>
                    <div className="text-xs text-white/50">
                      {new Date(p.createdAt).toLocaleString()} · {p.status}
                    </div>
                  </div>
                  <div className="font-mono font-bold text-white">
                    ${Number(p.amountUsd).toFixed(2)}
                    {p.currency && p.currency !== 'USD' && p.amountRaw && (
                      <div className="text-xs text-white/60">{Number(p.amountRaw).toFixed(2)} {p.currency}</div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      {sheetOpen && selected && tab === 'deposit' && (
        <DepositSheet
          reqs={reqs}
          busy={busy}
          loadingErr={err}
          isCrypto={isCrypto}
          selected={selected}
          amount={amount}
          onAmountChange={setAmount}
          onSubmit={submitDeposit}
          minimized={sheetMin}
          onMinimize={() => setSheetMin((v) => !v)}
          onClose={() => { setSheetOpen(false); setReqs(null); setErr(null); setMethodSlug(null); }}
        />
      )}
    </div>
  );
}

function DepositSheet({
  reqs, busy, loadingErr, isCrypto, selected, amount, onAmountChange, onSubmit,
  minimized, onMinimize, onClose,
}: {
  reqs: DepositResponse | null;
  busy: boolean;
  loadingErr: string | null;
  isCrypto: boolean;
  selected: PaymentMethod;
  amount: string;
  onAmountChange: (v: string) => void;
  onSubmit: () => void;
  minimized: boolean;
  onMinimize: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [drag, setDrag] = useState<{ startY: number; dy: number } | null>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const onCopy = async (text: string) => {
    const ok = await copyText(text);
    if (ok) {
      setCopied(text);
      setTimeout(() => setCopied(null), 1500);
    }
  };

  const headerLabel = reqs?.betra
    ? t('wallet.pay_to_card')
    : (reqs?.crypto || isCrypto)
    ? t('wallet.send_to_address') + ` (${selected.currency})`
    : t('wallet.deposit');

  // Drag-to-collapse: track pointer Y delta on the handle.
  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    setDrag({ startY: e.clientY, dy: 0 });
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const dy = e.clientY - drag.startY;
    setDrag({ ...drag, dy });
  };
  const onPointerUp = () => {
    if (!drag) return;
    const { dy } = drag;
    setDrag(null);
    if (dy > 60 && !minimized) onMinimize();
    else if (dy < -60 && minimized) onMinimize();
  };

  // While dragging, translate sheet for visual feedback.
  const translatePx = drag
    ? Math.max(minimized ? -200 : 0, Math.min(minimized ? 0 : 200, drag.dy))
    : 0;

  return (
    <div className="pointer-events-none fixed inset-0 z-40 flex justify-center">
      <div
        ref={sheetRef}
        className={
          'pointer-events-auto absolute bottom-0 w-full max-w-md transform rounded-t-3xl border-2 border-b-0 border-game-yellow/40 bg-bg/95 shadow-[0_-12px_30px_rgba(0,0,0,0.6)] backdrop-blur-md transition-transform duration-200 ' +
          (drag ? '' : 'ease-out')
        }
        style={{
          transform: `translateY(${minimized ? 'calc(100% - 64px)' : '0px'}) translateY(${translatePx}px)`,
        }}
      >
        {/* Drag handle / header */}
        <div
          className="flex select-none items-center gap-2 px-4 py-3 cursor-grab active:cursor-grabbing"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onClick={() => { if (!drag) onMinimize(); }}
        >
          <div className="mx-auto flex flex-col items-center gap-1">
            <div className="h-1.5 w-12 rounded-full bg-white/30" />
          </div>
        </div>
        <div className="flex items-center justify-between px-5 pb-2">
          <div className="font-display text-base text-game-yellow">{headerLabel}</div>
          <div className="flex gap-1">
            <button onClick={onMinimize} className="game-btn game-btn-ghost game-btn-sm" title={minimized ? 'expand' : 'collapse'}>
              {minimized ? '▴' : '▾'}
            </button>
            <button onClick={onClose} className="game-btn game-btn-ghost game-btn-sm" title="close">✕</button>
          </div>
        </div>

        {/* Content */}
        <div className={'overflow-y-auto px-5 pb-6 transition-opacity duration-200 ' + (minimized ? 'opacity-0' : 'opacity-100')}
          style={{ maxHeight: '70vh' }}>
          {/* Loading crypto address */}
          {busy && !reqs && isCrypto && (
            <div className="py-10 text-center text-sm text-white/50">Получаем адрес…</div>
          )}
          {/* Error */}
          {loadingErr && !reqs && (
            <div className="rounded-xl bg-rose-500/15 px-4 py-3 text-sm text-rose-300">{loadingErr}</div>
          )}
          {/* Amount input for non-crypto betra deposit */}
          {!reqs && !busy && !isCrypto && (
            <div className="flex flex-col gap-3 pt-2">
              <input
                inputMode="decimal"
                value={amount}
                onChange={(e) => onAmountChange(e.target.value.replace(/[^0-9.]/g, ''))}
                className="game-input font-mono text-xl"
                placeholder={`Сумма в ${selected.currency}`}
              />
              {selected.minAmount && (
                <div className="text-xs text-white/50">Мин: {selected.minAmount} {selected.currency}</div>
              )}
              <button
                type="button"
                disabled={!amount}
                onClick={onSubmit}
                className="game-btn game-btn-green"
              >
                {t('wallet.deposit')}
              </button>
            </div>
          )}
          {reqs?.betra && <BetraView b={reqs.betra} onCopy={onCopy} copied={copied} />}
          {reqs?.crypto && <CryptoView c={reqs.crypto} onCopy={onCopy} copied={copied} />}
        </div>
      </div>
    </div>
  );
}

function BetraView({ b, onCopy, copied }: { b: BetraReqs; onCopy: (s: string) => void; copied: string | null }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-xl bg-black/40 px-4 py-3">
        <div className="text-[10px] uppercase tracking-widest text-white/50">{t('wallet.amount')}</div>
        <div className="font-mono text-2xl font-bold text-game-yellow">
          {Number(b.amount).toFixed(2)} <span className="text-base text-white/70">{b.currency}</span>
        </div>
      </div>
      {b.card && (
        <div className="rounded-xl bg-black/40 px-4 py-3">
          <div className="mb-1 text-[10px] uppercase tracking-widest text-white/50">{t('wallet.card_number')}</div>
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-lg tracking-wider">{b.card}</span>
            <button onClick={() => onCopy(b.card!)} className="game-btn game-btn-ghost game-btn-sm">
              {copied === b.card ? t('wallet.copied') : t('wallet.copy')}
            </button>
          </div>
        </div>
      )}
      {b.cardHolder && (
        <div className="rounded-xl bg-black/40 px-4 py-3">
          <div className="mb-1 text-[10px] uppercase tracking-widest text-white/50">{t('wallet.holder')}</div>
          <div className="text-sm text-white/90">{b.cardHolder}</div>
        </div>
      )}
      {b.bank && <div className="text-xs text-white/60">{b.bank}</div>}
      {b.qrLink && (
        <div className="flex flex-col items-center gap-2 rounded-xl bg-white/5 p-4">
          <img src={b.qrLink} alt="QR" className="h-48 w-48 rounded-lg bg-white p-2" />
          <a href={b.qrLink} target="_blank" rel="noreferrer" className="text-xs text-game-yellow underline">
            {t('wallet.open_qr')}
          </a>
        </div>
      )}
      {b.expiredAt && (
        <div className="text-center text-xs text-white/50">
          {t('wallet.expires_at')}: {new Date(b.expiredAt).toLocaleString()}
        </div>
      )}
    </div>
  );
}

function CryptoView({ c, onCopy, copied }: { c: { address: string; destTag?: string; currency: string }; onCopy: (s: string) => void; copied: string | null }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center gap-3">
      {/* QR code — large, white background, with a branded border */}
      <div className="rounded-2xl border-2 border-game-yellow/40 bg-white p-3 shadow-[0_0_24px_rgba(245,197,24,0.2)]">
        <img
          src={qrUrl(c.address, 280)}
          alt={`${c.currency} QR`}
          width={280}
          height={280}
          className="block rounded-xl"
        />
      </div>
      <div className="text-xs font-semibold uppercase tracking-widest text-game-yellow">{c.currency}</div>

      <div className="w-full rounded-xl bg-black/40 px-4 py-3">
        <div className="mb-1 text-[10px] uppercase tracking-widest text-white/50">{t('wallet.address')}</div>
        <div className="flex items-center gap-2">
          <span className="break-all font-mono text-sm leading-relaxed text-white/90">{c.address}</span>
          <button onClick={() => onCopy(c.address)} className="game-btn game-btn-ghost game-btn-sm shrink-0">
            {copied === c.address ? t('wallet.copied') : t('wallet.copy')}
          </button>
        </div>
      </div>
      {c.destTag && (
        <div className="w-full rounded-xl bg-black/40 px-4 py-3">
          <div className="mb-1 text-[10px] uppercase tracking-widest text-white/50">Memo / Dest tag</div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm">{c.destTag}</span>
            <button onClick={() => onCopy(c.destTag!)} className="game-btn game-btn-ghost game-btn-sm shrink-0">
              {copied === c.destTag ? t('wallet.copied') : t('wallet.copy')}
            </button>
          </div>
        </div>
      )}
      <div className="text-center text-xs text-white/60">
        {t('wallet.address_static_note', { currency: c.currency })}
      </div>
    </div>
  );
}
