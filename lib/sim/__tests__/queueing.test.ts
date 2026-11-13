/**
 * Contraste contra resultados analiticos de teoria de colas.
 *
 * No se testea M/M/1 sino M/G/1, y a proposito: la app NO expone
 * distribuciones, expone "Ninguna / Baja / Alta", y "Alta" es una lognormal de
 * CV 0,75. Testear M/M/1 obligaria a un camino de configuracion que ningun
 * usuario puede recorrer. La formula de Pollaczek-Khinchine es EXACTA para
 * llegadas Poisson con servicio general, asi que es un contraste mas fuerte y
 * ademas ejercita el codigo de distribuciones real:
 *
 *     Lq = rho^2 * (1 + Cs^2) / (2 * (1 - rho))
 */

import { describe, expect, it } from 'vitest'
import { CV_OF } from '../types/model'
import { defaultRunConfig, serialLine } from '../presets/builders'
import { simulate } from '../run'

function pollaczekKhinchine(rho: number, cs: number): number {
  return (rho * rho * (1 + cs * cs)) / (2 * (1 - rho))
}

describe('colas M/G/1', () => {
  it('reproduce Pollaczek-Khinchine con rho=0,8', () => {
    const rho = 0.8
    const cycle = 1
    const model = serialLine([{ cycleTime: cycle, variability: 'high' }], {
      line: { flowControl: 'push', timeUnit: 'min' },
      source: { mode: 'interval', interval: cycle / rho, variability: 'high' },
    })
    const r = simulate(
      model,
      defaultRunConfig({ maxCompletions: 300_000, warmup: 5_000, seed: 7 }),
    ).result

    const expected = pollaczekKhinchine(rho, CV_OF.high)
    const station = r.nodes.find((n) => n.type === 'process')!
    expect(station.avgQueue).toBeGreaterThan(expected * 0.92)
    expect(station.avgQueue).toBeLessThan(expected * 1.08)
    // La utilizacion tiene que dar rho.
    expect(station.utilization).toBeGreaterThan(rho * 0.97)
    expect(station.utilization).toBeLessThan(rho * 1.03)
  })

  it('sin variabilidad y con llegadas a takt, la cola es practicamente cero', () => {
    const model = serialLine([{ cycleTime: 1, variability: 'none' }], {
      line: { flowControl: 'push', timeUnit: 'min' },
      source: { mode: 'interval', interval: 1 / 0.9, variability: 'none' },
    })
    const r = simulate(model, defaultRunConfig({ maxCompletions: 20_000, warmup: 100 })).result
    const station = r.nodes.find((n) => n.type === 'process')!
    expect(station.avgQueue).toBeLessThan(0.05)
  })

  it('misma capacidad y mismo ciclo medio: la variabilidad hace explotar la cola', () => {
    const mk = (variability: 'none' | 'low' | 'high') =>
      simulate(
        serialLine([{ cycleTime: 1, variability }], {
          line: { flowControl: 'push', timeUnit: 'min' },
          source: { mode: 'interval', interval: 1 / 0.9, variability: 'high' },
        }),
        defaultRunConfig({ maxCompletions: 200_000, warmup: 5_000, seed: 11 }),
      ).result.nodes.find((n) => n.type === 'process')!.avgQueue

    const none = mk('none')
    const low = mk('low')
    const high = mk('high')
    expect(low).toBeGreaterThan(none)
    expect(high).toBeGreaterThan(low)
    // Es la leccion de Kingman: la cola crece con el CV sin que cambie ni la
    // capacidad ni el tiempo de ciclo promedio.
    expect(high / none).toBeGreaterThan(1.3)
  })
})
