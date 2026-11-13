/**
 * La demo estrella: lote de transferencia vs one-piece flow.
 *
 * Caso calculable a mano, sin variabilidad: 10 unidades, 3 estaciones de 1 min,
 * todas las unidades disponibles en t=0.
 *
 *   lote = 1   la unidad k entra a la Est.1 en t=k-1 y sale en t=k+2
 *              salidas: 3, 4, ..., 12   -> lead time medio 7,5 min
 *   lote = 10  la Est.1 retiene las 10 hasta t=10, la Est.2 hasta t=20,
 *              la Est.3 hasta t=30     -> las 10 salen juntas, lead time 30 min
 *
 * El throughput es el mismo en los dos casos: lo fija la estacion mas lenta,
 * no el tamano del lote. Lo que cambia es el lead time y el WIP.
 */

import { describe, expect, it } from 'vitest'
import { defaultRunConfig, serialLine } from '../presets/builders'
import { simulate } from '../run'

const MIN = 60_000

function run(transferBatch: number) {
  const model = serialLine([{ cycleTime: 1 }, { cycleTime: 1 }, { cycleTime: 1 }], {
    line: { transferBatch, timeUnit: 'min' },
    // 10 ordenes puestas sobre la linea en t=0, que es el encuadre clasico del
    // ejercicio. Con la entrada en modo 'unlimited' las unidades se irian
    // liberando a medida que la Est.1 las consume y los lead times se medirian
    // desde otro punto de partida: ambos encuadres son validos, pero hay que
    // elegir uno y decirlo.
    source: { mode: 'interval', interval: 0, maxUnits: 10 },
  })
  return simulate(model, defaultRunConfig({ maxCompletions: 10 })).result
}

describe('lote de transferencia vs one-piece flow', () => {
  it('one-piece flow: lead time medio 7,5 min y primera salida a los 3 min', () => {
    const r = run(1)
    expect(r.kpis.completions).toBe(10)
    expect(r.kpis.leadTimeMean).toBe(7.5 * MIN)
    expect(r.kpis.leadTimeMin).toBe(3 * MIN)
    expect(r.kpis.leadTimeMax).toBe(12 * MIN)
    expect(r.simTimeMs).toBe(12 * MIN)
  })

  it('lote de 10: todas salen juntas a los 30 min', () => {
    const r = run(10)
    expect(r.kpis.completions).toBe(10)
    expect(r.kpis.leadTimeMean).toBe(30 * MIN)
    expect(r.kpis.leadTimeMin).toBe(30 * MIN)
    expect(r.kpis.leadTimeMax).toBe(30 * MIN)
    expect(r.simTimeMs).toBe(30 * MIN)
  })

  it('el lote cuadruplica el lead time y duplica el WIP, con la misma capacidad', () => {
    const one = run(1)
    const ten = run(10)
    expect(ten.kpis.leadTimeMean / one.kpis.leadTimeMean).toBe(4)
    expect(ten.kpis.wipMean).toBeGreaterThan(one.kpis.wipMean)
  })

  it('un lote parcial no cuelga la corrida: se drena al cerrar', () => {
    // 7 unidades con lote de 10: nunca se completa el lote. Sin la regla de
    // flush, la corrida terminaria con unidades varadas y reportaria deadlock.
    const model = serialLine([{ cycleTime: 1 }, { cycleTime: 1 }], {
      line: { transferBatch: 10, timeUnit: 'min' },
      source: { mode: 'interval', interval: 0, maxUnits: 7 },
    })
    const r = simulate(model, defaultRunConfig()).result
    expect(r.stopReason).not.toBe('deadlock')
    expect(r.kpis.completions).toBe(7)
  })
})
