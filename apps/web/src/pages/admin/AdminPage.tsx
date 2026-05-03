import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../../shared/api/client';
import { useAuth, type Me } from '../../shared/store/auth';
import { DashboardTab } from './tabs/DashboardTab';
import { UsersTab } from './tabs/UsersTab';
import { RoomsTab } from './tabs/RoomsTab';
import { ContentTab } from './tabs/ContentTab';
import { MatchesTab } from './tabs/MatchesTab';
import { PaymentsTab } from './tabs/PaymentsTab';
import { SettingsTab } from './tabs/SettingsTab';

type Tab = 'dash' | 'users' | 'rooms' | 'content' | 'matches' | 'payments' | 'settings';

const TABS: { key: Tab; label: string }[] = [
  { key: 'dash', label: 'Stats' },
  { key: 'users', label: 'Users' },
  { key: 'rooms', label: 'Rooms' },
  { key: 'content', label: 'Content' },
  { key: 'matches', label: 'Matches' },
  { key: 'payments', label: 'Payments' },
  { key: 'settings', label: 'Settings' },
];

export function AdminPage() {
  const nav = useNavigate();
  const me = useAuth((s) => s.me);
  const setMe = useAuth((s) => s.setMe);
  const [tab, setTab] = useState<Tab>('dash');

  useEffect(() => {
    void (async () => {
      try {
        const u = await api.get<Me>('/auth/me');
        setMe(u);
        if (u.role !== 'ADMIN') nav('/home');
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) nav('/');
      }
    })();
  }, [nav, setMe]);

  if (!me || me.role !== 'ADMIN') return null;

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-white/10 px-3 py-2">
        <button
          type="button"
          onClick={() => nav('/home')}
          className="rounded px-2 py-1 text-xs text-white/70 hover:bg-white/10"
        >
          ← back
        </button>
        <h2 className="text-sm font-semibold">Admin · @{me.username}</h2>
        <span className="w-12" />
      </header>

      <nav className="flex gap-1 overflow-x-auto border-b border-white/10 px-2 py-1 text-xs">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={
              'shrink-0 rounded px-2 py-1 ' +
              (tab === t.key ? 'bg-accent text-bg font-semibold' : 'text-white/70 hover:bg-white/10')
            }
          >
            {t.label}
          </button>
        ))}
      </nav>

      <main className="flex-1 overflow-y-auto px-3 py-3 text-sm">
        {tab === 'dash' && <DashboardTab />}
        {tab === 'users' && <UsersTab />}
        {tab === 'rooms' && <RoomsTab />}
        {tab === 'content' && <ContentTab />}
        {tab === 'matches' && <MatchesTab />}
        {tab === 'payments' && <PaymentsTab />}
        {tab === 'settings' && <SettingsTab />}
      </main>
    </div>
  );
}
