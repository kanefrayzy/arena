import { FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../../shared/api/client';
import { useAuth, type Me } from '../../shared/store/auth';

const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_RX = /^[A-Za-z0-9_]+$/;

function describeApiError(e: ApiError): string {
  switch (e.code) {
    case 'EMAIL_TAKEN': return 'Этот email уже зарегистрирован';
    case 'USERNAME_TAKEN': return 'Это имя пользователя уже занято';
    case 'INVALID_CREDENTIALS': return 'Неверный email или пароль';
  }
  // The API returns Zod validation envelope:
  //   { code: 'VALIDATION', details: { fieldErrors: { password: ['...'] } } }
  const details = e.details as { fieldErrors?: Record<string, string[] | undefined> } | null | undefined;
  const fe = details?.fieldErrors;
  if (fe) {
    for (const k of ['email', 'username', 'password', 'acceptTos', 'acceptAge', 'acceptSkillGame']) {
      const msgs = fe[k];
      if (msgs && msgs.length > 0) return msgs[0]!;
    }
  }
  return e.message || 'Ошибка регистрации';
}

export function RegisterPage() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const setMe = useAuth((s) => s.setMe);
  const [searchParams] = useSearchParams();
  const refCode = searchParams.get('ref');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [acceptTos, setAcceptTos] = useState(false);
  const [acceptAge, setAcceptAge] = useState(false);
  const [acceptSkill, setAcceptSkill] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [touched, setTouched] = useState<{ email?: boolean; username?: boolean; password?: boolean }>({});

  // Per-field validation (shown only after the field has been touched/blurred
  // so we don't yell at the user the moment the form mounts).
  const emailErr = !email
    ? 'Введите email'
    : !EMAIL_RX.test(email)
      ? 'Некорректный email (пример: name@mail.com)'
      : null;
  const usernameErr = !username
    ? 'Введите имя пользователя'
    : username.length < 4 || username.length > 20
      ? 'Имя пользователя: от 4 до 20 символов'
      : !USERNAME_RX.test(username)
        ? 'Только латинские буквы, цифры и подчёркивание'
        : null;
  const passwordErr = !password
    ? 'Введите пароль'
    : password.length < 5
      ? 'Пароль: минимум 5 символов'
      : null;

  const canSubmit =
    !emailErr && !usernameErr && !passwordErr && acceptTos && acceptAge && acceptSkill && !loading;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setTouched({ email: true, username: true, password: true });
    if (emailErr || usernameErr || passwordErr) return;
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
        ...(refCode ? { ref: refCode } : {}),
      });
      setMe(out.user);
      nav('/home');
    } catch (e) {
      setError(e instanceof ApiError ? describeApiError(e) : 'Ошибка регистрации');
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
    <label className="flex items-start gap-2 text-sm text-white/85" htmlFor={key}>
      <input
        id={key}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 h-4 w-4 accent-game-yellow"
      />
      <span>{label}</span>
    </label>
  );

  const fieldErrCls = 'mt-0.5 text-xs text-game-red';
  const fieldHintCls = 'mt-0.5 text-xs text-white/45';

  return (
    <div className="relative flex h-full flex-col items-center justify-center overflow-y-auto px-6 py-8">
      <div className="pointer-events-none absolute -top-20 right-10 h-64 w-64 rounded-full bg-game-pink/30 blur-3xl" />
      <form
        onSubmit={onSubmit}
        className="game-card relative flex w-full max-w-sm flex-col gap-3 p-6 animate-pop-in"
      >
        <h2 className="game-title mb-2 text-center text-3xl text-game-yellow">
          {t('splash.register')}
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
          {touched.email && emailErr
            ? <p className={fieldErrCls}>{emailErr}</p>
            : <p className={fieldHintCls}>Нужен для входа и восстановления пароля</p>}
        </div>

        <div>
          <input
            type="text"
            autoComplete="username"
            placeholder={t('auth.username')}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            onBlur={() => setTouched((s) => ({ ...s, username: true }))}
            required
            minLength={4}
            maxLength={20}
            className="game-input w-full"
          />
          {touched.username && usernameErr
            ? <p className={fieldErrCls}>{usernameErr}</p>
            : <p className={fieldHintCls}>4–20 символов: латинские буквы, цифры, _</p>}
        </div>

        <div>
          <input
            type="password"
            autoComplete="new-password"
            placeholder={t('auth.password')}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onBlur={() => setTouched((s) => ({ ...s, password: true }))}
            required
            minLength={5}
            className="game-input w-full"
          />
          {touched.password && passwordErr
            ? <p className={fieldErrCls}>{passwordErr}</p>
            : <p className={fieldHintCls}>Минимум 5 символов</p>}
        </div>

        <div className="mt-1 flex flex-col gap-2">
          {checkbox(acceptAge, setAcceptAge, t('auth.age'), 'cb-age')}
          {checkbox(acceptTos, setAcceptTos, t('auth.tos'), 'cb-tos')}
          {checkbox(acceptSkill, setAcceptSkill, t('auth.skill'), 'cb-skill')}
        </div>
        {error && <p className="text-center text-sm font-semibold text-game-red">{error}</p>}
        <button
          type="submit"
          disabled={!canSubmit}
          className="game-btn game-btn-yellow mt-2"
        >
          {t('auth.submit_register')}
        </button>
        <p className="mt-1 text-center text-sm text-white/70">
          {t('auth.have_account')}{' '}
          <Link to="/login" className="font-semibold text-game-yellow hover:underline">
            {t('splash.login')}
          </Link>
        </p>
      </form>
    </div>
  );
}
