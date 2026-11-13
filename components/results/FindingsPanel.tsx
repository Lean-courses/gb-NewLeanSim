'use client'

/**
 * Panel de oportunidades.
 *
 * Es el entregable de una sesion de diagnostico: hallazgos ordenados por
 * impacto, cada uno con su numero y con una etiqueta que dice si mover eso
 * mueve el throughput o no.
 *
 * Esa etiqueta es el aporte real. Decirle a un cliente "tu Est.1 esta parada
 * 22% del tiempo" sin aclarar que arreglarlo no le va a dar una sola unidad
 * mas es como se pierden los proyectos de mejora: se invierte, no pasa nada, y
 * la proxima vez nadie escucha.
 */

import type { DiagnosisReport, Finding, FindingKind } from '@/lib/sim/diagnose/findings'
import { percent } from '@/lib/format'

const KIND_STYLE: Record<FindingKind, { dot: string; chip: string; label: { es: string; en: string } }> = {
  capacity: {
    dot: 'bg-ok',
    chip: 'bg-ok/15 text-ok',
    label: { es: 'Capacidad', en: 'Capacity' },
  },
  flow: {
    dot: 'bg-accent',
    chip: 'bg-accent/15 text-accent',
    label: { es: 'Flujo', en: 'Flow' },
  },
  cost: {
    dot: 'bg-warn',
    chip: 'bg-warn/15 text-warn',
    label: { es: 'Costo', en: 'Cost' },
  },
  info: {
    dot: 'bg-ink-faint',
    chip: 'bg-surface-3 text-ink-muted',
    label: { es: 'Contexto', en: 'Context' },
  },
}

export function FindingsPanel({
  report,
  locale,
  onFocusNode,
}: {
  report: DiagnosisReport
  locale: 'es' | 'en'
  onFocusNode?: (nodeId: string) => void
}) {
  const es = locale === 'es'
  if (report.findings.length === 0) {
    return (
      <p className="text-[12px] text-ink-faint">
        {es
          ? 'No encontramos oportunidades claras en esta corrida.'
          : 'No clear opportunities found in this run.'}
      </p>
    )
  }

  return (
    <div>
      {/*
        Con el sistema divergiendo, el lead time y el WIP no se estabilizan: lo
        que sale describe cuanto duro la corrida y no el proceso. Mostrar esos
        numeros igual seria darle autoridad a un dato que no la tiene.
      */}
      <div className="mb-4 flex flex-wrap gap-3">
        <Metric
          label={es ? 'Eficiencia de flujo' : 'Flow efficiency'}
          value={report.steadyState ? percent(report.flowEfficiency, 1) : '—'}
          hint={
            report.steadyState
              ? es
                ? 'Parte del lead time en que la pieza realmente se trabaja.'
                : 'Share of lead time in which the part is actually worked on.'
              : es
                ? 'No aplica: el lead time no se estabiliza.'
                : 'Not applicable: lead time never settles.'
          }
          tone={report.steadyState && report.flowEfficiency < 0.1 ? 'warn' : undefined}
        />
        <Metric
          label={es ? 'WIP excedente' : 'Surplus WIP'}
          value={report.steadyState ? report.excessWip.toFixed(1) : '—'}
          hint={
            report.steadyState
              ? es
                ? 'Inventario por encima del minimo que exige la Ley de Little.'
                : 'Inventory above the minimum Little’s Law requires.'
              : es
                ? 'No aplica: el inventario crece sin techo.'
                : 'Not applicable: inventory grows without bound.'
          }
          tone={report.steadyState && report.excessWip > 5 ? 'warn' : undefined}
        />
      </div>

      <ol className="space-y-2.5">
        {report.findings.map((f) => (
          <FindingRow key={f.id} finding={f} locale={locale} onFocusNode={onFocusNode} />
        ))}
      </ol>

      <p className="mt-4 border-t border-border pt-3 text-[10px] leading-relaxed text-ink-faint">
        {es
          ? 'Capacidad = mover esto mueve el throughput. Flujo = no cambia la salida pero baja el lead time y el inventario. Costo = una perdida real que no mueve la salida porque no esta en la restriccion.'
          : 'Capacity = moving this moves throughput. Flow = does not change output but cuts lead time and inventory. Cost = a real loss that does not move output because it is not on the constraint.'}
      </p>
    </div>
  )
}

function FindingRow({
  finding,
  locale,
  onFocusNode,
}: {
  finding: Finding
  locale: 'es' | 'en'
  onFocusNode?: (nodeId: string) => void
}) {
  const style = KIND_STYLE[finding.kind]
  const clickable = finding.nodeId !== null && onFocusNode !== undefined

  return (
    <li>
      <div
        role={clickable ? 'button' : undefined}
        tabIndex={clickable ? 0 : undefined}
        onClick={() => clickable && onFocusNode(finding.nodeId!)}
        onKeyDown={(e) => {
          if (clickable && (e.key === 'Enter' || e.key === ' ')) onFocusNode(finding.nodeId!)
        }}
        className={[
          'rounded-card border border-border bg-surface-2 px-4 py-3 transition-colors',
          clickable ? 'cursor-pointer hover:border-border-strong' : '',
        ].join(' ')}
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className={['h-2 w-2 shrink-0 rounded-full', style.dot].join(' ')} aria-hidden="true" />
          <h4 className="text-[13px] font-semibold text-ink">{finding.title[locale]}</h4>
          <span
            className={['rounded-full px-2 py-0.5 text-[10px] font-medium', style.chip].join(' ')}
          >
            {style.label[locale]}
          </span>
          {finding.impact !== null && (
            <span className="tnum ml-auto text-[14px] font-semibold text-ok">
              +{percent(finding.impact)}
              {finding.measured && (
                <span
                  className="ml-1 text-[10px] font-normal text-ink-faint"
                  title={
                    locale === 'es'
                      ? 'Medido simulando la mejora, no estimado.'
                      : 'Measured by simulating the improvement, not estimated.'
                  }
                >
                  {locale === 'es' ? 'medido' : 'measured'}
                </span>
              )}
            </span>
          )}
        </div>
        <p className="mt-1.5 text-[12px] leading-relaxed text-ink-muted">
          {finding.detail[locale]}
        </p>
      </div>
    </li>
  )
}

function Metric({
  label,
  value,
  hint,
  tone,
}: {
  label: string
  value: string
  hint: string
  tone?: 'warn'
}) {
  return (
    <div className="min-w-[160px] flex-1 rounded-card border border-border bg-surface-2 px-4 py-3">
      <span className="block text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
        {label}
      </span>
      <span
        className={[
          'tnum mt-1 block text-[20px] font-semibold leading-none',
          tone === 'warn' ? 'text-warn' : 'text-ink',
        ].join(' ')}
      >
        {value}
      </span>
      <span className="mt-1.5 block text-[10px] leading-relaxed text-ink-faint">{hint}</span>
    </div>
  )
}
