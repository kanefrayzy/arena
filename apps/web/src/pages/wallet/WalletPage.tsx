import { useEffect, useState } from 'react';
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
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [reqs, setReqs] = useState<DepositResponse | null>(null);

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

  const submitDeposit = async () => {
    if (!selected) return;
    setBusy(true); setMsg(null); setErr(null); setReqs(null);
    try {
      const r = await api.post<DepositResponse>('/payments/deposit', { method: selected.slug, amount });
      setReqs(r);
      setMsg(t('wallet.deposit_started'));
      await reload();
    } catch (e) {
      setErr(e instanceof ApiError ? `${e.code}` : (e as Error).message);
    } finally { setBusy(false); }
  };

  const submitWithdraw = async () => {
    if (!selected) return;
    setBusy(true); setMsg(null); setErr(null);
    try {
      const body: any = { method: selected.slug, amount };
      if (selected.kind === 'betra_payout') body.card = card;
      else if (selected.kind === 'westwallet') body.address = address;
      await api.post('/payments/withdraw', body);
      setMsg(t('wallet.withdraw_ok'));
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

      <div className="relative z-10 flex flex-1 flex-col overflow-y-auto pb-6">
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
              onClick={() => { setTab(tt); setMethodSlug(null); setReqs(null); setMsg(null); setErr(null); }}
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
                  onClick={() => { setMethodSlug(m.slug); setReqs(null); setMsg(null); setErr(null); }}
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

        {tab !== 'history' && selected && (
          <section className="flex flex-col gap-3 px-6 pt-4">
            <input
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
              className="game-input font-mono text-xl"
              placeholder={`Amount in ${selected.currency}`}
            />
            {tab === 'withdraw' && selected.kind === 'betra_payout' && (
              <input
                value={card}
                onChange={(e) => setCard(e.target.value.replace(/[^0-9]/g, ''))}
                className="game-input font-mono"
                placeholder={t('wallet.card_number')}
                maxLength={20}
              />
            )}
            {tab === 'withdraw' && selected.kind === 'westwallet' && (
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
              onClick={() => (tab === 'deposit' ? void submitDeposit() : void submitWithdraw())}
              className={'game-btn ' + (tab === 'deposit' ? 'game-btn-green' : 'game-btn-purple')}
            >
              {tab === 'deposit' ? t('wallet.deposit') : t('wallet.withdraw')}
            </button>
            {err && <div className="text-center text-sm font-semibold text-game-red">{err}</div>}
            {msg && <div className="text-center text-sm font-semibold text-game-green">{msg}</div>}

            {/* Betra card requisites */}
            {reqs?.betra && (
              <div className="game-card flex flex-col gap-2 p-4">
                <div className="font-display text-base text-game-yellow">{t('wallet.pay_to_card')}</div>
                {reqs.betra.card && (
                  <div className="flex items-center justify-between gap-2 rounded-lg bg-black/40 px-3 py-2">
                    <span className="font-mono text-lg">{reqs.betra.card}</span>
                    <button onClick={() => navigator.clipboard.writeText(reqs.betra!.card!)} className="game-btn game-btn-ghost game-btn-sm">
                      {t('wallet.copy')}
                    </button>
                  </div>
                )}
                {reqs.betra.cardHolder && <div className="text-sm text-white/80">{reqs.betra.cardHolder}</div>}
                {reqs.betra.bank && <div className="text-xs text-white/60">{reqs.betra.bank}</div>}
                <div className="text-sm font-semibold text-white">
                  {Number(reqs.betra.amount).toFixed(2)} {reqs.betra.currency}
                </div>
                {reqs.betra.qrLink && (
                  <a href={reqs.betra.qrLink} target="_blank" rel="noreferrer" className="game-btn game-btn-yellow game-btn-sm">
                    {t('wallet.open_qr')}
                  </a>
                )}
                {reqs.betra.expiredAt && (
                  <div className="text-xs text-white/50">
                    {t('wallet.expires_at')}: {new Date(reqs.betra.expiredAt).toLocaleString()}
                  </div>
                )}
              </div>
            )}

            {/* Crypto static address */}
            {reqs?.crypto && (
              <div className="game-card flex flex-col gap-2 p-4">
                <div className="font-display text-base text-game-yellow">{t('wallet.send_to_address')}</div>
                <div className="flex items-center justify-between gap-2 rounded-lg bg-black/40 px-3 py-2">
                  <span className="break-all font-mono text-sm">{reqs.crypto.address}</span>
                  <button onClick={() => navigator.clipboard.writeText(reqs.crypto!.address)} className="game-btn game-btn-ghost game-btn-sm shrink-0">
                    {t('wallet.copy')}
                  </button>
                </div>
                {reqs.crypto.destTag && (
                  <div className="text-xs text-white/70">Memo / Dest tag: <span className="font-mono">{reqs.crypto.destTag}</span></div>
                )}
                <div className="text-xs text-white/50">{t('wallet.address_static_note', { currency: reqs.crypto.currency })}</div>
              </div>
            )}
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
    </div>
  );
}
