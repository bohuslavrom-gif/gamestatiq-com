import { ui, defaultLang, languages, type Lang, type UIKey } from './ui';

/**
 * Detect the current language from the URL path.
 * /en/...   → 'en'
 * /de/...   → 'de'
 * /...      → 'cs' (defaultLang)
 */
export function getLangFromUrl(url: URL): Lang {
  const [, maybeLang] = url.pathname.split('/');
  if (maybeLang && maybeLang in languages) {
    return maybeLang as Lang;
  }
  return defaultLang;
}

/**
 * Returns a `t(key)` function for the given language with fallback to default lang.
 */
export function useTranslations(lang: Lang) {
  return function t(key: UIKey): string {
    return ui[lang][key] ?? ui[defaultLang][key];
  };
}

/**
 * Prefix a route with the current locale.
 * cs + '/'      → '/'
 * en + '/'      → '/en/'
 * en + '/liga'  → '/en/liga'
 */
export function localizedPath(path: string, lang: Lang): string {
  const clean = path.startsWith('/') ? path : `/${path}`;
  if (lang === defaultLang) return clean;
  if (clean === '/') return `/${lang}/`;
  return `/${lang}${clean}`;
}

/**
 * Given the current URL and a target language, produce the equivalent path
 * in that language. Used by the language switcher to keep the user on
 * the same page when switching languages.
 */
export function switchLangPath(url: URL, targetLang: Lang): string {
  const segments = url.pathname.split('/').filter(Boolean);
  // Strip leading lang segment if present
  if (segments[0] && segments[0] in languages) {
    segments.shift();
  }
  const rest = '/' + segments.join('/');
  return localizedPath(rest === '/' ? '/' : rest, targetLang);
}

export { languages, defaultLang };
export type { Lang };
