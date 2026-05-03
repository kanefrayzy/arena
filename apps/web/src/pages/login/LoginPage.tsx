import { FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../../shared/api/client';
import { useAuth, type Me } from '../../shared/store/auth';

export function LoginPage() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const setMe = useAuth((s) => s.setMe);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const out = await api.post<{ user: Me }>('/auth/login', { email, password });
      setMe(out.user);
      nav('/home');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative flex h-full flex-col items-center justify-center overflow-hidden px-6">
      <div className="pointer-events-none absolute -top-20 left-1/2 h-64 w-64 -translate-x-1/2 rounded-full bg-game-purple/40 blur-3xl" />
      <form
        onSubmit={onSubmit}
        className="game-card relative flex w-full max-w-sm flex-col gap-3 p-6 animate-pop-in"
      >
        <h2 className="game-title mb-2 text-center text-3xl text-game-yellow">
          {t('splash.login')}
        </h2>
        <input
          type="email"
          autoComplete="email"
          placeholder={t('auth.email')}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className="game-input"
        />
        <input
          type="password"
          autoComplete="current-password"
          placeholder={t('auth.password')}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          className="game-input"
        />
        {error && <p className="text-center text-sm font-semibold text-game-red">{error}</p>}
        <button type="submit" disabled={loading} className="game-btn game-btn-yellow mt-2">
          {t('auth.submit_login')}
        </button>
        <p className="mt-1 text-center text-sm text-white/70">
          {t('auth.no_account')}{' '}
          <Link to="/register" className="font-semibold text-game-yellow hover:underline">
            {t('splash.register')}
          </Link>
        </p>
      </form>
    </div>
  );
}
