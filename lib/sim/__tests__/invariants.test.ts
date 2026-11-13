/**
 * Invariantes del motor. Son los que atrapan los bugs que producen numeros
 * PLAUSIBLES pero falsos - que, frente a un cliente, es el peor resultado
 * posible.
 */

import { describe, expect, it } from 'vitest'
import { defaultRunConfig, serialLine, type StationSpec } from '../presets/builders'
import { simulate } from '../run'
import type { VarLevel } from '../types/model'

/**
 * La Ley de Little solo vale en ESTADO ESTABLE. Una linea push desbalanceada
 * con entrada ilimitada y buffers infinitos no es estacionaria por
 * construccion: el WIP delante del cuello de botella crece sin techo y tanto L
 * como W divergen. Eso no es un bug del motor - es exactamente la leccion de la
 * demo de push - pero significa que los casos de prueba tienen que ser
 * sistemas estables: o demanda por debajo de la capacidad, o control de WIP.
 */
const CASES: Array<{ name: string; stations: StationSpec[]; v: VarLevel; interval: number }> = [
  { name: 'linea pareja, demanda al 85%', stations: [{ cycleTime: 10 }, { cycleTime: 10 }], v: 'none', interval: 10 / 0.85 },
  { name: 'linea desbalanceada, demanda al 85% del cuello', stations: [{ cycleTime: 8 }, { cycleTime: 20 }, { cycleTime: 8 }], v: 'low', interval: 20 / 0.85 },
  { name: 'alta variabilidad, demanda al 80%', stations: [{ cycleTime: 12 }, { cycleTime: 10 }], v: 'high', interval: 12 / 0.8 },
]

describe('Ley de Little', () => {
  for (const c of CASES) {
    it(`se cumple en ${c.name}`, () => {
      const model = serialLine(
        c.stations.map((s) => ({ ...s, variability: c.v })),
        {
          line: { flowControl: 'push', timeUnit: 'sec' },
          source: { mode: 'interval', interval: c.interval, variability: 'high' },
        },
      )
      const r = simulate(
        model,
        defaultRunConfig({ maxCompletions: 100_000, warmup: 20_000, seed: 42 }),
      ).result
      // L = lambda * W. Un desvio grande delata rebase de calentamiento mal
      // hecho, unidades sin terminar contadas en el lead time, o unidades
      // mezcladas.
      expect(r.kpis.littleError).toBeLessThan(0.03)
    })
  }

  it('en una linea push no estacionaria, Little NO se cumple - y eso es la leccion', () => {
    // Entrada ilimitada contra un cuello de botella: el WIP crece sin techo.
    // El badge de Little tiene que ponerse en ambar, no mentir diciendo que
    // esta todo bien.
    const model = serialLine([{ cycleTime: 8 }, { cycleTime: 20 }, { cycleTime: 8 }], {
      line: { flowControl: 'push', timeUnit: 'sec' },
      source: { mode: 'unlimited' },
    })
    const r = simulate(model, defaultRunConfig({ maxCompletions: 20_000, warmup: 2_000, seed: 42 })).result
    expect(r.kpis.littleError).toBeGreaterThan(0.1)
    expect(r.kpis.wipMean).toBeGreaterThan(100)
  })
})

