import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../../shared/api/client';
import { toast } from '../../shared/ui/toast';

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

// Format raw card digits into 4-digit groups: "1234567812345678" -> "1234 5678 1234 5678"
function formatCard(s: string | null | undefined): string {
  if (!s) return '';
  const digits = String(s).replace(/\D/g, '');
  if (!digits) return String(s);
  return digits.replace(/(\d{4})(?=\d)/g, '$1 ');
}

function Spinner({ size = 28, label }: { size?: number; label?: string }) {
  return (
    <div className="flex flex-col items-center gap-3 py-10">
      <svg
        className="animate-spin text-game-yellow"
        style={{ width: size, height: size }}
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden
      >
        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
        <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      </svg>
      {label && <div className="text-xs text-white/60">{label}</div>}
    </div>
  );
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
  const [withdrawSheetOpen, setWithdrawSheetOpen] = useState(false);
  const [withdrawSheetMin, setWithdrawSheetMin] = useState(false);
  const [withdrawDone, setWithdrawDone] = useState(false);
  const [rates, setRates] = useState<Record<string, number>>({ USD: 1 });
  // Anti-spam lock for pending betra deposits (15-min window).
  const [pending, setPending] = useState<{ paymentId: string; expiresAt: string } | null>(null);

  const reload = async () => {
    try {
      const w = await api.get<Wallet>('/wallet');
      setWallet(w);
      const m = await api.get<{ items: PaymentMethod[] }>('/payments/methods');
      setMethods(m.items);
      const p = await api.get<{ items: PaymentItem[] }>('/payments/me?limit=50');
      setHistory(p.items);
      try {
        const r = await api.get<{ rates: Record<string, number> }>('/payments/rates');
        if (r?.rates) setRates(r.rates);
      } catch { /* ignore, fallback 1:1 */ }
      // Refresh just the lock state — without touching open sheets / tabs.
      try {
        type PendingResp =
          | { active: false }
          | { active: true; paymentId: string; expiresAt: string; methodSlug: string | null; betra: BetraReqs | null };
        const pp = await api.get<PendingResp>('/payments/pending');
        if (pp.active) setPending({ paymentId: pp.paymentId, expiresAt: pp.expiresAt });
        else setPending(null);
      } catch { /* ignore */ }
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) nav('/');
    }
  };

  // Auto-resume pending deposit only on initial mount — never after submit/cancel,
  // so the user-visible sheet state is not overridden by background refreshes.
  const resumePending = async () => {
    try {
      type PendingResp =
        | { active: false }
        | { active: true; paymentId: string; expiresAt: string; methodSlug: string | null; betra: BetraReqs | null };
      const pp = await api.get<PendingResp>('/payments/pending');
      if (pp.active) {
        setPending({ paymentId: pp.paymentId, expiresAt: pp.expiresAt });
        if (pp.betra) {
          setReqs({ paymentId: pp.paymentId, status: pp.betra.status, betra: pp.betra });
          if (pp.methodSlug) setMethodSlug(pp.methodSlug);
          setTab('deposit');
          setSheetOpen(true);
          setSheetMin(true);
        }
      }
    } catch { /* ignore */ }
  };
  useEffect(() => { void (async () => { await reload(); await resumePending(); })(); }, []);

  // Poll wallet + pending state every 10s so betra callback completions
  // (balance credit + lock release) surface in near real-time.
  useEffect(() => {
    const id = setInterval(() => { void reload(); }, 10_000);
    const onVis = () => { if (document.visibilityState === 'visible') void reload(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVis); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);  const filtered = methods.filter((m) => (tab === 'deposit' ? m.isDeposit : tab === 'withdraw' ? m.isWithdraw : false));
  const selected = methods.find((m) => m.slug === methodSlug) ?? null;
  const isCrypto = selected?.kind === 'westwallet';

  // Currency conversion helper: USD -> method.currency.
  const usdToNative = (usd: number, cur?: string | null): number => {
    if (!cur) return usd;
    const c = cur.toUpperCase();
    if (['USD', 'USDT', 'USDC', 'BUSD', 'DAI'].includes(c)) return usd;
    const r = rates[c];
    if (!r || !Number.isFinite(r) || r <= 0) return usd;
    return usd * r;
  };
  const nativeToUsd = (native: number, cur?: string | null): number => {
    if (!cur) return native;
    const c = cur.toUpperCase();
    if (['USD', 'USDT', 'USDC', 'BUSD', 'DAI'].includes(c)) return native;
    const r = rates[c];
    if (!r || !Number.isFinite(r) || r <= 0) return native;
    return native / r;
  };

  // Auto-fetch crypto address when a crypto deposit method is selected
  useEffect(() => {
    if (tab !== 'deposit' || !selected || selected.kind !== 'westwallet') return;
    setReqs(null); setErr(null); setBusy(true);
    void (async () => {
      try {
        const r = await api.post<{ address: string; destTag?: string | null; currency: string }>(
          '/payments/crypto-address', { currency: selected.currency },
        );
        setReqs({ paymentId: '', status: 'STATIC', crypto: { address: r.address, ...(r.destTag != null ? { destTag: r.destTag } : {}), currency: r.currency } });
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
      // Latch new 15-minute lock locally so countdown is accurate even before the
      // /payments/pending probe runs again on next reload.
      setPending({ paymentId: r.paymentId, expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString() });
      toast.info('Реквизиты получены', 'Оплатите по указанным реквизитам и средства зачислятся автоматически');
      await reload();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'PENDING_DEPOSIT_EXISTS') {
        const d = (e.details ?? {}) as { paymentId?: string; expiresAt?: string; betra?: BetraReqs | null };
        if (d.expiresAt && d.paymentId) setPending({ paymentId: d.paymentId, expiresAt: d.expiresAt });
        if (d.betra) {
          setReqs({ paymentId: d.paymentId ?? '', status: d.betra.status, betra: d.betra });
          setSheetMin(false);
        }
        setErr(null);
      } else {
        setErr(e instanceof ApiError ? `${e.code}` : (e as Error).message);
      }
    } finally { setBusy(false); }
  };

  const cancelPending = async () => {
    if (!pending) return;
    if (!confirm('Отменить текущую заявку на пополнение?')) return;
    try {
      await api.post(`/payments/${pending.paymentId}/cancel`, {});
      setPending(null);
      setReqs(null);
      setSheetOpen(false);
      toast.info('Заявка отменена', 'Можете создать новую');
      await reload();
    } catch (e) {
      toast.error('Не удалось отменить', e instanceof ApiError ? e.code : (e as Error).message);
    }
  };

  const submitWithdraw = async () => {
    if (!selected) return;
    setBusy(true); setErr(null);
    try {
      const body: any = { method: selected.slug, amount };
      if (selected.kind === 'betra_payout') body.card = card;
      else if (selected.kind === 'westwallet') body.address = address;
      await api.post('/payments/withdraw', body);
      setErr(null);      setWithdrawDone(true);      toast.success('Заявка отправлена', `Вывод $${amount} принят в обработку`);
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
            {tab === 'deposit' && pending && (
              <PendingDepositBanner
                expiresAt={pending.expiresAt}
                onOpen={() => { setSheetOpen(true); setSheetMin(false); }}
                onCancel={cancelPending}
              />
            )}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {filtered.length === 0 && (
                <div className="game-card col-span-full px-3 py-6 text-center text-white/60">{t('wallet.no_methods')}</div>
              )}
              {filtered.map((m) => {
                const disabled = tab === 'deposit' && !!pending && m.kind === 'betra_card';
                return (
                <button
                  key={m.slug}
                  disabled={disabled}
                  onClick={() => {
                    setMethodSlug(m.slug);
                    setReqs(null); setErr(null); setCard(''); setAddress(''); setWithdrawDone(false);
                    if (tab === 'deposit') { setSheetOpen(true); setSheetMin(false); }
                    else if (tab === 'withdraw') { setWithdrawSheetOpen(true); setWithdrawSheetMin(false); }
                  }}
                  className={
                    'game-card flex flex-col items-center gap-2 p-3 transition ' +
                    (disabled ? 'cursor-not-allowed opacity-40 ' : 'hover:scale-[1.02] ') +
                    (methodSlug === m.slug ? 'ring-2 ring-game-yellow' : '')
                  }
                  title={disabled ? 'Дождитесь завершения текущей заявки или отмените её' : undefined}
                >
                  {m.iconUrl ? (
                    <img src={m.iconUrl} alt={m.label} className="w-2/3 max-w-[3.5rem] aspect-square object-contain" />
                  ) : (
                    <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-white/10 font-display text-xs text-white/70">
                      {m.currency.slice(0, 4)}
                    </div>
                  )}
                  <div className="text-center text-xs font-semibold text-white/90">{m.label}</div>
                </button>
              ); })}
            </div>
          </section>
        )}

        {tab !== 'history' && selected && tab === 'withdraw' && !withdrawSheetOpen && (
          <section className="flex flex-col gap-3 px-6 pt-4">
            <button
              type="button"
              onClick={() => { setWithdrawSheetOpen(true); setWithdrawSheetMin(false); }}
              className="game-btn game-btn-purple"
            >
              {t('wallet.withdraw')}
            </button>
          </section>
        )}

        {tab === 'history' && (
          <section className="px-6 pt-4">
            <ul className="space-y-2 text-sm">
              {history.length === 0 && (
                <li className="game-card px-3 py-4 text-center text-white/60">{t('wallet.empty')}</li>
              )}
              {history.map((p) => {
                // Don't leak the upstream payment provider name to the user
                // (BETRA, WESTWALLET, etc.) — show the kind of operation in
                // human-readable Russian instead. Falls back to the type tag.
                const opLabel = (() => {
                  const t = (p.type || '').toUpperCase();
                  if (t === 'DEPOSIT') return 'Пополнение';
                  if (t === 'WITHDRAWAL') return 'Вывод';
                  if (t === 'REFUND') return 'Возврат';
                  return p.type;
                })();
                const methodLabel = (() => {
                  const slug = p.methodSlug ?? '';
                  if (/card|карт/i.test(slug)) return 'Карта';
                  if (/sbp/i.test(slug)) return 'СБП';
                  if (/crypto|usdt|btc|trx|eth|ton/i.test(slug)) return 'Крипто';
                  if (slug) return slug.replace(/_/g, ' ');
                  return '';
                })();
                return (
                <li key={p.id} className="flex items-center justify-between rounded-xl border-2 border-white/10 bg-black/30 px-3 py-2">
                  <div>
                    <div className="font-display text-sm uppercase text-white/90">
                      {opLabel}{methodLabel && <span className="text-xs text-white/50"> · {methodLabel}</span>}
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
                );
              })}
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
          nativeHint={usdToNative(Number(amount) || 0, selected.currency)}
          minNativeUsd={selected.minAmount ? nativeToUsd(Number(selected.minAmount), selected.currency) : 0}
          maxNativeUsd={selected.maxAmount ? nativeToUsd(Number(selected.maxAmount), selected.currency) : 0}
          onAmountChange={setAmount}
          onSubmit={submitDeposit}
          minimized={sheetMin}
          onMinimize={() => setSheetMin((v) => !v)}
          onClose={() => { setSheetOpen(false); setReqs(null); setErr(null); setMethodSlug(null); }}
        />
      )}
      {withdrawSheetOpen && selected && tab === 'withdraw' && (
        <WithdrawSheet
          busy={busy}
          err={err}
          done={withdrawDone}
          balance={wallet ? Number(wallet.balance) : 0}
          selected={selected}
          amount={amount}
          nativeHint={usdToNative(Number(amount) || 0, selected.currency)}
          minNativeUsd={selected.minAmount ? nativeToUsd(Number(selected.minAmount), selected.currency) : 0}
          maxNativeUsd={selected.maxAmount ? nativeToUsd(Number(selected.maxAmount), selected.currency) : 0}
          card={card}
          address={address}
          onAmountChange={setAmount}
          onCardChange={setCard}
          onAddressChange={setAddress}
          onSubmit={submitWithdraw}
          minimized={withdrawSheetMin}
          onMinimize={() => setWithdrawSheetMin((v) => !v)}
          onClose={() => {
            setWithdrawSheetOpen(false); setErr(null); setMethodSlug(null);
            setCard(''); setAddress(''); setWithdrawDone(false);
          }}
        />
      )}
    </div>
  );
}

function DepositSheet({
  reqs, busy, loadingErr, isCrypto, selected, amount, nativeHint, minNativeUsd, maxNativeUsd,
  onAmountChange, onSubmit,
  minimized, onMinimize, onClose,
}: {
  reqs: DepositResponse | null;
  busy: boolean;
  loadingErr: string | null;
  isCrypto: boolean;
  selected: PaymentMethod;
  amount: string;
  nativeHint: number;
  minNativeUsd: number;
  maxNativeUsd: number;
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
            <Spinner label="Получаем адрес…" />
          )}
          {/* Loading betra requisites */}
          {busy && !reqs && !isCrypto && (
            <Spinner label="Создаём заявку и подбираем реквизиты…" />
          )}
          {/* Error */}
          {loadingErr && !reqs && (
            <div className="rounded-xl bg-rose-500/15 px-4 py-3 text-sm text-rose-300">{loadingErr}</div>
          )}
          {/* Amount input for non-crypto betra deposit */}
          {!reqs && !busy && !isCrypto && (
            <div className="flex flex-col gap-3 pt-2">
              <label className="text-[10px] uppercase tracking-widest text-white/50">
                Сумма пополнения ($)
              </label>
              <input
                inputMode="decimal"
                value={amount}
                onChange={(e) => onAmountChange(e.target.value.replace(/[^0-9.]/g, ''))}
                className="game-input font-mono text-xl"
                placeholder="$0.00"
              />
              {selected.currency && selected.currency !== 'USD' && Number(amount) > 0 && (
                <div className="text-xs text-white/60">
                  ≈ <span className="font-mono font-semibold text-white/90">{nativeHint.toFixed(2)} {selected.currency}</span> к оплате
                </div>
              )}
              {(minNativeUsd > 0 || maxNativeUsd > 0) && (
                <div className="text-xs text-white/50">
                  {minNativeUsd > 0 && `Мин: $${minNativeUsd.toFixed(2)}`}
                  {minNativeUsd > 0 && maxNativeUsd > 0 && ' · '}
                  {maxNativeUsd > 0 && `Макс: $${maxNativeUsd.toFixed(2)}`}
                </div>
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
  const masked = formatCard(b.card);
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
            <span className="font-mono text-lg tracking-widest">{masked}</span>
            <button
              onClick={() => onCopy(b.card!.replace(/\s+/g, ''))}
              className="game-btn game-btn-ghost game-btn-sm"
            >
              {copied === b.card.replace(/\s+/g, '') ? t('wallet.copied') : t('wallet.copy')}
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
          <img src={b.qrLink} alt="QR" className="w-full max-w-[12rem] aspect-square rounded-lg bg-white p-2 object-contain" />
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

// ─── 15-minute pending deposit banner with live countdown ───────────────────
function PendingDepositBanner({
  expiresAt, onOpen, onCancel,
}: {
  expiresAt: string;
  onOpen: () => void;
  onCancel: () => void;
}) {
  const target = new Date(expiresAt).getTime();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const remainMs = Math.max(0, target - now);
  const mm = Math.floor(remainMs / 60000);
  const ss = Math.floor((remainMs % 60000) / 1000);
  const expired = remainMs <= 0;
  return (
    <div className="mb-3 rounded-xl border-2 border-amber-400/40 bg-amber-400/10 px-4 py-3">
      <div className="flex items-center gap-3">
        <svg viewBox="0 0 24 24" className="h-6 w-6 shrink-0 text-amber-300" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" strokeLinecap="round" />
        </svg>
        <div className="flex-1">
          <div className="text-sm font-semibold text-amber-100">У вас уже есть активная заявка на пополнение</div>
          <div className="text-xs text-white/70">
            {expired
              ? 'Время истекло. Обновите страницу для создания новой заявки.'
              : <>Истекает через <span className="font-mono font-bold text-amber-200">{mm}:{String(ss).padStart(2, '0')}</span></>}
          </div>
        </div>
      </div>
      <div className="mt-2 flex gap-2">
        <button type="button" onClick={onOpen} className="game-btn game-btn-yellow game-btn-sm flex-1">
          Открыть реквизиты
        </button>
        <button type="button" onClick={onCancel} className="game-btn game-btn-ghost game-btn-sm">
          Отменить
        </button>
      </div>
    </div>
  );
}

// ─── Withdraw drawer (mirrors DepositSheet UX) ─────────────────────────────
function WithdrawSheet({
  busy, err, done, balance, selected, amount, nativeHint, minNativeUsd, maxNativeUsd, card, address,
  onAmountChange, onCardChange, onAddressChange, onSubmit,
  minimized, onMinimize, onClose,
}: {
  busy: boolean;
  err: string | null;
  done: boolean;
  balance: number;
  selected: PaymentMethod;
  amount: string;
  nativeHint: number;
  minNativeUsd: number;
  maxNativeUsd: number;
  card: string;
  address: string;
  onAmountChange: (v: string) => void;
  onCardChange: (v: string) => void;
  onAddressChange: (v: string) => void;
  onSubmit: () => void;
  minimized: boolean;
  onMinimize: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [drag, setDrag] = useState<{ startY: number; dy: number } | null>(null);
  const sheetRef = useRef<HTMLDivElement>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    setDrag({ startY: e.clientY, dy: 0 });
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag) return;
    setDrag({ ...drag, dy: e.clientY - drag.startY });
  };
  const onPointerUp = () => {
    if (!drag) return;
    const { dy } = drag;
    setDrag(null);
    if (dy > 60 && !minimized) onMinimize();
    else if (dy < -60 && minimized) onMinimize();
  };
  const translatePx = drag
    ? Math.max(minimized ? -200 : 0, Math.min(minimized ? 0 : 200, drag.dy))
    : 0;

  const isCrypto = selected.kind === 'westwallet';
  const isCard = selected.kind === 'betra_payout';
  const amt = Number(amount) || 0;
  const detailsOk = isCrypto ? address.trim().length >= 10 : isCard ? card.length >= 12 : true;
  const balanceOk = amt <= balance;
  const minOk = !minNativeUsd || amt >= minNativeUsd;
  const maxOk = !maxNativeUsd || amt <= maxNativeUsd;
  const canSubmit = !busy && amt > 0 && detailsOk && balanceOk && minOk && maxOk;

  return (
    <div className="pointer-events-none fixed inset-0 z-40 flex justify-center">
      <div
        ref={sheetRef}
        className={
          'pointer-events-auto absolute bottom-0 w-full max-w-md transform rounded-t-3xl border-2 border-b-0 border-game-purple/40 bg-bg/95 shadow-[0_-12px_30px_rgba(0,0,0,0.6)] backdrop-blur-md transition-transform duration-200 ' +
          (drag ? '' : 'ease-out')
        }
        style={{
          transform: `translateY(${minimized ? 'calc(100% - 64px)' : '0px'}) translateY(${translatePx}px)`,
        }}
      >
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
          <div className="font-display text-base text-game-purple">
            {t('wallet.withdraw')} · {selected.label}
          </div>
          <div className="flex gap-1">
            <button onClick={onMinimize} className="game-btn game-btn-ghost game-btn-sm" title={minimized ? 'expand' : 'collapse'}>
              {minimized ? '▴' : '▾'}
            </button>
            <button onClick={onClose} className="game-btn game-btn-ghost game-btn-sm" title="close">✕</button>
          </div>
        </div>

        <div className={'overflow-y-auto px-5 pb-6 transition-opacity duration-200 ' + (minimized ? 'opacity-0' : 'opacity-100')}
          style={{ maxHeight: '70vh' }}>
          {done ? (
            <div className="flex flex-col items-center gap-3 py-6">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-game-green/20 text-3xl text-game-green">✓</div>
              <div className="font-display text-lg text-white">{t('wallet.withdraw_submitted', 'Заявка отправлена')}</div>
              <div className="text-center text-sm text-white/60">
                {t('wallet.withdraw_submitted_hint', 'Заявка передана на проверку администратору. Статус виден в истории.')}
              </div>
              <button onClick={onClose} className="game-btn game-btn-ghost mt-2">{t('wallet.close', 'Закрыть')}</button>
            </div>
          ) : (
            <div className="flex flex-col gap-3 pt-1">
              <div className="rounded-xl bg-black/40 px-4 py-3">
                <div className="text-[10px] uppercase tracking-widest text-white/50">{t('wallet.balance')}</div>
                <div className="font-mono text-xl font-bold text-white">${balance.toFixed(2)}</div>
              </div>

              <div>
                <label className="mb-1 block text-[10px] uppercase tracking-widest text-white/50">
                  Сумма к выводу ($)
                </label>
                <input
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => onAmountChange(e.target.value.replace(/[^0-9.]/g, ''))}
                  className="game-input font-mono text-xl"
                  placeholder="$0.00"
                />
                {selected.currency && selected.currency !== 'USD' && amt > 0 && (
                  <div className="mt-1 text-xs text-white/60">
                    ≈ <span className="font-mono font-semibold text-white/90">{nativeHint.toFixed(2)} {selected.currency}</span> к получению
                  </div>
                )}
                <div className="mt-1 flex items-center justify-between text-[11px] text-white/50">
                  <span>
                    {minNativeUsd > 0 && `Мин: $${minNativeUsd.toFixed(2)}`}
                    {minNativeUsd > 0 && maxNativeUsd > 0 && ' · '}
                    {maxNativeUsd > 0 && `Макс: $${maxNativeUsd.toFixed(2)}`}
                  </span>
                  <button
                    type="button"
                    onClick={() => onAmountChange(String(balance.toFixed(2)))}
                    className="text-game-yellow underline-offset-2 hover:underline"
                  >
                    Все (${balance.toFixed(2)})
                  </button>
                </div>
              </div>

              {isCard && (
                <div>
                  <label className="mb-1 block text-[10px] uppercase tracking-widest text-white/50">
                    {t('wallet.card_number')}
                  </label>
                  <input
                    value={formatCard(card)}
                    onChange={(e) => onCardChange(e.target.value.replace(/[^0-9]/g, '').slice(0, 19))}
                    className="game-input font-mono tracking-widest"
                    placeholder="0000 0000 0000 0000"
                    maxLength={23}
                    inputMode="numeric"
                  />
                </div>
              )}
              {isCrypto && (
                <div>
                  <label className="mb-1 block text-[10px] uppercase tracking-widest text-white/50">
                    {selected.currency} {t('wallet.address', 'адрес')}
                  </label>
                  <input
                    value={address}
                    onChange={(e) => onAddressChange(e.target.value.trim())}
                    className="game-input font-mono text-sm"
                    placeholder={`${selected.currency} address`}
                  />
                  <div className="mt-1 text-[11px] text-white/50">
                    Внимательно проверьте адрес — отмена невозможна.
                  </div>
                </div>
              )}

              {!balanceOk && (
                <div className="rounded-md bg-rose-500/15 px-3 py-2 text-xs text-rose-300">
                  Сумма больше доступного баланса
                </div>
              )}
              {err && (
                <div className="rounded-md bg-rose-500/15 px-3 py-2 text-xs text-rose-300">{err}</div>
              )}

              <button
                type="button"
                disabled={!canSubmit}
                onClick={onSubmit}
                className="game-btn game-btn-purple"
              >
                {busy ? '…' : t('wallet.submit_withdraw', 'Отправить заявку')}
              </button>
              <div className="text-center text-[11px] text-white/40">
                Заявка попадёт в очередь администратора. Деньги будут списаны при создании заявки.
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
