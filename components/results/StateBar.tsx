'use client'

/**
 * Barra segmentada del reparto de tiempo de una estacion.
 *
 * Es, de todo el panel de resultados, lo mas accionable que se le puede
 * mostrar a un cliente: "tu Est.2 esta 31% bloqueada y 12% esperando operario"
 * dice que hacer; un 78% de utilizacion no dice nada.
 *
 * Separador de 2px del color de la superficie entre segmentos, para que dos
 * tramos de color parecido no se lean como uno solo.
 */

import { useTranslations } from 'next-intl'
import { STATE_ORDER, STATE_VAR, stateValue, type StateKey } from '@/lib/stateColors'
import type { StateBreakdown as SB } from '@/lib/sim/types/results'
import { percent } from '@/lib/format'
import type { StateBreakdown } from '@/lib/sim/types/results'

/** Estados con presencia visible en un conjunto de estaciones. */
export function presentStates(all: readonly SB[]): StateKey[] {
  return STATE_ORDER.filter((k) => all.some((s) => stateValue(s, k) > 0.001))
}

export function StateBar({ states, height = 10 }: { states: StateBreakdown; height?: number }) {
  const t = useTranslations('states')
  const segments = STATE_ORDER.map((k) => ({ k, v: stateValue(states, k) })).filter(
    (s) => s.v > 0.001,
  )

  return (
    <div
      className="flex w-full overflow-hidden rounded-full bg-surface-2"
      style={{ height }}
      role="img"
      aria-label={segments.map((s) => `${t(s.k)} ${percent(s.v)}`).join(', ')}
    >
      {segments.map((s, i) => (
        <div
          key={s.k}
          title={`${t(s.k)} ${percent(s.v, 1)}`}
          style={{
            width: `${s.v * 100}%`,
            background: STATE_VAR[s.k],
            marginLeft: i === 0 ? 0 : 2,
          }}
        />
      ))}
    </div>
  )
}

/**
 * Leyenda de los estados presentes.
 *
 * Solo los que aparecen en los datos: listar seis estados cuando la barra solo
 * tiene dos es ruido, y encima hace dudar de si faltan segmentos por dibujar.
 */
export function StateLegend({ active }: { active?: StateKey[] }) {
  const t = useTranslations('states')
  const keys = active ?? [...STATE_ORDER]
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
      {keys.map((k) => (
        <li key={k} className="flex items-center gap-1.5 text-[11px] text-ink-muted">
          <span
            className="h-2.5 w-2.5 shrink-0 rounded-[3px]"
            style={{ background: STATE_VAR[k] }}
            aria-hidden="true"
          />
          {t(k)}
        </li>
      ))}
    </ul>
  )
}
