/**
 * Las 4 plantillas como test de aceptacion end-to-end.
 *
 * Cada `expect` declarado en la plantilla es un resultado analitico conocido.
 * Si uno deja de dar, el bug es conceptual y la herramienta estaria ensenando
 * mal - que es peor que no tener herramienta.
 */

import { describe, expect, it } from 'vitest'
import { applyPatch, TEMPLATES } from '../presets/templates'
import { simulate } from '../run'
import { hasErrors, validate } from '../validate/validate'

describe('plantillas Lean', () => {
  for (const t of TEMPLATES) {
    describe(t.name.es, () => {
      it('el modelo es valido', () => {
        const issues = validate(t.model)
        if (hasErrors(issues)) {
          throw new Error(
            `Errores de validacion: ${issues.filter((i) => i.severity === 'error').map((i) => i.code).join(', ')}`,
          )
        }
      })

      it('tiene nombre, resumen, punto y que mirar en los dos idiomas', () => {
        for (const field of [t.name, t.summary, t.insight, t.watch]) {
          expect(field.es.length).toBeGreaterThan(0)
          expect(field.en.length).toBeGreaterThan(0)
        }
      })

      for (const sc of t.scenarios) {
        it(`escenario "${sc.label.es}" corre y da lo esperado`, () => {
          const model = applyPatch(t.model, sc.patch)
          expect(hasErrors(validate(model))).toBe(false)
          const r = simulate(model, model.defaults).result
          expect(r.stopReason).not.toBe('deadlock')
          expect(r.kpis.completions).toBeGreaterThan(0)

          if (sc.expect?.throughputPerHour) {
            const [lo, hi] = sc.expect.throughputPerHour
            expect(r.kpis.throughputPerHour).toBeGreaterThanOrEqual(lo)
            expect(r.kpis.throughputPerHour).toBeLessThanOrEqual(hi)
          }
          if (sc.expect?.leadTimeMs) {
            const [lo, hi] = sc.expect.leadTimeMs
            expect(r.kpis.leadTimeMean).toBeGreaterThanOrEqual(lo)
            expect(r.kpis.leadTimeMean).toBeLessThanOrEqual(hi)
          }
          if (sc.expect?.wipMax) {
            const [lo, hi] = sc.expect.wipMax
            expect(r.kpis.wipMax).toBeGreaterThanOrEqual(lo)
            expect(r.kpis.wipMax).toBeLessThanOrEqual(hi)
          }
        })
      }
    })
  }
})

describe('contrastes que son el punto de cada plantilla', () => {
  const runScenario = (templateId: string, scenarioId: string) => {
    const t = TEMPLATES.find((x) => x.id === templateId)!
    const sc = t.scenarios.find((x) => x.id === scenarioId)!
    const model = applyPatch(t.model, sc.patch)
    return simulate(model, model.defaults).result
  }

  it('lote vs flujo: el lead time cae 4x y el throughput no cambia', () => {
    const batch = runScenario('batch-vs-flow', 'batch-10')
    const flow = runScenario('batch-vs-flow', 'one-piece')
    expect(batch.kpis.leadTimeMean / flow.kpis.leadTimeMean).toBe(4)
    // Las 10 unidades salen igual en los dos casos: el lote no cambia la
    // capacidad, cambia cuando sale cada una.
    expect(batch.kpis.completions).toBe(flow.kpis.completions)
    expect(flow.kpis.leadTimeMin).toBeLessThan(batch.kpis.leadTimeMin)
  })

  it('push vs pull: mismo throughput, WIP y lead time muy distintos', () => {
    const push = runScenario('push-vs-pull', 'push')
    const pull = runScenario('push-vs-pull', 'conwip')
    expect(Math.abs(push.kpis.throughputPerHour - pull.kpis.throughputPerHour)).toBeLessThan(10)
    expect(pull.kpis.wipMax).toBeLessThan(push.kpis.wipMax / 100)
    expect(pull.kpis.leadTimeMean).toBeLessThan(push.kpis.leadTimeMean / 50)
  })

  it('TOC: mejorar el no cuello no hace nada, mejorar la restriccion duplica', () => {
    const base = runScenario('bottleneck', 'baseline')
    const nonBottleneck = runScenario('bottleneck', 'improve-non-bottleneck')
    const constraint = runScenario('bottleneck', 'improve-bottleneck')
    expect(Math.abs(nonBottleneck.kpis.throughputPerHour - base.kpis.throughputPerHour)).toBeLessThan(1)
    expect(constraint.kpis.throughputPerHour / base.kpis.throughputPerHour).toBeGreaterThan(1.95)
  })

  it('variabilidad: misma capacidad, la cola explota', () => {
    const none = runScenario('variability', 'no-variability')
    const proc = runScenario('variability', 'process-variability')
    const both = runScenario('variability', 'high-variability')
    const q = (r: typeof none) => r.nodes.find((n) => n.type === 'process')!.avgQueue

    // Sin dispersion en ningun lado, la cola es practicamente cero.
    expect(q(none)).toBeLessThan(0.1)
    // Agregar dispersion solo en el proceso ya la dispara.
    expect(q(proc)).toBeGreaterThan(q(none) + 1)
    // Y agregarsela tambien a la demanda la vuelve a disparar: la ecuacion de
    // Kingman tiene los dos terminos, no solo el del proceso.
    expect(q(both)).toBeGreaterThan(q(proc) * 1.5)
    expect(q(both)).toBeGreaterThan(3)
    // El throughput es el mismo en las tres: lo fija la demanda, no la dispersion.
    expect(Math.abs(both.kpis.throughputPerHour - none.kpis.throughputPerHour)).toBeLessThan(5)
    expect(Math.abs(proc.kpis.throughputPerHour - none.kpis.throughputPerHour)).toBeLessThan(5)
  })
})