describe('determinismo', () => {
  it('la misma semilla da resultados identicos en 100 corridas', () => {
    const model = serialLine(
      [
        { cycleTime: 10, variability: 'high' },
        { cycleTime: 12, variability: 'high', params: { availability: 0.9, mttr: 30, scrapRate: 0.05 } },
        { cycleTime: 9, variability: 'low' },
      ],
      { line: { flowControl: 'push', timeUnit: 'sec' }, source: { mode: 'unlimited' } },
    )
    const cfg = defaultRunConfig({ maxCompletions: 2_000, warmup: 200, seed: 777 })
    const first = JSON.stringify(simulate(model, cfg).result)
    for (let i = 0; i < 100; i++) {
      expect(JSON.stringify(simulate(model, cfg).result)).toBe(first)
    }
  })

  it('semillas distintas dan resultados distintos pero del mismo orden', () => {
    const model = serialLine([{ cycleTime: 10, variability: 'high' }], {
      line: { flowControl: 'push', timeUnit: 'sec' },
      source: { mode: 'interval', interval: 12.5, variability: 'high' },
    })
    const a = simulate(model, defaultRunConfig({ maxCompletions: 20_000, warmup: 2_000, seed: 1 })).result
    const b = simulate(model, defaultRunConfig({ maxCompletions: 20_000, warmup: 2_000, seed: 2 })).result
    expect(a.kpis.leadTimeMean).not.toBe(b.kpis.leadTimeMean)
    expect(Math.abs(a.kpis.leadTimeMean - b.kpis.leadTimeMean) / a.kpis.leadTimeMean).toBeLessThan(0.15)
  })

  it('cambiar una estacion NO reordena el azar de las demas (common random numbers)', () => {
    // Es la propiedad que hace honesta una comparacion As-Is / To-Be de una
    // sola replica: si todos los nodos compartieran un generador, tocar el
    // tiempo de ciclo de la Est.2 correria los numeros aleatorios que consume
    // la Est.1 y el delta entre escenarios seria ruido disfrazado de causa.
    const mk = (secondCycle: number) =>
      simulate(
        serialLine(
          [
            { cycleTime: 10, variability: 'high' },
            { cycleTime: secondCycle, variability: 'high' },
          ],
          {
            line: { flowControl: 'push', timeUnit: 'sec' },
            source: { mode: 'interval', interval: 12.5, variability: 'high' },
          },
        ),
        // Horizonte fijo, no "N unidades": si las dos corridas terminaran al
        // completar N unidades, cerrarian en instantes distintos y la ventana
        // de medicion cambiaria el denominador de la utilizacion. Con el mismo
        // horizonte, la Est.1 tiene que dar identica hasta el ultimo bit.
        defaultRunConfig({ horizon: 400_000, warmup: 2_000, seed: 31 }),
      ).result

    const a = mk(5)
    const b = mk(6)
    const first = (r: typeof a) => r.nodes.filter((n) => n.type === 'process')[0]!
    // La Est.1 es aguas arriba y ninguna de las dos variantes la bloquea, asi
    // que su comportamiento tiene que ser IDENTICO, no parecido.
    expect(first(b).processed).toBe(first(a).processed)
    expect(first(b).utilization).toBe(first(a).utilization)
    expect(first(b).avgQueue).toBe(first(a).avgQueue)
    // Y la Est.2, que si cambio, tiene que diferir.
    const second = (r: typeof a) => r.nodes.filter((n) => n.type === 'process')[1]!
    expect(second(b).utilization).toBeGreaterThan(second(a).utilization)
  })

  it('bajo CONWIP el lead time lo gobierna el tope de WIP, no el lote', () => {
    // Resultado util y contraintuitivo: con el WIP acotado, agrandar el lote
    // de transferencia casi no mueve el lead time, porque la Ley de Little ya
    // lo esta fijando en L/lambda. El costo del lote se paga en sistemas sin
    // control de WIP.
    const mk = (transferBatch: number) =>
      simulate(
        serialLine(
          [
            { cycleTime: 10, variability: 'high' },
            { cycleTime: 20, variability: 'high' },
            { cycleTime: 10, variability: 'high' },
          ],
          {
            line: { flowControl: 'conwip', wipLimit: 25, transferBatch, timeUnit: 'sec' },
            source: { mode: 'unlimited' },
          },
        ),
        defaultRunConfig({ maxCompletions: 50_000, warmup: 5_000, seed: 31 }),
      ).result

    const one = mk(1)
    const five = mk(5)
    const bottleneck = (r: typeof one) => r.nodes.filter((n) => n.type === 'process')[1]!
    expect(bottleneck(one).utilization).toBeGreaterThan(0.98)
    expect(bottleneck(five).utilization).toBeGreaterThan(0.98)
    expect(Math.abs(one.kpis.throughputPerHour - five.kpis.throughputPerHour)).toBeLessThan(2)
    const ltDelta = Math.abs(five.kpis.leadTimeMean - one.kpis.leadTimeMean) / one.kpis.leadTimeMean
    expect(ltDelta).toBeLessThan(0.05)
    // Y el WIP queda pegado al tope en los dos casos.
    expect(one.kpis.wipMean).toBeLessThanOrEqual(25)
    expect(five.kpis.wipMean).toBeLessThanOrEqual(25)
  })
})

describe('conservacion y cierre contable', () => {
  it('creadas = terminadas + descartadas + en sistema', () => {
    const model = serialLine(
      [
        { cycleTime: 10, variability: 'high', params: { scrapRate: 0.08 } },
        { cycleTime: 12, variability: 'low', params: { scrapRate: 0.05 } },
      ],
      { line: { flowControl: 'push', timeUnit: 'sec' }, source: { mode: 'unlimited' } },
    )
    const r = simulate(model, defaultRunConfig({ maxCompletions: 20_000, warmup: 0, seed: 17 })).result
    expect(r.kpis.released).toBe(r.kpis.completions + r.kpis.scrapped + r.kpis.inSystemAtEnd)
  })

  it('los tiempos de estado de cada estacion suman la ventana de medicion', () => {
    const model = serialLine(
      [
        { cycleTime: 10, variability: 'high', params: { availability: 0.85, mttr: 20, changeoverTime: 5, processBatch: 3 } },
        { cycleTime: 20, variability: 'low' },
        { cycleTime: 8 },
      ],
      { line: { flowControl: 'push', timeUnit: 'sec' }, source: { mode: 'unlimited' } },
    )
    const r = simulate(model, defaultRunConfig({ maxCompletions: 20_000, warmup: 2_000, seed: 23 })).result
    for (const n of r.nodes.filter((x) => x.type === 'process')) {
      const s = n.states
      const total = s.starved + s.setup + s.busy + s.blocked + s.waitOp + s.down
      // Si no suma 1 hay una transicion de estado perdida en algun camino.
      expect(total).toBeGreaterThan(0.999)
      expect(total).toBeLessThan(1.001)
    }
  })

  it('las fichas CONWIP no se fugan: el throughput no decae a lo largo de la corrida', () => {
    // Una unidad descartada que no devuelve su ficha hace que la linea se vaya
    // frenando sola. Se detecta comparando la primera mitad contra la segunda.
    const model = serialLine(
      [
        { cycleTime: 10, params: { scrapRate: 0.2 } },
        { cycleTime: 10, params: { scrapRate: 0.2 } },
      ],
      { line: { flowControl: 'conwip', wipLimit: 5, timeUnit: 'sec' }, source: { mode: 'unlimited' } },
    )
    const short = simulate(model, defaultRunConfig({ maxCompletions: 5_000, warmup: 500, seed: 13 })).result
    const long = simulate(model, defaultRunConfig({ maxCompletions: 80_000, warmup: 500, seed: 13 })).result
    const drift = Math.abs(long.kpis.throughputPerHour - short.kpis.throughputPerHour) / short.kpis.throughputPerHour
    expect(drift).toBeLessThan(0.02)
  })
})
