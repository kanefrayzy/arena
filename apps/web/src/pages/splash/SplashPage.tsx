import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

export function SplashPage() {
  const { t } = useTranslation();
  return (
    <div className="flex h-full flex-col items-center justify-center gap-8 px-6 text-center">
      <div>
        <h1 className="text-5xl font-bold tracking-tight text-accent">{t('splash.title')}</h1>
        <p className="mt-3 text-sm text-white/70">{t('splash.subtitle')}</p>
      </div>
      <div className="flex w-full max-w-xs flex-col gap-3">
        <Link
          to="/login"
          className="rounded-xl bg-accent px-6 py-3 text-center font-semibold text-bg hover:opacity-90"
        >
          {t('splash.login')}
        </Link>
        <Link
          to="/register"
          className="rounded-xl border border-white/20 px-6 py-3 text-center font-semibold text-white hover:bg-white/5"
        >
          {t('splash.register')}
        </Link>
      </div>
    </div>
  );
}
