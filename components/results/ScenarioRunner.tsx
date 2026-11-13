'use client'

/**
 * Corre los escenarios de una plantilla y los compara.
 *
 * Los escenarios se corren SIEMPRE juntos y con la misma semilla. Es el punto
 * entero: con streams de aleatoriedad separados por nodo, la diferencia entre
 * escenarios es causal y no ruido, asi que se puede decir "esto da 14% mas" sin
 * que nadie lo discuta.
 */

import { useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useSimRunner } from '@/hooks/useSimRunner'
import { applyPatch, type LeanTemplate, type Locale } from '@/lib/sim/presets/templates'
import type { RunVariant } from '@/lib/sim/types/protocol'
import type { RunResult } from '@/lib/sim/types/results'
import { delta, duration, percent, rate, units } from '@/lib/format'
import { StateBar, StateLegend, presentStates } from './StateBar'
import { diagnoseBottleneck } from '@/lib/sim/diagnose/bottleneck'
import type { SimModel } from '@/lib/sim/types/model'

export function ScenarioRunner({ template, locale }: { template: LeanTemplate; locale: Locale }) {
  const t = useTranslations('run')
  const { running, pct, results, error, ready, runSweep, cancel } = useSimRunner()
  const [selected, setSelected] = useState(0)

  const variants: RunVariant[] = useMemo(
    () =>
      template.scenarios.map((sc) => {
        const model = applyPatch(template.model, sc.patch)
        return { id: sc.id, label: sc.label[locale], model, config: model.defaults }
      }),
    [template, locale],
  )

  const modelById = useMemo(
    () => new Map(variants.map((v) => [v.id, v.model])),
    [variants],
  )

  // Se corre solo al abrir: la plantilla existe para mostrarse, no para que
  // alguien tenga que descubrir donde esta el boton.
  useEffect(() => {
    if (!ready) return
    runSweep(variants)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variants, ready])

  const ordered = template.scenarios
    .map((sc) => results.find((r) => r.variantId === sc.id))
    .filter((r): r is NonNullable<typeof r> => r !== undefined)

  const current = ordered[Math.min(selected, Math.max(0, ordered.length - 1))]

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        {template.scenarios.map((sc, i) => {
          const done = results.some((r) => r.variantId === sc.id)
          const active = i === selected && done
          return (
            <button
              key={sc.id}
              type="button"
              disabled={!done}
              onClick={() => setSelected(i)}
              className={[
                'rounded-full border px-3.5 py-1.5 text-[13px] font-medium transition-colors',
                active
                  ? 'border-accent bg-accent-soft text-ink'
                  : done
                    ? 'border-border bg-surface text-ink-muted hover:border-border-strong hover:text-ink'
                    : 'border-border bg-surface/50 text-ink-faint',
              ].join(' ')}
            >
              {sc.label[locale]}
            </button>
          )
        })}

        <div className="ml-auto flex items-center gap-3">
          {running && (
            <>
              <span className="tnum text-[12px] text-ink-faint">
                {t('running')} {percent(pct)}
              </span>
              <button
                type="button"
                onClick={cancel}
                className="rounded-full border border-border px-3 py-1.5 text-[12px] text-ink-muted hover:text-ink"
              >
                {t('cancel')}
              </button>
            </>
          )}
          {!running && (
            <button
              type="button"
              onClick={() => runSweep(variants)}
              className="rounded-full bg-accent-strong px-4 py-1.5 text-[13px] font-semibold text-[#06211f] hover:bg-accent"
            >
              {t('run')}
            </button>
          )}
        </div>
      </div>

      {error && (
        <p className="mt-5 rounded-card border border-bad/40 bg-bad/10 px-4 py-3 text-[13px] text-ink">
          {error.message}
        </p>
      )}

      {ordered.length > 0 && (
        <>
          <ComparisonTable rows={ordered} locale={locale} />
          {current && (
            <StationBreakdown
              result={current.result}
              model={modelById.get(current.variantId)!}
              locale={locale}
            />
          )}
        </>
      )}
    </div>
  )
}

const KPI_ROWS = [
  { key: 'throughput', es: 'Throughput', en: 'Throughput', fmt: (r: RunResult) => `${rate(r.kpis.throughputPerHour)} u/h`, raw: (r: RunResult) => r.kpis.throughputPerHour, better: 1 },
  { key: 'leadTime', es: 'Lead time', en: 'Lead time', fmt: (r: RunResult) => duration(r.kpis.leadTimeMean), raw: (r: RunResult) => r.kpis.leadTimeMean, better: -1 },
  { key: 'leadP95', es: 'Lead time P95', en: 'Lead time P95', fmt: (r: RunResult) => duration(r.kpis.leadTimeP95), raw: (r: RunResult) => r.kpis.leadTimeP95, better: -1 },
  { key: 'wip', es: 'WIP promedio', en: 'Average WIP', fmt: (r: RunResult) => units(r.kpis.wipMean), raw: (r: RunResult) => r.kpis.wipMean, better: -1 },
  { key: 'wipMax', es: 'WIP maximo', en: 'Peak WIP', fmt: (r: RunResult) => units(r.kpis.wipMax), raw: (r: RunResult) => r.kpis.wipMax, better: -1 },
] as const

