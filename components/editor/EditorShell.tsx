'use client'

/**
 * Editor completo: paleta, lienzo, inspector, palancas de linea y resultados.
 *
 * El panel de resultados se superpone por abajo en vez de reemplazar el
 * lienzo: frente a un cliente hay que poder señalar la estacion en el diagrama
 * mientras se lee su numero. Si los resultados tapan el modelo, la conversacion
 * se corta.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useModel } from '@/store/modelStore'
import { useSimRunner } from '@/hooks/useSimRunner'
import { modelStore, downloadJson, slugify, markExported } from '@/lib/storage/ModelStore'
import { hasErrors } from '@/lib/sim/validate/validate'
import { capacityCheck } from '@/lib/sim/validate/capacityCheck'
import { diagnoseBottleneck } from '@/lib/sim/diagnose/bottleneck'
import type { SimModel } from '@/lib/sim/types/model'
import { Canvas } from './Canvas'
import { Palette } from './Palette'
import { Inspector } from './Inspector'
import { LineBar } from './LineBar'
import { IssuePanel } from './IssuePanel'
import { CapacityChart } from '../results/CapacityChart'
import { StateBar, StateLegend, presentStates } from '../results/StateBar'
import { duration, percent, rate, units } from '@/lib/format'

/** Espera antes de guardar: escribir en cada tecla pelea con el tipeo. */
const AUTOSAVE_MS = 800

export function EditorShell({ initial, locale }: { initial: SimModel; locale: 'es' | 'en' }) {
  const es = locale === 'es'
  const model = useModel((s) => s.model)
  const issues = useModel((s) => s.issues)
  const dirty = useModel((s) => s.dirty)
  const load = useModel((s) => s.load)
  const setName = useModel((s) => s.setName)
  const markSaved = useModel((s) => s.markSaved)
  const [showResults, setShowResults] = useState(false)
  const runner = useSimRunner()
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    load(initial)
  }, [initial, load])

  // Autoguardado con debounce.
  useEffect(() => {
    if (!model || !dirty) return
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      void modelStore.save(model).then(markSaved)
    }, AUTOSAVE_MS)
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
    }
  }, [model, dirty, markSaved])

  const blocked = hasErrors(issues)
  const cap = useMemo(() => (model ? capacityCheck(model) : null), [model])

  const run = useCallback(() => {
    if (!model || blocked) return
    setShowResults(true)
    runner.runSweep([
      { id: 'run', label: es ? 'Corrida' : 'Run', model, config: model.defaults },
    ])
  }, [model, blocked, runner, es])

  const exportModel = useCallback(() => {
    if (!model) return
    downloadJson(`${slugify(model.name)}.newleansim.json`, model)
    markExported()
  }, [model])

  if (!model) return null

  const result = runner.results[0]?.result ?? null

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] flex-col">
      {/* --- barra superior --- */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3 border-b border-border bg-surface px-4 py-3">
        <div className="flex items-center gap-2">
          <Link href="/" className="text-[12px] text-ink-faint hover:text-ink-muted">
            ←
          </Link>
          <input
            value={model.name}
            onChange={(e) => setName(e.target.value)}
            className="w-[200px] rounded-lg border border-transparent bg-transparent px-2 py-1 text-[14px] font-semibold text-ink outline-none transition-colors hover:border-border focus:border-accent"
            aria-label={es ? 'Nombre del modelo' : 'Model name'}
          />
          <span className="text-[10px] text-ink-faint">
            {dirty ? (es ? 'guardando…' : 'saving…') : es ? 'guardado' : 'saved'}
          </span>
        </div>

        <LineBar locale={locale} />

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={exportModel}
            className="rounded-full border border-border px-3 py-1.5 text-[12px] text-ink-muted transition-colors hover:border-border-strong hover:text-ink"
          >
            {es ? 'Exportar' : 'Export'}
          </button>
          <button
            type="button"
            onClick={run}
            disabled={blocked || runner.running}
            title={blocked ? (es ? 'Hay errores que resolver' : 'There are errors to fix') : undefined}
            className="rounded-full bg-accent-strong px-4 py-1.5 text-[13px] font-semibold text-[#06211f] transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:bg-surface-3 disabled:text-ink-faint"
          >
            {runner.running ? (es ? 'Corriendo…' : 'Running…') : es ? 'Correr' : 'Run'}
          </button>
        </div>
      </div>

      {/* --- cuerpo --- */}
      <div className="relative flex min-h-0 flex-1">
        <aside className="w-[172px] shrink-0 overflow-y-auto border-r border-border bg-surface">
          <Palette locale={locale} />
        </aside>

        <div className="relative min-w-0 flex-1">
          <Canvas />
          {cap && cap.stations.length > 0 && (
            <div className="pointer-events-none absolute bottom-3 left-3 right-3 max-w-[480px] rounded-card border border-border bg-surface/95 p-3.5 backdrop-blur">
              <h3 className="mb-2.5 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
                {es ? 'Ciclo efectivo vs takt' : 'Effective cycle vs takt'}
              </h3>
              <CapacityChart report={cap} locale={locale} />
            </div>
          )}
        </div>

        <aside className="flex w-[292px] shrink-0 flex-col border-l border-border bg-surface">
          <div className="min-h-0 flex-1 overflow-hidden">
            <Inspector locale={locale} />
          </div>
          <div className="border-t border-border">
            <h3 className="px-4 pt-3 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
              {es ? 'Revision del modelo' : 'Model check'}
            </h3>
            <IssuePanel locale={locale} />
          </div>
        </aside>

        {showResults && (
          <ResultsPanel
            result={result}
            model={model}
            locale={locale}
            running={runner.running}
            pct={runner.pct}
            error={runner.error?.message ?? null}
            onClose={() => setShowResults(false)}
          />
        )}
      </div>
    </div>
  )
}

