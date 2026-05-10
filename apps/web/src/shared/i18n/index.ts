import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import ru from './locales/ru.json';
import en from './locales/en.json';
import { setKnownLanguages, BUNDLED_LANGUAGES } from './languages';

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    fallbackLng: 'en',
    supportedLngs: ['ru', 'en'],
    interpolation: { escapeValue: false },
    resources: {
      ru: { translation: ru },
      en: { translation: en },
    },
  });

// Best-effort: load additional locales registered through the admin panel.
// Failures are silently ignored — bundled ru/en are always available.
void (async () => {
  try {
    const r = await fetch('/api/i18n/locales', { credentials: 'omit' });
    if (!r.ok) return;
    const data: {
      languages: { code: string; name: string; flag?: string }[];
      resources: Record<string, Record<string, string>>;
    } = await r.json();
    if (Array.isArray(data.languages) && data.languages.length) {
      setKnownLanguages([
        ...BUNDLED_LANGUAGES,
        ...data.languages.map((l) => ({ code: l.code, name: l.name, flag: l.flag ?? '🌐' })),
      ]);
    }
    if (data.resources) {
      for (const [code, dict] of Object.entries(data.resources)) {
        i18n.addResourceBundle(code, 'translation', dict, true, true);
      }
      const supported = Array.from(new Set([...(i18n.options.supportedLngs as string[] | false || []), ...Object.keys(data.resources)]));
      i18n.options.supportedLngs = supported;
    }
  } catch {
    /* offline or no admin locales — fine */
  }
})();

export default i18n;
