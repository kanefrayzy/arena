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
    <div className="flex h-full flex-col items-center justify-center px-6">
      <form onSubmit={onSubmit} className="flex w-full max-w-sm flex-col gap-3">
        <h2 className="mb-2 text-2xl font-semibold">{t('splash.login')}</h2>
        <input
          type="email"
          autoComplete="email"
          placeholder={t('auth.email')}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className="rounded-lg bg-surface px-4 py-3 outline-none ring-1 ring-white/10 focus:ring-accent"
        />
        <input
          type="password"
          autoComplete="current-password"
          placeholder={t('auth.password')}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          className="rounded-lg bg-surface px-4 py-3 outline-none ring-1 ring-white/10 focus:ring-accent"
        />
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button
          type="submit"
          disabled={loading}
          className="rounded-xl bg-accent px-6 py-3 font-semibold text-bg disabled:opacity-50"
        >
          {t('auth.submit_login')}
        </button>
        <p className="mt-2 text-center text-sm text-white/60">
          {t('auth.no_account')}{' '}
          <Link to="/register" className="text-accent hover:underline">
            {t('splash.register')}
          </Link>
        </p>
      </form>
    </div>
  );
}
