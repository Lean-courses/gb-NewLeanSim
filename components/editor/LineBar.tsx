'use client'

/**
 * Las palancas Lean, a nivel linea y en la barra de arriba.
 *
 * Esto es la decision de diseño mas importante de la app: las palancas que
 * cambian el comportamiento del sistema NO viven escondidas dentro de un nodo.
 * Son tres controles, estan siempre a la vista, y mover uno y volver a correr
 * tiene que tardar menos de dos segundos. Ese bucle rapido ES la demostracion.
 */

import { useModel } from '@/store/modelStore'
import { Choice } from './fields'
import type { FlowControl, TimeUnit } from '@/lib/sim/types/model'

export function LineBar({ locale }: { locale: 'es' | 'en' }) {
  const model = useModel((s) => s.model)
  const setLine = useModel((s) => s.setLine)
  const es = locale === 'es'
  if (!model) return null
  const { line } = model

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
      <div className="min-w-[200px]">
        <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
          {es ? 'Control de flujo' : 'Flow control'}
        </span>
        <Choice
          value={line.flowControl}
          options={[
            { value: 'push' as FlowControl, label: 'Push' },
            { value: 'conwip' as FlowControl, label: 'CONWIP' },
            { value: 'kanban' as FlowControl, label: 'Kanban' },
          ]}
          onChange={(v) => setLine({ flowControl: v })}
        />
      </div>

      {line.flowControl !== 'push' && (
        <Slider
          label={
            line.flowControl === 'conwip'
              ? es
                ? 'Tope de WIP'
                : 'WIP cap'
              : es
                ? 'Tarjetas por etapa'
                : 'Cards per stage'
          }
          value={line.wipLimit}
          min={1}
          max={40}
          onChange={(v) => setLine({ wipLimit: v })}
        />
      )}

      <Slider
        label={es ? 'Lote de transferencia' : 'Transfer batch'}
        value={line.transferBatch}
        min={1}
        max={25}
        onChange={(v) => setLine({ transferBatch: v })}
        emphasis={line.transferBatch > 1}
      />

      <div>
        <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
          {es ? 'Unidad' : 'Unit'}
        </span>
        <Choice
          value={line.timeUnit}
          options={[
            { value: 'sec' as TimeUnit, label: 's' },
            { value: 'min' as TimeUnit, label: 'min' },
            { value: 'hour' as TimeUnit, label: 'h' },
          ]}
          onChange={(v) => setLine({ timeUnit: v })}
        />
      </div>
    </div>
  )
}

function Slider({
  label,
  value,
  min,
  max,
  onChange,
  emphasis,
}: {
  label: string
  value: number
  min: number
  max: number
  onChange: (v: number) => void
  emphasis?: boolean
}) {
  return (
    <div className="min-w-[180px]">
      <span className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
          {label}
        </span>
        <span
          className={[
            'tnum text-[13px] font-semibold',
            emphasis ? 'text-state-blocked' : 'text-ink',
          ].join(' ')}
        >
          {value}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-accent"
        aria-label={label}
      />
    </div>
  )
}
