import { useEffect, useState } from 'react';
import { api } from '../../../shared/api/client';

interface Stats {
  users: { total: number; banned: number; new24h: number; new7d: number; online?: number };
  matches: { total: number; running: number; disputed: number; today: number };
  finance: {
    grossVolumeUsd: string;
    commissionUsd: string;
    depositsToday: string;
    withdrawalsToday: string;
    pendingPayouts: number;
    pendingPayoutsAmount: string;
    failedPayments24h: number;
    walletBalanceTotal: string;
    walletLockedTotal: string;
  };
  topRooms: Array<{ roomId: number; name: string; stake: string | null; matches24h: number }>;
  bots?: {
    total: number;
    today: number;
    last7d: number;
    sharePct: number;
    netSystemUsd: string;
    commissionUsd: string;
  };
}

const fmt = (v: number | string) => {
  const n = typeof v === 'string' ? Number(v) : v;
  return n.toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
};
const money = (v: string | number) => {
  const n = typeof v === 'string' ? Number(v) : v;
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

function StatCard({
  label, value, hint, tone = 'default',
}: {
  label: string; value: string; hint?: string;
  tone?: 'default' | 'success' | 'warning' | 'danger' | 'accent';
}) {
  const tones: Record<string, string> = {
    default: 'border-white/10',
    success: 'border-emerald-500/30',
    warning: 'border-amber-500/30',
    danger: 'border-rose-500/30',
    accent: 'border-accent/40',
  };
  return (
    <div className={`rounded-lg border ${tones[tone]} bg-surface px-4 py-4`}>
      <div className="text-[11px] font-medium uppercase tracking-wider text-white/50">{label}</div>
      <div className="mt-1.5 text-2xl font-semibold tabular-nums">{value}</div>
      {hint && <div className="mt-1 text-xs text-white/40">{hint}</div>}
    </div>
  );
}

export function DashboardTab() {
  const [s, setS] = useState<Stats | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [online, setOnline] = useState<number | null>(null);

  async function load() {
    setLoading(true); setErr(null);
    try {
      const data = await api.get<Stats>('/admin/stats/dashboard');
      setS(data);
      if (typeof data.users.online === 'number') setOnline(data.users.online);
      setUpdatedAt(new Date());
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Не удалось загрузить');
    } finally { setLoading(false); }
  }

  async function loadOnline() {
    try {
      const r = await api.get<{ online: number }>('/admin/stats/online');
      setOnline(r.online);
    } catch {
      // ignore — main load() will re-sync
    }
  }

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 30_000);
    const tOnline = setInterval(() => void loadOnline(), 5_000);
    return () => { clearInterval(t); clearInterval(tOnline); };
  }, []);

  if (err) return <div className="rounded-md border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{err}</div>;
  if (!s) return <div className="text-sm text-white/50">Загрузка…</div>;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div className="text-sm text-white/60">
          Сводка активности платформы
          {updatedAt && <span className="ml-2 text-xs text-white/40">· обновлено {updatedAt.toLocaleTimeString('ru-RU')}</span>}
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white/80 hover:bg-white/10 disabled:opacity-40"
        >
          {loading ? 'обновление…' : '↻ Обновить'}
        </button>
      </div>

      <section>
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-white/40">Игроки</h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard
            label="Онлайн сейчас"
            value={online == null ? '—' : fmt(online)}
            tone={online && online > 0 ? 'success' : 'default'}
            hint="Обновляется каждые 5 сек"
          />
          <StatCard label="Всего пользователей" value={fmt(s.users.total)} />
          <StatCard label="Новых за 24ч" value={fmt(s.users.new24h)} tone={s.users.new24h > 0 ? 'success' : 'default'} hint="Регистрации" />
          <StatCard label="Новых за 7 дней" value={fmt(s.users.new7d)} hint="Регистрации" />
          <StatCard label="Заблокированы" value={fmt(s.users.banned)} tone={s.users.banned > 0 ? 'danger' : 'default'} />
        </div>
      </section>

      <section>
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-white/40">Матчи</h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="Всего" value={fmt(s.matches.total)} />
          <StatCard label="Сегодня" value={fmt(s.matches.today)} hint="С начала суток" />
          <StatCard label="Сейчас идут" value={fmt(s.matches.running)} tone={s.matches.running > 0 ? 'success' : 'default'} />
          <StatCard
            label="Спорные"
            value={fmt(s.matches.disputed)}
            tone={s.matches.disputed > 0 ? 'danger' : 'default'}
            {...(s.matches.disputed > 0 ? { hint: 'Требуют разбора' } : {})}
          />
        </div>
      </section>

      <section>
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-white/40">Финансы</h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="Депозиты сегодня" value={money(s.finance.depositsToday)} tone="success" hint="Зачислено за сутки" />
          <StatCard label="Выводы сегодня" value={money(s.finance.withdrawalsToday)} hint="Выплачено за сутки" />
          <StatCard
            label="Ожидают выплаты"
            value={`${fmt(s.finance.pendingPayouts)} · ${money(s.finance.pendingPayoutsAmount)}`}
            tone={s.finance.pendingPayouts > 0 ? 'warning' : 'default'}
            hint={s.finance.pendingPayouts > 0 ? 'Требуют подтверждения' : 'Очередь пуста'}
          />
          <StatCard
            label="Ошибки оплат 24ч"
            value={fmt(s.finance.failedPayments24h)}
            tone={s.finance.failedPayments24h > 0 ? 'danger' : 'default'}
          />
          <StatCard label="Оборот (всего)" value={money(s.finance.grossVolumeUsd)} tone="accent" hint="Ставки + магазин" />
          <StatCard label="Комиссия (всего)" value={money(s.finance.commissionUsd)} tone="success" hint="Доход платформы" />
          <StatCard label="Балансы кошельков" value={money(s.finance.walletBalanceTotal)} hint="Сумма по всем игрокам" />
          <StatCard label="Залочено" value={money(s.finance.walletLockedTotal)} hint="В активных матчах" />
        </div>
      </section>

      <section>
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-white/40">Топ комнат за 24ч</h3>
        {s.topRooms.length === 0 ? (
          <div className="rounded-md border border-white/10 bg-surface px-4 py-3 text-sm text-white/50">Нет матчей за последние 24 часа</div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-white/10">
            <table className="w-full text-sm">
              <thead className="bg-white/5 text-left text-[11px] uppercase tracking-wider text-white/50">
                <tr>
                  <th className="px-4 py-2">Комната</th>
                  <th className="px-4 py-2">Ставка</th>
                  <th className="px-4 py-2 text-right">Матчей за 24ч</th>
                </tr>
              </thead>
              <tbody>
                {s.topRooms.map((r) => (
                  <tr key={r.roomId} className="border-t border-white/5">
                    <td className="px-4 py-2 text-white/90">{r.name}</td>
                    <td className="px-4 py-2 font-mono text-white/70">{r.stake ? money(r.stake) : '—'}</td>
                    <td className="px-4 py-2 text-right font-semibold tabular-nums">{fmt(r.matches24h)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {s.bots && (
        <section>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-white/40">Боты</h3>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard label="Игр с ботами (всего)" value={fmt(s.bots.total)} hint={`${s.bots.sharePct}% от всех матчей`} />
            <StatCard label="Сегодня" value={fmt(s.bots.today)} tone={s.bots.today > 0 ? 'success' : 'default'} />
            <StatCard label="За 7 дней" value={fmt(s.bots.last7d)} />
            <StatCard label="Чистый доход с ботов" value={money(s.bots.netSystemUsd)} tone="success" hint="System wallet net" />
            <StatCard label="Комиссия с ботов" value={money(s.bots.commissionUsd)} tone="accent" hint="5% rake на ботовых матчах" />
          </div>
        </section>
      )}
    </div>
  );
}
