import Link from 'next/link'
import { getLocale } from 'next-intl/server'
import { getTranslations } from 'next-intl/server'
import { DEFAULT_LOCALE, isLocale } from '@/lib/i18n/config'
import { LocaleSwitch } from './LocaleSwitch'

export async function AppHeader() {
  const t = await getTranslations('app')
  const raw = await getLocale()
  const locale = isLocale(raw) ? raw : DEFAULT_LOCALE

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-bg/85 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-4 px-5">
        <Link href="/" className="flex items-center gap-2.5">
          <Mark />
          <span className="text-[15px] font-semibold tracking-tight">{t('name')}</span>
        </Link>
        <span className="hidden text-sm text-ink-faint md:inline">{t('tagline')}</span>
        <div className="ml-auto">
          <LocaleSwitch current={locale} />
        </div>
      </div>
    </header>
  )
}

/**
 * Marca: tres bloques de altura creciente unidos por una flecha. Es un proceso
 * desbalanceado - el problema que la herramienta existe para mostrar.
 */
function Mark() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
      <rect x="1" y="12" width="5" height="8" rx="1.5" fill="var(--color-accent)" />
      <rect x="8.5" y="6" width="5" height="14" rx="1.5" fill="var(--color-state-blocked)" />
      <rect x="16" y="14" width="5" height="6" rx="1.5" fill="var(--color-accent)" />
      <path
        d="M2 4h16m0 0-3-3m3 3-3 3"
        stroke="var(--color-ink-faint)"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  )
}
