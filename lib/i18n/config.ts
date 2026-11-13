export const LOCALES = ['es', 'en'] as const
export type Locale = (typeof LOCALES)[number]
export const DEFAULT_LOCALE: Locale = 'es'
export const LOCALE_COOKIE = 'newleansim.locale'

export const LOCALE_LABEL: Record<Locale, string> = {
  es: 'Espanol',
  en: 'English',
}

export function isLocale(v: string | undefined): v is Locale {
  return v === 'es' || v === 'en'
}
