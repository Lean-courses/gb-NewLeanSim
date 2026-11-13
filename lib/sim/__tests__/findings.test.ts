/**
 * El diagnostico tiene que distinguir una oportunidad de CAPACIDAD (mueve el
 * throughput) de una de COSTO (no lo mueve). Confundirlas es como se pierden
 * proyectos de mejora: se invierte en un no cuello de botella, no pasa nada, y
 * la proxima vez nadie escucha.
 */

import { describe, expect, it } from 'vitest'
import { diagnose } from '../diagnose/findings'
import { sensitivity } from '../diagnose/sensitivity'
import { applyPatch, templateById } from '../presets/templates'
import { defaultRunConfig, serialLine } from '../presets/builders'
import { simulate } from '../run'

describe('hallazgos de oportunidad', () => {
  it('la restriccion encabeza la lista, con su impacto MEDIDO', () => {
    const tpl = templateById('bottleneck')!
    const model = applyPatch(tpl.model, {})
    const r = simulate(model, model.defaults).result
    const d = diagnose(model, r, sensitivity(model))

    const first = d.findings[0]!
    expect(first.kind).toBe('capacity')
    expect(first.id).toBe('bottleneck')
    expect(first.measured).toBe(true)
    expect(first.impact).toBeGreaterThan(0.09)
    expect(first.title.es).toContain('Est.3')
  })

  it('una parada fuera de la restriccion se marca como COSTO, no capacidad', () => {
    // Est.1 de 8 s parada el 20% (efectivo 10 s) contra una restriccion real
    // de 20 s. Arreglar la Est.1 no da una sola unidad mas.
    const model = serialLine(
      [
        { cycleTime: 8, params: { availability: 0.8, mttr: 10 } },
        { cycleTime: 20 },
        { cycleTime: 8 },
      ],
      {
        line: { flowControl: 'conwip', wipLimit: 12, timeUnit: 'sec' },
        source: { mode: 'unlimited' },
        run: { maxCompletions: 20_000, warmup: 2_000 },
      },
    )
    const r = simulate(model, model.defaults).result
    const d = diagnose(model, r, sensitivity(model))

    const avail = d.findings.find((f) => f.id === 'availability-p01')
    expect(avail).toBeDefined()
    expect(avail!.kind).toBe('cost')
    expect(avail!.detail.es).toContain('NO va a dar una sola unidad')
  })

  it('una parada EN la restriccion se marca como capacidad y se cuantifica', () => {
    const model = serialLine(
      [
        { cycleTime: 8 },
        { cycleTime: 16, params: { availability: 0.8, mttr: 20 } },
        { cycleTime: 8 },
      ],
      {
        line: { flowControl: 'conwip', wipLimit: 12, timeUnit: 'sec' },
        source: { mode: 'unlimited' },
        run: { maxCompletions: 20_000, warmup: 2_000 },
      },
    )
    const r = simulate(model, model.defaults).result
    const d = diagnose(model, r, sensitivity(model))

    const avail = d.findings.find((f) => f.id === 'availability-p02')
    expect(avail).toBeDefined()
    expect(avail!.kind).toBe('capacity')
    expect(avail!.impact).toBeGreaterThan(0.05)
  })

  it('si el sistema no llego a estado estable, lo dice PRIMERO y calla los numeros de flujo', () => {
    // Linea push sobrealimentada: el WIP y el lead time crecen sin techo, asi
    // que el "lead time promedio" describe cuanto duro la corrida y no el
    // proceso. Mostrarselo a un cliente como si fuera un dato es peor que no
    // mostrar nada.
    const tpl = templateById('push-vs-pull')!
    const sc = tpl.scenarios.find((s) => s.id === 'push')!
    const model = applyPatch(tpl.model, sc.patch)
    const r = simulate(model, model.defaults).result
    const d = diagnose(model, r)

    expect(d.steadyState).toBe(false)
    expect(d.findings[0]!.id).toBe('not-steady')
    // Y los hallazgos que dependen del lead time no se emiten.
    expect(d.findings.some((f) => f.id === 'flow-efficiency')).toBe(false)
    expect(d.findings.some((f) => f.id === 'excess-wip')).toBe(false)
  })

  it('en un sistema estable si mide la eficiencia de flujo y el WIP excedente', () => {
    // Con CONWIP el sistema es estable, asi que el lead time significa algo.
    // Un lote de transferencia grande hace que la pieza pase casi todo el
    // tiempo esperando a sus companeras.
    const model = serialLine(
      [{ cycleTime: 10 }, { cycleTime: 10 }, { cycleTime: 10 }],
      {
        line: { flowControl: 'conwip', wipLimit: 40, transferBatch: 10, timeUnit: 'sec' },
        source: { mode: 'unlimited' },
        run: { maxCompletions: 20_000, warmup: 2_000 },
      },
    )
    const r = simulate(model, model.defaults).result
    const d = diagnose(model, r)

    expect(d.steadyState).toBe(true)
    expect(d.flowEfficiency).toBeLessThan(0.3)
    expect(d.excessWip).toBeGreaterThan(1)
    expect(d.findings.some((f) => f.id === 'flow-efficiency')).toBe(true)
    expect(d.findings.some((f) => f.id === 'excess-wip')).toBe(true)
  })

  it('si la linea sobra para la demanda, lo dice y no manda a acelerar nada', () => {
    const model = serialLine([{ cycleTime: 10 }, { cycleTime: 10 }], {
      line: { flowControl: 'push', timeUnit: 'sec' },
      source: { mode: 'interval', interval: 40, variability: 'none' },
      run: { maxCompletions: 5_000, warmup: 500 },
    })
    const r = simulate(model, model.defaults).result
    const d = diagnose(model, r)
    const info = d.findings.find((f) => f.id === 'demand')
    expect(info).toBeDefined()
    expect(info!.detail.es).toContain('no va a dar una sola unidad mas')
  })

  it('los hallazgos de capacidad van primero', () => {
    const tpl = templateById('bottleneck')!
    const model = applyPatch(tpl.model, {})
    const r = simulate(model, model.defaults).result
    const d = diagnose(model, r, sensitivity(model))
    const kinds = d.findings.map((f) => f.kind)
    const lastCapacity = kinds.lastIndexOf('capacity')
    const firstNonCapacity = kinds.findIndex((k) => k !== 'capacity')
    if (lastCapacity >= 0 && firstNonCapacity >= 0) {
      expect(lastCapacity).toBeLessThan(firstNonCapacity)
    }
  })
})
