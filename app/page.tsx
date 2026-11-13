import Link from 'next/link'
import { getLocale, getTranslations } from 'next-intl/server'
import { TEMPLATES } from '@/lib/sim/presets/templates'
import { DEFAULT_LOCALE, isLocale } from '@/lib/i18n/config'
import { capacityCheck } from '@/lib/sim/validate/capacityCheck'
import { rate } from '@/lib/format'
import { MyModels } from '@/components/library/MyModels'

export default async function LibraryPage() {
  const t = await getTranslations('library')
  const raw = await getLocale()
  const locale = isLocale(raw) ? raw : DEFAULT_LOCALE

  return (
    <div className="mx-auto max-w-[1400px] px-5 py-10">
      <section>
        <h1 className="text-2xl font-semibold tracking-tight">{t('templatesTitle')}</h1>
        <p className="mt-1.5 text-sm text-ink-muted">{t('templatesSubtitle')}</p>

        <div className="mt-7 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {TEMPLATES.map((tpl) => {
            const cap = capacityCheck(tpl.model)
            return (
              <Link
                key={tpl.id}
                href={`/t/${tpl.id}`}
                className="group flex flex-col rounded-card border border-border bg-surface p-5 transition-colors hover:border-border-strong hover:bg-surface-2"
              >
                <LineGlyph model={tpl.model} />
                <h2 className="mt-4 text-[15px] font-semibold leading-tight">{tpl.name[locale]}</h2>
                <p className="mt-2 flex-1 text-[13px] leading-relaxed text-ink-muted">
                  {tpl.summary[locale]}
                </p>
                <dl className="mt-4 flex items-center gap-4 border-t border-border pt-3 text-[11px] text-ink-faint">
                  <div>
                    <dt className="uppercase tracking-wide">{locale === 'es' ? 'Escenarios' : 'Scenarios'}</dt>
                    <dd className="tnum mt-0.5 text-[13px] text-ink">{tpl.scenarios.length}</dd>
                  </div>
                  <div>
                    <dt className="uppercase tracking-wide">{locale === 'es' ? 'Capacidad' : 'Capacity'}</dt>
                    <dd className="tnum mt-0.5 text-[13px] text-ink">
                      {rate(cap.lineCapacityPerHour)} u/h
                    </dd>
                  </div>
                </dl>
              </Link>
            )
          })}
        </div>
      </section>

      <MyModels locale={locale} />
    </div>
  )
}

/**
 * Miniatura del modelo: un bloque por estacion, con la altura proporcional al
 * tiempo de ciclo efectivo. De un vistazo se ve si la linea esta balanceada,
 * que es la primera pregunta de cualquiera que la mire.
 */
function LineGlyph({ model }: { model: Parameters<typeof capacityCheck>[0] }) {
  const cap = capacityCheck(model)
  const max = Math.max(...cap.stations.map((s) => s.effectiveMs), 1)
  return (
    <div className="flex h-12 items-end gap-1.5" aria-hidden="true">
      {cap.stations.map((s) => {
        const h = Math.max(14, Math.round((s.effectiveMs / max) * 48))
        const isBottleneck = cap.bottleneckId !== null && s.nodeId === cap.bottleneckId
        return (
          <div
            key={s.nodeId}
            style={{ height: `${h}px` }}
            className={[
              'w-7 rounded-[4px] transition-colors',
              isBottleneck
                ? 'bg-state-blocked'
                : 'bg-surface-3 group-hover:bg-accent-soft',
            ].join(' ')}
          />
        )
      })}
    </div>
  )
}
