import { useEffect, useState } from 'react';
import { api } from '../../../shared/api/client';

interface Stats {
  users: number;
  banned: number;
  matchesTotal: number;
  matchesRunning: number;
  matchesDisputed: number;
  grossVolumeUsd: string;
  commissionUsd: string;
  pendingPayouts: number;
}

const fmt = (v: number | string) => {
  const n = typeof v === 'string' ? Number(v) : v;
  return n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
};
const money = (v: string) => `$${Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function StatCard({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string;
  value: string;
  hint?: string | undefined;
  tone?: 'default' | 'success' | 'warning' | 'danger' | 'accent';
}) {
  const tones = {
    default: 'border-white/10',
    success: 'border-green-500/30',
    warning: 'border-yellow-500/30',
    danger: 'border-red-500/30',
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

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      setS(await api.get<Stats>('/admin/stats/dashboard'));
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'load failed');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  if (err) return <div className="rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{err}</div>;
  if (!s) return <div className="text-sm text-white/50">Loading…</div>;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div className="text-sm text-white/60">Live snapshot of platform activity</div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white/80 hover:bg-white/10 disabled:opacity-40"
        >
          {loading ? 'refreshing…' : '↻ refresh'}
        </button>
      </div>

      <section>
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-white/40">Players</h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <StatCard label="Total users" value={fmt(s.users)} />
          <StatCard label="Banned" value={fmt(s.banned)} tone={s.banned > 0 ? 'danger' : 'default'} />
        </div>
      </section>

      <section>
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-white/40">Matches</h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <StatCard label="Total" value={fmt(s.matchesTotal)} />
          <StatCard label="Running now" value={fmt(s.matchesRunning)} tone={s.matchesRunning > 0 ? 'success' : 'default'} />
          <StatCard
            label="Disputed"
            value={fmt(s.matchesDisputed)}
            tone={s.matchesDisputed > 0 ? 'danger' : 'default'}
            hint={s.matchesDisputed > 0 ? 'Needs review' : undefined}
          />
        </div>
      </section>

      <section>
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-white/40">Economy</h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <StatCard label="Gross volume" value={money(s.grossVolumeUsd)} tone="accent" hint="Stakes + shop" />
          <StatCard label="Commission" value={money(s.commissionUsd)} tone="success" hint="Platform revenue" />
          <StatCard
            label="Pending payouts"
            value={fmt(s.pendingPayouts)}
            tone={s.pendingPayouts > 0 ? 'warning' : 'default'}
            hint={s.pendingPayouts > 0 ? 'Awaiting approval' : undefined}
          />
        </div>
      </section>
    </div>
  );
}
