import { FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../../shared/api/client';
import { useAuth, type Me } from '../../shared/store/auth';

const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function describeApiError(e: ApiError): string {
  if (e.code === 'INVALID_CREDENTIALS') return 'Неверный email или пароль';
  const details = e.details as { fieldErrors?: Record<string, string[] | undefined> } | null | undefined;
  const fe = details?.fieldErrors;
  if (fe) {
    const msgs = fe.email ?? fe.password;
    if (msgs && msgs.length > 0) return msgs[0]!;
  }
  return e.message || 'Ошибка входа';
}

export function LoginPage() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const setMe = useAuth((s) => s.setMe);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [touched, setTouched] = useState<{ email?: boolean; password?: boolean }>({});

  const emailErr = !email
    ? 'Введите email'
    : !EMAIL_RX.test(email)
      ? 'Некорректный email'
      : null;
  const passwordErr = !password ? 'Введите пароль' : null;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setTouched({ email: true, password: true });
    if (emailErr || passwordErr) return;
    setError(null);
    setLoading(true);
    try {
      const out = await api.post<{ user: Me }>('/auth/login', { email, password });
      setMe(out.user);
      nav('/home');
    } catch (e) {
      setError(e instanceof ApiError ? describeApiError(e) : 'Ошибка входа');
    } finally {
      setLoading(false);
    }
  }

  const fieldErrCls = 'mt-0.5 text-xs text-game-red';

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
        <div>
          <input
            type="email"
            autoComplete="email"
            placeholder={t('auth.email')}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onBlur={() => setTouched((s) => ({ ...s, email: true }))}
            required
            className="game-input w-full"
          />
          {touched.email && emailErr && <p className={fieldErrCls}>{emailErr}</p>}
        </div>
        <div>
          <input
            type="password"
            autoComplete="current-password"
            placeholder={t('auth.password')}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onBlur={() => setTouched((s) => ({ ...s, password: true }))}
            required
            className="game-input w-full"
          />
          {touched.password && passwordErr && <p className={fieldErrCls}>{passwordErr}</p>}
        </div>
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