function ComparisonTable({
  rows,
  locale,
}: {
  rows: Array<{ variantId: string; label: string; result: RunResult }>
  locale: Locale
}) {
  const base = rows[0]!.result
  return (
    <div className="mt-6 overflow-x-auto rounded-card border border-border bg-surface">
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-border">
            <th className="px-4 py-3 text-left font-medium text-ink-faint"> </th>
            {rows.map((r) => (
              <th key={r.variantId} className="px-4 py-3 text-right font-semibold">
                {r.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {KPI_ROWS.map((row) => (
            <tr key={row.key} className="border-b border-border last:border-0">
              <th scope="row" className="px-4 py-2.5 text-left font-normal text-ink-muted">
                {row[locale]}
              </th>
              {rows.map((r, i) => {
                const d = i === 0 ? null : delta(row.raw(base), row.raw(r.result))
                const good = d !== null && d.sign !== 0 && d.sign === row.better
                const bad = d !== null && d.sign !== 0 && d.sign === -row.better
                return (
                  <td key={r.variantId} className="px-4 py-2.5 text-right">
                    <span className="tnum font-medium">{row.fmt(r.result)}</span>
                    {d && d.sign !== 0 && (
                      <span
                        className={[
                          'tnum ml-2 text-[11px]',
                          good ? 'text-ok' : bad ? 'text-bad' : 'text-ink-faint',
                        ].join(' ')}
                      >
                        {d.text}
                      </span>
                    )}
                  </td>
                )
              })}
            </tr>
          ))}
          <tr>
            <th scope="row" className="px-4 py-2.5 text-left font-normal text-ink-muted">
              {locale === 'es' ? 'Ley de Little' : "Little's Law"}
            </th>
            {rows.map((r) => {
              const ok = r.result.kpis.littleError < 0.05
              return (
                <td key={r.variantId} className="px-4 py-2.5 text-right">
                  <span
                    className={[
                      'tnum inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium',
                      ok
                        ? 'bg-ok/15 text-ok'
                        : 'bg-warn/15 text-warn',
                    ].join(' ')}
                    title="L estimado contra lambda x W. Un desvio grande indica que el sistema no llego a estado estable."
                  >
                    {ok ? 'OK' : locale === 'es' ? 'No estacionario' : 'Not steady state'}{' '}
                    {percent(r.result.kpis.littleError, 1)}
                  </span>
                </td>
              )
            })}
          </tr>
        </tbody>
      </table>
    </div>
  )
}

function StationBreakdown({
  result,
  model,
  locale,
}: {
  result: RunResult
  model: SimModel
  locale: Locale
}) {
  const stations = result.nodes.filter((n) => n.type === 'process' || n.type === 'inspection')
  if (stations.length === 0) return null
  const diag = diagnoseBottleneck(model, result)
  const legendKeys = presentStates(stations.map((s) => s.states))

  return (
    <section className="mt-6 rounded-card border border-border bg-surface p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <h3 className="text-[13px] font-semibold uppercase tracking-wide text-ink-muted">
          {locale === 'es'
            ? 'En que se le va el tiempo a cada estacion'
            : 'Where each station spends its time'}
        </h3>
        <StateLegend active={legendKeys} />
      </div>
      <ul className="mt-4 space-y-3.5">
        {stations.map((s) => (
          <li key={s.nodeId} className="grid grid-cols-[110px_1fr_56px] items-center gap-3">
            <span
              className={[
                'truncate text-[12px]',
                s.nodeId === diag.nodeId ? 'font-semibold text-ink' : 'text-ink-muted',
              ].join(' ')}
            >
              {s.label}
            </span>
            <StateBar states={s.states} />
            <span className="tnum text-right text-[12px] text-ink-muted">
              {percent(s.utilization)}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-4 border-t border-border pt-3 text-[13px] leading-relaxed text-ink-muted">
        <Verdict diag={diag} locale={locale} />
      </p>
    </section>
  )
}

/**
 * El veredicto en lenguaje llano.
 *
 * No siempre hay una restriccion que nombrar, y nombrar una igual es peor que
 * callarse: manda a mejorar donde no hay nada que ganar.
 */
function Verdict({
  diag,
  locale,
}: {
  diag: ReturnType<typeof diagnoseBottleneck>
  locale: Locale
}) {
  if (diag.kind === 'demand-limited') {
    return locale === 'es' ? (
      <>
        Ninguna estacion esta saturada: la mas cargada trabaja al{' '}
        <span className="tnum font-semibold text-ink">{percent(diag.utilization)}</span>. La
        restriccion no esta en la linea, esta en la demanda.
      </>
    ) : (
      <>
        No station is saturated: the busiest runs at{' '}
        <span className="tnum font-semibold text-ink">{percent(diag.utilization)}</span>. The
        constraint is not the line, it is demand.
      </>
    )
  }

  if (diag.kind === 'balanced') {
    return locale === 'es' ? (
      <>
        La linea esta pareja: todas las estaciones rondan el{' '}
        <span className="tnum font-semibold text-ink">{percent(diag.utilization)}</span>. No hay una
        restriccion que senalar, asi que mejorar cualquiera por separado no va a mover el
        throughput.
      </>
    ) : (
      <>
        The line is balanced: every station sits around{' '}
        <span className="tnum font-semibold text-ink">{percent(diag.utilization)}</span>. There is no
        single constraint, so improving any one of them alone will not move throughput.
      </>
    )
  }

  return locale === 'es' ? (
    <>
      Tu cuello de botella es <span className="font-semibold text-ink">{diag.label}</span> al{' '}
      <span className="tnum font-semibold text-ink">{percent(diag.utilization)}</span>. El resto de
      la linea trabaja al <span className="tnum">{percent(diag.restUtilization)}</span>.
    </>
  ) : (
    <>
      Your bottleneck is <span className="font-semibold text-ink">{diag.label}</span> at{' '}
      <span className="tnum font-semibold text-ink">{percent(diag.utilization)}</span>. The rest of
      the line runs at <span className="tnum">{percent(diag.restUtilization)}</span>.
    </>
  )
}
