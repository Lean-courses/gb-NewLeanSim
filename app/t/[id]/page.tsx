import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getLocale } from 'next-intl/server'
import { ScenarioRunner } from '@/components/results/ScenarioRunner'
import { CapacityChart } from '@/components/results/CapacityChart'
import { DEFAULT_LOCALE, isLocale } from '@/lib/i18n/config'
import { templateById, TEMPLATES } from '@/lib/sim/presets/templates'
import { capacityCheck } from '@/lib/sim/validate/capacityCheck'

export function generateStaticParams() {
  return TEMPLATES.map((t) => ({ id: t.id }))
}

export default async function TemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const tpl = templateById(id)
  if (!tpl) notFound()

  const raw = await getLocale()
  const locale = isLocale(raw) ? raw : DEFAULT_LOCALE
  const cap = capacityCheck(tpl.model)

  return (
    <div className="mx-auto max-w-[1100px] px-5 py-8">
      <Link
        href="/"
        className="text-[12px] text-ink-faint transition-colors hover:text-ink-muted"
      >
        ← {locale === 'es' ? 'Biblioteca' : 'Library'}
      </Link>

      <header className="mt-3">
        <h1 className="text-2xl font-semibold tracking-tight">{tpl.name[locale]}</h1>
        <p className="mt-2 max-w-[70ch] text-sm leading-relaxed text-ink-muted">
          {tpl.summary[locale]}
        </p>
      </header>

      <div className="mt-6 grid gap-4 lg:grid-cols-[1fr_320px]">
        {/*
          El grafico de capacidad va ANTES del boton de correr a proposito: no
          hace falta simular nada para ver si la linea da la demanda, y frente a
          un cliente esto es lo primero que se muestra.
        */}
        <section className="rounded-card border border-border bg-surface p-5">
          <h2 className="mb-4 text-[13px] font-semibold uppercase tracking-wide text-ink-muted">
            {locale === 'es'
              ? 'Tiempo de ciclo efectivo, antes de simular'
              : 'Effective cycle time, before simulating'}
          </h2>
          <CapacityChart report={cap} locale={locale} />
        </section>

        <aside className="rounded-card border border-accent/30 bg-accent-soft/30 p-5">
          <h2 className="text-[11px] font-semibold uppercase tracking-wide text-accent">
            {locale === 'es' ? 'Que mirar' : 'What to watch'}
          </h2>
          <p className="mt-2 text-[13px] leading-relaxed text-ink">{tpl.watch[locale]}</p>
        </aside>
      </div>

      <section className="mt-8">
        <ScenarioRunner template={tpl} locale={locale} />
      </section>

      <section className="mt-8 rounded-card border border-border bg-surface-2 p-5">
        <h2 className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
          {locale === 'es' ? 'El punto' : 'The point'}
        </h2>
        <p className="mt-2 max-w-[75ch] text-[15px] leading-relaxed">{tpl.insight[locale]}</p>
      </section>
    </div>
  )
}
