'use client'

import { useTransition } from 'react'
import { setLocale } from '@/app/actions/locale'
import { LOCALES, type Locale } from '@/lib/i18n/config'

export function LocaleSwitch({ current }: { current: Locale }) {
  const [pending, start] = useTransition()
  return (
    <div
      className="flex items-center gap-0.5 rounded-full border border-border bg-surface p-0.5"
      role="group"
      aria-label="Idioma / Language"
    >
      {LOCALES.map((l) => {
        const active = l === current
        return (
          <button
            key={l}
            type="button"
            disabled={pending}
            aria-pressed={active}
            onClick={() => start(() => void setLocale(l))}
            className={[
              'rounded-full px-2.5 py-1 text-xs font-medium uppercase tracking-wide transition-colors',
              active
                ? 'bg-surface-3 text-ink'
                : 'text-ink-faint hover:text-ink-muted',
            ].join(' ')}
          >
            {l}
          </button>
        )
      })}
    </div>
  )
}
