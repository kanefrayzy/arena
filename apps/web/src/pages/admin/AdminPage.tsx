import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../../shared/api/client';
import { useAuth, type Me } from '../../shared/store/auth';
import { DashboardTab } from './tabs/DashboardTab';
import { UsersTab } from './tabs/UsersTab';
import { RoomsTab } from './tabs/RoomsTab';
import { ContentTab } from './tabs/ContentTab';
import { MatchesTab } from './tabs/MatchesTab';
import { PaymentsTab } from './tabs/PaymentsTab';
import { WithdrawalsTab } from './tabs/WithdrawalsTab';
import { PaymentMethodsTab } from './tabs/PaymentMethodsTab';
import { SettingsTab } from './tabs/SettingsTab';
import { SpritesTab } from './tabs/SpritesTab';
import { AbilitiesTab } from './tabs/AbilitiesTab';
import { BrandingTab } from './tabs/BrandingTab';
import { ReportsTab } from './tabs/ReportsTab';
import { LanguagesTab } from './tabs/LanguagesTab';

type Tab = 'dash' | 'users' | 'rooms' | 'content' | 'matches' | 'payments' | 'withdrawals' | 'methods' | 'settings' | 'sprites' | 'abilities' | 'branding' | 'reports' | 'languages';

const TABS: { key: Tab; label: string; desc: string; icon: string }[] = [
  { key: 'dash', label: 'Дашборд', desc: 'Ключевые метрики', icon: '▦' },
  { key: 'users', label: 'Пользователи', desc: 'Игроки и балансы', icon: '◉' },
  { key: 'rooms', label: 'Комнаты', desc: 'Матч-комнаты и ставки', icon: '◫' },
  { key: 'content', label: 'Контент', desc: 'Персонажи и скины', icon: '✦' },
  { key: 'sprites', label: 'Спрайты', desc: 'Графика игры', icon: '◆' },
  { key: 'abilities', label: 'Способности', desc: 'Система абилок', icon: '⚡' },
  { key: 'matches', label: 'Матчи', desc: 'Текущие и история', icon: '⚔' },
  { key: 'reports', label: 'Жалобы', desc: 'Жалобы игроков', icon: '🚩' },
  { key: 'payments', label: 'Депозиты', desc: 'Пополнения', icon: '$' },
  { key: 'withdrawals', label: 'Выводы', desc: 'Заявки на вывод', icon: '↑' },
  { key: 'methods', label: 'Методы оплаты', desc: 'Способы и иконки', icon: '◈' },
  { key: 'settings', label: 'Настройки', desc: 'Флаги и параметры', icon: '⚙' },
  { key: 'branding', label: 'Брендинг', desc: 'Лого, фавикон, иконки', icon: '🎨' },
  { key: 'languages', label: 'Языки', desc: 'i18n + перевод', icon: '🌐' },
];

export function AdminPage() {
  const nav = useNavigate();
  const me = useAuth((s) => s.me);
  const setMe = useAuth((s) => s.setMe);
  const [tab, setTab] = useState<Tab>('dash');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

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

  const current = TABS.find((t) => t.key === tab)!;

  const ui = (
    <div className="fixed inset-0 z-40 flex bg-bg text-white">
      {/* Sidebar (desktop) */}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-white/10 bg-surface md:flex">
        <div className="flex items-center gap-2 border-b border-white/10 px-4 py-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-accent text-bg font-bold">A</div>
          <div>
            <div className="text-sm font-semibold">Arena Admin</div>
            <div className="text-[11px] text-white/50">@{me.username}</div>
          </div>
        </div>
        <nav className="flex-1 overflow-y-auto px-2 py-3">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={
                'mb-1 flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition ' +
                (tab === t.key
                  ? 'bg-accent/15 text-accent'
                  : 'text-white/70 hover:bg-white/5 hover:text-white')
              }
            >
              <span className="w-5 text-center text-base">{t.icon}</span>
              <span className="flex-1">
                <span className="block font-medium">{t.label}</span>
                <span className="block text-[10px] text-white/40">{t.desc}</span>
              </span>
            </button>
          ))}
        </nav>
        <button
          type="button"
          onClick={() => nav('/home')}
          className="border-t border-white/10 px-4 py-3 text-left text-xs text-white/60 hover:bg-white/5 hover:text-white"
        >
          ← back to game
        </button>
      </aside>

      {/* Mobile drawer */}
      {mobileNavOpen && (
        <div className="fixed inset-0 z-50 md:hidden" onClick={() => setMobileNavOpen(false)}>
          <div className="absolute inset-0 bg-black/60" />
          <aside
            className="absolute left-0 top-0 flex h-full w-64 flex-col bg-surface shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b border-white/10 px-4 py-4 text-sm font-semibold">Arena Admin</div>
            <nav className="flex-1 overflow-y-auto px-2 py-3">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => {
                    setTab(t.key);
                    setMobileNavOpen(false);
                  }}
                  className={
                    'mb-1 flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm ' +
                    (tab === t.key ? 'bg-accent/15 text-accent' : 'text-white/70 hover:bg-white/5')
                  }
                >
                  <span className="w-5 text-center">{t.icon}</span>
                  <span>{t.label}</span>
                </button>
              ))}
            </nav>
            <button
              type="button"
              onClick={() => nav('/home')}
              className="border-t border-white/10 px-4 py-3 text-left text-xs text-white/60"
            >
              ← back to game
            </button>
          </aside>
        </div>
      )}

      {/* Main content */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-white/10 bg-surface/50 px-4 py-3 md:px-6">
          <button
            type="button"
            onClick={() => setMobileNavOpen(true)}
            className="rounded-md p-1.5 text-white/70 hover:bg-white/10 md:hidden"
            aria-label="menu"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
          <div className="flex-1">
            <h1 className="text-base font-semibold md:text-lg">{current.label}</h1>
            <p className="text-xs text-white/50">{current.desc}</p>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto px-4 py-5 md:px-6 md:py-6">
          <div className="mx-auto max-w-6xl">
            {tab === 'dash' && <DashboardTab />}
            {tab === 'users' && <UsersTab />}
            {tab === 'rooms' && <RoomsTab />}
            {tab === 'content' && <ContentTab />}
            {tab === 'sprites' && <SpritesTab />}
            {tab === 'matches' && <MatchesTab />}
            {tab === 'payments' && <PaymentsTab />}
            {tab === 'withdrawals' && <WithdrawalsTab />}
            {tab === 'methods' && <PaymentMethodsTab />}
            {tab === 'settings' && <SettingsTab />}
            {tab === 'abilities' && <AbilitiesTab />}
            {tab === 'branding' && <BrandingTab />}
            {tab === 'reports' && <ReportsTab />}
            {tab === 'languages' && <LanguagesTab />}
          </div>
        </main>
      </div>
    </div>
  );

  return createPortal(ui, document.body);
}
