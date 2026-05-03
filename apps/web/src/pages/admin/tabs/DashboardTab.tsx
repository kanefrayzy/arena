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

export function DashboardTab() {
  const [s, setS] = useState<Stats | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    try {
      setS(await api.get<Stats>('/admin/stats/dashboard'));
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'load failed');
    }
  }

  useEffect(() => {
    void load();
  }, []);

  if (err) return <div className="text-red-400">{err}</div>;
  if (!s) return <div className="text-white/50">…</div>;

  const card = (label: string, value: string | number) => (
    <div className="rounded-lg bg-surface px-3 py-2">
      <div className="text-xs uppercase text-white/50">{label}</div>
      <div className="mt-1 font-mono text-base">{value}</div>
    </div>
  );

  return (
    <div className="grid grid-cols-2 gap-2">
      {card('Users', s.users)}
      {card('Banned', s.banned)}
      {card('Matches', s.matchesTotal)}
      {card('Running', s.matchesRunning)}
      {card('Disputed', s.matchesDisputed)}
      {card('Pending Payouts', s.pendingPayouts)}
      {card('Gross $', Number(s.grossVolumeUsd).toFixed(2))}
      {card('Commission $', Number(s.commissionUsd).toFixed(2))}
      <button
        type="button"
        onClick={() => void load()}
        className="col-span-2 rounded bg-white/10 py-1 text-xs hover:bg-white/20"
      >
        refresh
      </button>
    </div>
  );
}
