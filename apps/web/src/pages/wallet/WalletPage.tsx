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
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-white/10 px-5 py-3">
        <button
          type="button"
          onClick={() => nav('/home')}
          className="rounded px-2 py-1 text-white/70 hover:bg-white/10"
        >
          ← {t('wallet.back')}
        </button>
        <div className="ml-auto text-xs text-white/50">{t('wallet.title')}</div>
      </header>

      <section className="flex flex-col items-center gap-1 px-6 pt-6">
        <div className="text-xs uppercase tracking-widest text-white/40">{t('wallet.balance')}</div>
        <div className="font-mono text-4xl">
          ${wallet ? Number(wallet.balance).toFixed(2) : '—'}
        </div>
        {wallet && Number(wallet.locked) > 0 && (
          <div className="text-xs text-white/50">
            {t('wallet.locked')}: ${Number(wallet.locked).toFixed(2)}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-2 px-6 pt-6">
        <input
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
          className="rounded-lg bg-surface px-4 py-3 font-mono text-lg outline-none focus:ring-2 focus:ring-accent"
          placeholder="0.00"
        />
        <div className="flex gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void submit('deposit')}
            className="flex-1 rounded-lg bg-accent px-4 py-3 font-bold text-bg disabled:opacity-50"
          >
            {t('wallet.deposit')}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void submit('withdraw')}
            className="flex-1 rounded-lg bg-surface px-4 py-3 text-white/80 disabled:opacity-50 hover:bg-white/10"
          >
            {t('wallet.withdraw')}
          </button>
        </div>
        {msg && <div className="text-center text-xs text-white/60">{msg}</div>}
      </section>

      <section className="mt-6 flex flex-col overflow-hidden">
        <div className="flex border-b border-white/10 px-6 text-sm">
          {(['ledger', 'payments'] as Tab[]).map((tt) => (
            <button
              key={tt}
              type="button"
              onClick={() => setTab(tt)}
              className={
                'px-3 py-2 ' +
                (tab === tt ? 'border-b-2 border-accent text-white' : 'text-white/50')
              }
            >
              {t(`wallet.tab_${tt}`)}
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-3">
          {tab === 'ledger' && (
            <ul className="space-y-2 text-sm">
              {ledger.length === 0 && <li className="text-white/40">{t('wallet.empty')}</li>}
              {ledger.map((l) => (
                <li
                  key={l.id}
                  className="flex items-center justify-between rounded bg-surface/50 px-3 py-2"
                >
                  <div>
                    <div className="text-white/80">{l.type}</div>
                    <div className="text-xs text-white/40">
                      {new Date(l.createdAt).toLocaleString()}
                    </div>
                  </div>
                  <div
                    className={'font-mono ' + (l.amount.startsWith('-') ? 'text-red-400' : 'text-emerald-400')}
                  >
                    {l.amount.startsWith('-') ? l.amount : '+' + l.amount}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {tab === 'payments' && (
            <ul className="space-y-2 text-sm">
              {payments.length === 0 && <li className="text-white/40">{t('wallet.empty')}</li>}
              {payments.map((p) => (
                <li
                  key={p.id}
                  className="flex items-center justify-between rounded bg-surface/50 px-3 py-2"
                >
                  <div>
                    <div className="text-white/80">
                      {p.type} <span className="text-xs text-white/40">({p.provider})</span>
                    </div>
                    <div className="text-xs text-white/40">
                      {new Date(p.createdAt).toLocaleString()} · {p.status}
                    </div>
                  </div>
                  <div className="font-mono text-white/90">${Number(p.amountUsd).toFixed(2)}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
