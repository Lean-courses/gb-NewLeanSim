'use client'

/**
 * Tiempo de ciclo EFECTIVO por estacion, con la linea de takt cruzando.
 *
 * Este grafico no necesita simular nada y, frente a un cliente, es lo primero
 * que se muestra: ES la leccion de balanceo de linea. Las barras que cruzan la
 * linea de takt son las estaciones que no dan la demanda, y el desglose
 * muestra cuanto de esa barra es ciclo real y cuanto son perdidas por cambio,
 * paradas y scrap aguas abajo.
 */

import { useTranslations } from 'next-intl'
import type { CapacityReport } from '@/lib/sim/validate/capacityCheck'
import { duration } from '@/lib/format'

const SEG_LABEL = {
  cycle: { es: 'Ciclo', en: 'Cycle' },
  changeover: { es: 'Cambio', en: 'Changeover' },
  availability: { es: 'Paradas', en: 'Downtime' },
  scrap: { es: 'Scrap aguas abajo', en: 'Downstream scrap' },
} as const

export function CapacityChart({
  report,
  locale,
}: {
  report: CapacityReport
  locale: 'es' | 'en'
}) {
  const t = useTranslations('run')
  const max = Math.max(
    ...report.stations.map((s) => s.effectiveMs),
    report.taktMs ?? 0,
  )
  if (max <= 0) return null
  const hasChangeover = report.stations.some((s) => s.lossChangeoverMs > 0)
  const hasDowntime = report.stations.some((s) => s.lossAvailabilityMs > 0)
  const hasScrap = report.stations.some((s) => s.lossScrapMs > 0)
  const taktPct = report.taktMs !== null ? (report.taktMs / max) * 100 : null

  return (
    <figure className="m-0">
      <div className="relative">
        {taktPct !== null && (
          <div
            className="pointer-events-none absolute inset-y-0 z-10 border-l border-dashed border-accent"
            style={{ left: `${taktPct}%` }}
          >
            <span className="absolute -top-5 left-1.5 whitespace-nowrap text-[11px] font-medium text-accent">
              Takt {duration(report.taktMs!)}
            </span>
          </div>
        )}
        <ul className={taktPct !== null ? 'mt-5 space-y-2' : 'space-y-2'}>
          {report.stations.map((s) => {
            const isBottleneck = s.nodeId === report.bottleneckId
            const over = s.rho !== null && s.rho >= 1
            const base = s.effectiveMs - s.lossChangeoverMs - s.lossAvailabilityMs - s.lossScrapMs
            const seg = [
              { v: base, color: 'var(--color-accent-strong)', label: SEG_LABEL.cycle[locale] },
              { v: s.lossChangeoverMs, color: 'var(--color-state-setup)', label: SEG_LABEL.changeover[locale] },
              { v: s.lossAvailabilityMs, color: 'var(--color-state-down)', label: SEG_LABEL.availability[locale] },
              { v: s.lossScrapMs, color: 'var(--color-state-blocked)', label: SEG_LABEL.scrap[locale] },
            ].filter((x) => x.v > 0)

            return (
              <li key={s.nodeId} className="grid grid-cols-[110px_1fr_auto] items-center gap-3">
                <span
                  className={[
                    'truncate text-[12px]',
                    isBottleneck ? 'font-semibold text-ink' : 'text-ink-muted',
                  ].join(' ')}
                >
                  {s.label}
                </span>
                <div className="flex h-5 items-center">
                  <div
                    className="flex h-full overflow-hidden rounded-r-[4px]"
                    style={{ width: `${(s.effectiveMs / max) * 100}%` }}
                  >
                    {seg.map((x, i) => (
                      <div
                        key={x.label}
                        title={`${x.label}: ${duration(x.v)}`}
                        style={{
                          width: `${(x.v / s.effectiveMs) * 100}%`,
                          background: x.color,
                          marginLeft: i === 0 ? 0 : 2,
                        }}
                      />
                    ))}
                  </div>
                </div>
                <span
                  className={[
                    'tnum text-[12px]',
                    over ? 'font-semibold text-bad' : 'text-ink-muted',
                  ].join(' ')}
                >
                  {duration(s.effectiveMs)}
                </span>
              </li>
            )
          })}
        </ul>
      </div>
      <figcaption className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
        {/*
          Solo las perdidas que existen en ESTE modelo. Listar "cambio",
          "paradas" y "scrap" en una linea que no tiene ninguna de las tres es
          ruido, y encima hace dudar de si falta algo por dibujar.
        */}
        <Swatch color="var(--color-accent-strong)" label={SEG_LABEL.cycle[locale]} />
        {hasChangeover && (
          <Swatch color="var(--color-state-setup)" label={SEG_LABEL.changeover[locale]} />
        )}
        {hasDowntime && (
          <Swatch color="var(--color-state-down)" label={SEG_LABEL.availability[locale]} />
        )}
        {hasScrap && <Swatch color="var(--color-state-blocked)" label={SEG_LABEL.scrap[locale]} />}
        <span className="ml-auto text-[11px] text-ink-faint">
          {t('bottleneck')}:{' '}
          <span className="text-ink-muted">
            {report.stations.find((s) => s.nodeId === report.bottleneckId)?.label ?? '-'}
          </span>
        </span>
      </figcaption>
    </figure>
  )
}

function Swatch({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-[11px] text-ink-muted">
      <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: color }} aria-hidden="true" />
      {label}
    </span>
  )
}