function ResultsPanel({
  result,
  model,
  locale,
  running,
  pct,
  error,
  onClose,
}: {
  result: import('@/lib/sim/types/results').RunResult | null
  model: SimModel
  locale: 'es' | 'en'
  running: boolean
  pct: number
  error: string | null
  onClose: () => void
}) {
  const es = locale === 'es'
  const stations = result?.nodes.filter((n) => n.type === 'process' || n.type === 'inspection') ?? []
  const diag = result ? diagnoseBottleneck(model, result) : null

  return (
    <div className="absolute inset-x-0 bottom-0 z-20 max-h-[60%] overflow-y-auto border-t border-border-strong bg-surface shadow-[0_-12px_32px_rgba(0,0,0,0.5)]">
      <div className="sticky top-0 flex items-center gap-3 border-b border-border bg-surface px-5 py-3">
        <h2 className="text-[13px] font-semibold uppercase tracking-wide text-ink-muted">
          {es ? 'Resultados' : 'Results'}
        </h2>
        {running && (
          <span className="tnum text-[12px] text-ink-faint">
            {es ? 'Corriendo' : 'Running'} {percent(pct)}
          </span>
        )}
        <button
          type="button"
          onClick={onClose}
          className="ml-auto rounded px-2 py-1 text-[12px] text-ink-faint transition-colors hover:text-ink"
        >
          {es ? 'Cerrar' : 'Close'}
        </button>
      </div>

      <div className="p-5">
        {error && <p className="text-[13px] text-bad">{error}</p>}

        {result && (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Kpi label={es ? 'Throughput' : 'Throughput'} value={`${rate(result.kpis.throughputPerHour)}`} unit="u/h" />
              <Kpi label={es ? 'Lead time' : 'Lead time'} value={duration(result.kpis.leadTimeMean)} />
              <Kpi label={es ? 'WIP promedio' : 'Average WIP'} value={units(result.kpis.wipMean)} />
              <Kpi
                label={es ? 'Ley de Little' : "Little's Law"}
                value={percent(result.kpis.littleError, 1)}
                tone={result.kpis.littleError < 0.05 ? 'ok' : 'warn'}
              />
            </div>

            {stations.length > 0 && (
              <section className="mt-5">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
                  <h3 className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
                    {es ? 'Reparto del tiempo' : 'Time breakdown'}
                  </h3>
                  <StateLegend active={presentStates(stations.map((s) => s.states))} />
                </div>
                <ul className="mt-3 space-y-3">
                  {stations.map((s) => (
                    <li key={s.nodeId} className="grid grid-cols-[120px_1fr_52px] items-center gap-3">
                      <span
                        className={[
                          'truncate text-[12px]',
                          s.nodeId === diag?.nodeId ? 'font-semibold text-ink' : 'text-ink-muted',
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
              </section>
            )}

            {result.stopReason === 'deadlock' && result.waitReasons && (
              <section className="mt-5 rounded-card border border-bad/40 bg-bad/10 p-4">
                <h3 className="text-[12px] font-semibold text-ink">
                  {es ? 'La linea se trabo' : 'The line deadlocked'}
                </h3>
                <ul className="mt-2 space-y-1">
                  {result.waitReasons.map((w) => (
                    <li key={w.nodeId} className="text-[12px] text-ink-muted">
                      <span className="font-medium text-ink">{w.label}</span>: {w.detail}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function Kpi({
  label,
  value,
  unit,
  tone,
}: {
  label: string
  value: string
  unit?: string
  tone?: 'ok' | 'warn'
}) {
  return (
    <div className="rounded-card border border-border bg-surface-2 px-4 py-3">
      <span className="block text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
        {label}
      </span>
      <span
        className={[
          'tnum mt-1 block text-[22px] font-semibold leading-none',
          tone === 'warn' ? 'text-warn' : tone === 'ok' ? 'text-ok' : 'text-ink',
        ].join(' ')}
      >
        {value}
        {unit && <span className="ml-1 text-[12px] font-normal text-ink-faint">{unit}</span>}
      </span>
    </div>
  )
}
