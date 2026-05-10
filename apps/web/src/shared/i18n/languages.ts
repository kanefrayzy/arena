/**
 * Registry of UI languages. Bundled languages are statically known here.
 * Additional languages may be loaded dynamically from the API via
 * `/api/i18n/locales` (managed in the admin panel).
 */
export interface LangMeta {
  code: string;
  name: string;
  flag: string; // emoji
  bundled?: boolean;
}

export const BUNDLED_LANGUAGES: LangMeta[] = [
  { code: 'ru', name: 'Русский', flag: '🇷🇺', bundled: true },
  { code: 'en', name: 'English', flag: '🇬🇧', bundled: true },
];

let _cache: LangMeta[] | null = null;

export function getKnownLanguages(): LangMeta[] {
  if (_cache) return _cache;
  return BUNDLED_LANGUAGES;
}

export function setKnownLanguages(list: LangMeta[]): void {
  // De-dup by code, prefer entries with a name from the list.
  const map = new Map<string, LangMeta>();
  for (const l of BUNDLED_LANGUAGES) map.set(l.code, l);
  for (const l of list) map.set(l.code, { ...map.get(l.code), ...l });
  _cache = Array.from(map.values());
}
