import { FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../../shared/api/client';
import { useAuth, type Me } from '../../shared/store/auth';

export function RegisterPage() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const setMe = useAuth((s) => s.setMe);
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [acceptTos, setAcceptTos] = useState(false);
  const [acceptAge, setAcceptAge] = useState(false);
  const [acceptSkill, setAcceptSkill] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const canSubmit =
    email && username && password.length >= 8 && acceptTos && acceptAge && acceptSkill && !loading;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const out = await api.post<{ user: Me }>('/auth/register', {
        email,
        username,
        password,
        acceptTos,
        acceptAge,
        acceptSkillGame: acceptSkill,
      });
      setMe(out.user);
      nav('/home');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Registration failed');
    } finally {
      setLoading(false);
    }
  }

  const checkbox = (
    checked: boolean,
    onChange: (v: boolean) => void,
    label: string,
    key: string,
  ) => (
    <label className="flex items-start gap-2 text-sm text-white/80" htmlFor={key}>
      <input
        id={key}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 h-4 w-4 accent-[#00e0ff]"
      />
      <span>{label}</span>
    </label>
  );

  return (
    <div className="flex h-full flex-col items-center justify-center overflow-y-auto px-6 py-8">
      <form onSubmit={onSubmit} className="flex w-full max-w-sm flex-col gap-3">
        <h2 className="mb-2 text-2xl font-semibold">{t('splash.register')}</h2>
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
          type="text"
          autoComplete="username"
          placeholder={t('auth.username')}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
          minLength={3}
          maxLength={24}
          pattern="[A-Za-z0-9_]+"
          className="rounded-lg bg-surface px-4 py-3 outline-none ring-1 ring-white/10 focus:ring-accent"
        />
        <input
          type="password"
          autoComplete="new-password"
          placeholder={t('auth.password')}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={8}
          className="rounded-lg bg-surface px-4 py-3 outline-none ring-1 ring-white/10 focus:ring-accent"
        />
        <div className="mt-2 flex flex-col gap-2">
          {checkbox(acceptAge, setAcceptAge, t('auth.age'), 'cb-age')}
          {checkbox(acceptTos, setAcceptTos, t('auth.tos'), 'cb-tos')}
          {checkbox(acceptSkill, setAcceptSkill, t('auth.skill'), 'cb-skill')}
        </div>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button
          type="submit"
          disabled={!canSubmit}
          className="mt-2 rounded-xl bg-accent px-6 py-3 font-semibold text-bg disabled:opacity-50"
        >
          {t('auth.submit_register')}
        </button>
        <p className="mt-2 text-center text-sm text-white/60">
          {t('auth.have_account')}{' '}
          <Link to="/login" className="text-accent hover:underline">
            {t('splash.login')}
          </Link>
        </p>
      </form>
    </div>
  );
}
