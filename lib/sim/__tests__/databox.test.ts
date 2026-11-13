/**
 * Data box VSM: disponibilidad, scrap y changeover.
 *
 * Son los campos que hacen creible un modelo de cliente, asi que tienen que
 * dar los numeros que el cliente ya conoce de su propia planta.
 */

import { describe, expect, it } from 'vitest'
import { mtbfFromAvailability } from '../core/compile'
import { defaultRunConfig, serialLine } from '../presets/builders'
import { simulate } from '../run'

describe('disponibilidad (OEE)', () => {
  it('deriva el MTBF de la disponibilidad: A = MTBF / (MTBF + MTTR)', () => {
    // A=0,8 con MTTR de 60 s implica MTBF de 240 s.
    expect(mtbfFromAvailability(0.8, 60_000)!).toBeCloseTo(240_000, 6)
    expect(mtbfFromAvailability(0.9, 60_000)!).toBeCloseTo(540_000, 6)
    // Disponibilidad plena = sin paradas.
    expect(mtbfFromAvailability(1, 60_000)).toBeNull()
  })

  it('una estacion al 80% entrega el 80% de su capacidad nominal', () => {
    // Ciclo de 10 s al 100% = 360 u/h. Al 80% de disponibilidad: 288 u/h.
    const model = serialLine(
      [{ cycleTime: 10, params: { availability: 0.8, mttr: 60 } }],
      { line: { flowControl: 'push', timeUnit: 'sec' }, source: { mode: 'unlimited' } },
    )
    const r = simulate(
      model,
      defaultRunConfig({ maxCompletions: 100_000, warmup: 20_000, seed: 3 }),
    ).result

    expect(r.kpis.throughputPerHour).toBeGreaterThan(288 * 0.97)
    expect(r.kpis.throughputPerHour).toBeLessThan(288 * 1.03)

    const st = r.nodes.find((n) => n.type === 'process')!
    // Operando el 80% del tiempo, parada el 20%. Sin hambre ni bloqueo.
    expect(st.states.busy).toBeGreaterThan(0.77)
    expect(st.states.busy).toBeLessThan(0.83)
    expect(st.states.down).toBeGreaterThan(0.17)
    expect(st.states.down).toBeLessThan(0.23)
    expect(st.failures).toBeGreaterThan(0)
  })

  it('la rotura ocurre a mitad de ciclo y el trabajo se reanuda, no se reinicia', () => {
    // Con ciclo largo y MTBF corto, cada unidad sufre varias paradas. Si el
    // ciclo se reiniciara en vez de reanudarse, el throughput se desplomaria
    // muy por debajo de A/ciclo.
    const model = serialLine(
      [{ cycleTime: 600, params: { availability: 0.5, mttr: 60 } }],
      { line: { flowControl: 'push', timeUnit: 'sec' }, source: { mode: 'unlimited' } },
    )
    const r = simulate(
      model,
      defaultRunConfig({ maxCompletions: 20_000, warmup: 20_000, seed: 5 }),
    ).result
    // 600 s de ciclo al 50% = 1200 s efectivos = 3 u/h.
    expect(r.kpis.throughputPerHour).toBeGreaterThan(3 * 0.95)
    expect(r.kpis.throughputPerHour).toBeLessThan(3 * 1.05)
  })
})

describe('scrap', () => {
  it('el rendimiento compuesto es multiplicativo a lo largo de la linea', () => {
    const model = serialLine(
      [
        { cycleTime: 1, params: { scrapRate: 0.1 } },
        { cycleTime: 1, params: { scrapRate: 0.1 } },
        { cycleTime: 1, params: { scrapRate: 0.1 } },
      ],
      { line: { flowControl: 'push', timeUnit: 'sec' }, source: { mode: 'unlimited' } },
    )
    const r = simulate(
      model,
      defaultRunConfig({ maxCompletions: 100_000, warmup: 0, seed: 9 }),
    ).result

    const yieldRate = r.kpis.completions / r.kpis.released
    expect(yieldRate).toBeGreaterThan(0.729 * 0.98)
    expect(yieldRate).toBeLessThan(0.729 * 1.02)
    expect(r.kpis.scrapped).toBeGreaterThan(0)
  })
})

describe('changeover', () => {
  it('el setup se cobra una vez por lote de proceso, no por unidad', () => {
    // Ciclo 10 s, setup 50 s, lote de proceso 5 -> 100 s por lote = 20 s/unidad.
    const model = serialLine(
      [{ cycleTime: 10, params: { changeoverTime: 50, processBatch: 5 } }],
      { line: { flowControl: 'push', timeUnit: 'sec' }, source: { mode: 'unlimited' } },
    )
    const r = simulate(
      model,
      defaultRunConfig({ maxCompletions: 10_000, warmup: 1_000, seed: 2 }),
    ).result
    // 20 s/unidad = 180 u/h.
    expect(r.kpis.throughputPerHour).toBeGreaterThan(180 * 0.98)
    expect(r.kpis.throughputPerHour).toBeLessThan(180 * 1.02)
  })

  it('mitad de tiempo de cambio = mas capacidad: el argumento SMED, cuantificado', () => {
    const run = (setup: number) =>
      simulate(
        serialLine([{ cycleTime: 10, params: { changeoverTime: setup, processBatch: 5 } }], {
          line: { flowControl: 'push', timeUnit: 'sec' },
          source: { mode: 'unlimited' },
        }),
        defaultRunConfig({ maxCompletions: 10_000, warmup: 1_000 }),
      ).result.kpis.throughputPerHour

    const before = run(50)
    const after = run(25)
    // 100 s/lote -> 75 s/lote: +33% de capacidad sin tocar la maquina.
    expect(after / before).toBeGreaterThan(1.3)
    expect(after / before).toBeLessThan(1.37)
  })
})
