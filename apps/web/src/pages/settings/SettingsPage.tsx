import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../../shared/api/client';
import { useAuth } from '../../shared/store/auth';

export function SettingsPage() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const me = useAuth((s) => s.me);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newPasswordConfirm, setNewPasswordConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setMsg(null);
    if (newPassword.length < 8) {
      setError(t('settings.password_too_short'));
      return;
    }
    if (newPassword !== newPasswordConfirm) {
      setError(t('settings.password_mismatch'));
      return;
    }
    setBusy(true);
    try {
      await api.post('/auth/change-password', { currentPassword, newPassword });
      setMsg(t('settings.password_changed'));
      setCurrentPassword('');
      setNewPassword('');
      setNewPasswordConfirm('');
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.status === 401) setError(t('settings.wrong_password'));
        else setError(e.message);
      } else {
        setError((e as Error).message);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      <div className="pointer-events-none absolute -top-32 -right-20 h-72 w-72 rounded-full bg-game-cyan/30 blur-3xl" />

      <header className="game-panel relative z-10 flex items-center justify-between px-4 py-3">
        <button
          type="button"
          onClick={() => nav('/home')}
          className="game-btn game-btn-ghost game-btn-sm"
        >
          ← {t('settings.back')}
        </button>
        <h2 className="game-title text-xl text-game-yellow">{t('settings.title')}</h2>
        <div className="w-12" />
      </header>

      <main className="relative z-10 flex flex-1 flex-col gap-4 overflow-y-auto px-5 py-5">
        {me && (
          <div className="game-card flex items-center gap-3 p-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-game-yellow/20 font-display text-xl text-game-yellow">
              {me.username.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-display text-base uppercase text-white">@{me.username}</div>
              <div className="truncate text-xs text-white/60">{me.email}</div>
            </div>
          </div>
        )}

        <form onSubmit={submit} className="game-card flex flex-col gap-3 p-4 animate-pop-in">
          <h3 className="font-display text-base uppercase text-game-yellow">
            {t('settings.change_password')}
          </h3>
          <input
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            placeholder={t('settings.current_password')}
            className="game-input"
            required
          />
          <input
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder={t('settings.new_password')}
            className="game-input"
            required
            minLength={8}
          />
          <input
            type="password"
            autoComplete="new-password"
            value={newPasswordConfirm}
            onChange={(e) => setNewPasswordConfirm(e.target.value)}
            placeholder={t('settings.new_password_confirm')}
            className="game-input"
            required
            minLength={8}
          />
          {error && (
            <div className="text-center text-sm font-semibold text-game-red">{error}</div>
          )}
          {msg && (
            <div className="text-center text-sm font-semibold text-game-green">{msg}</div>
          )}
          <button
            type="submit"
            disabled={busy || !currentPassword || !newPassword || !newPasswordConfirm}
            className="game-btn game-btn-yellow"
          >
            {busy ? '…' : t('settings.save')}
          </button>
        </form>
      </main>
    </div>
  );
}
