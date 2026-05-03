import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../../shared/api/client';

interface Wallet {
  balance: string;
  locked: string;
  updatedAt: string;
}

interface LedgerItem {
  id: string;
  amount: string;
  type: string;
  refType: string | null;
  refId: string | null;
  createdAt: string;
}

interface PaymentItem {
  id: string;
  type: string;
  status: string;
  amountUsd: string;
  provider: string;
  createdAt: string;
}

type Tab = 'ledger' | 'payments';

export function WalletPage() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [ledger, setLedger] = useState<LedgerItem[]>([]);
  const [payments, setPayments] = useState<PaymentItem[]>([]);
  const [tab, setTab] = useState<Tab>('ledger');
  const [amount, setAmount] = useState('10');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const reload = async () => {
    try {
      const w = await api.get<Wallet>('/wallet');
      setWallet(w);
      const l = await api.get<{ items: LedgerItem[] }>('/wallet/ledger?limit=50');
      setLedger(l.items);
      const p = await api.get<{ items: PaymentItem[] }>('/payments/me?limit=50');
      setPayments(p.items);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) nav('/');
    }
  };

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = async (op: 'deposit' | 'withdraw') => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api.post<{ paymentId: string; status: string; balance: string }>(
        `/payments/${op}`,
        { amountUsd: amount },
      );
      setMsg(t(`wallet.${op}_ok`, { amount, status: r.status }));
      await reload();
    } catch (e) {
      const code = e instanceof ApiError ? e.code : 'ERROR';
      setMsg(`${t('wallet.error')}: ${code}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      <div className="pointer-events-none absolute -top-32 -left-20 h-72 w-72 rounded-full bg-game-green/30 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-32 -right-20 h-72 w-72 rounded-full bg-game-purple/30 blur-3xl" />

      <header className="game-panel relative z-10 flex items-center justify-between px-4 py-3">
        <button
          type="button"
          onClick={() => nav('/home')}
          className="game-btn game-btn-ghost game-btn-sm"
        >
          ← {t('wallet.back')}
        </button>
        <h2 className="game-title text-xl text-game-yellow">{t('wallet.title')}</h2>
        <div className="w-12" />
      </header>

      <div className="relative z-10 flex flex-1 flex-col overflow-y-auto">
        <section className="flex flex-col items-center gap-2 px-6 pt-6">
          <div className="text-xs font-semibold uppercase tracking-widest text-white/60">
            {t('wallet.balance')}
          </div>
          <div className="game-title text-5xl text-game-yellow drop-shadow-[0_4px_0_rgba(0,0,0,0.4)]">
            ${wallet ? Number(wallet.balance).toFixed(2) : '—'}
          </div>
          {wallet && Number(wallet.locked) > 0 && (
            <div className="game-chip text-xs">
              {t('wallet.locked')}: ${Number(wallet.locked).toFixed(2)}
            </div>
          )}
        </section>

        <section className="flex flex-col gap-3 px-6 pt-6">
          <input
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
            className="game-input font-mono text-xl"
            placeholder="0.00"
          />
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              disabled={busy}
              onClick={() => void submit('deposit')}
              className="game-btn game-btn-green"
            >
              {t('wallet.deposit')}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void submit('withdraw')}
              className="game-btn game-btn-purple"
            >
              {t('wallet.withdraw')}
            </button>
          </div>
          {msg && <div className="text-center text-xs text-white/70">{msg}</div>}
        </section>

        <section className="mt-6 flex flex-col">
          <div className="flex gap-2 px-6">
            {(['ledger', 'payments'] as Tab[]).map((tt) => (
              <button
                key={tt}
                type="button"
                onClick={() => setTab(tt)}
                className={
                  'game-btn game-btn-sm flex-1 ' +
                  (tab === tt ? 'game-btn-yellow' : 'game-btn-ghost')
                }
              >
                {t(`wallet.tab_${tt}`)}
              </button>
            ))}
          </div>
          <div className="px-6 py-3">
            {tab === 'ledger' && (
              <ul className="space-y-2 text-sm">
                {ledger.length === 0 && (
                  <li className="game-card px-3 py-4 text-center text-white/60">
                    {t('wallet.empty')}
                  </li>
                )}
                {ledger.map((l) => (
                  <li
                    key={l.id}
                    className="flex items-center justify-between rounded-xl border-2 border-white/10 bg-black/30 px-3 py-2"
                  >
                    <div>
                      <div className="font-display text-sm uppercase text-white/90">
                        {l.type}
                      </div>
                      <div className="text-xs text-white/50">
                        {new Date(l.createdAt).toLocaleString()}
                      </div>
                    </div>
                    <div
                      className={
                        'font-mono font-bold ' +
                        (l.amount.startsWith('-') ? 'text-game-red' : 'text-game-green')
                      }
                    >
                      {l.amount.startsWith('-') ? l.amount : '+' + l.amount}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {tab === 'payments' && (
              <ul className="space-y-2 text-sm">
                {payments.length === 0 && (
                  <li className="game-card px-3 py-4 text-center text-white/60">
                    {t('wallet.empty')}
                  </li>
                )}
                {payments.map((p) => (
                  <li
                    key={p.id}
                    className="flex items-center justify-between rounded-xl border-2 border-white/10 bg-black/30 px-3 py-2"
                  >
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
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
