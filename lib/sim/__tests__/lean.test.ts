/**
 * Las demos Lean como test de aceptacion.
 *
 * Si alguna de estas no da, el bug es conceptual y no de implementacion: la
 * herramienta estaria ensenando mal, que es peor que no tener herramienta.
 */

import { describe, expect, it } from 'vitest'
import { defaultRunConfig, serialLine } from '../presets/builders'
import { simulate } from '../run'
import {
  SCHEMA_VERSION,
  type SimModel,
} from '../types/model'
import {
  defaultLine,
  defaultProcessParams,
  defaultRunConfig as cfg,
  defaultSourceParams,
} from '../presets/builders'

describe('push vs pull', () => {
  const stations = [{ cycleTime: 10 }, { cycleTime: 15 }, { cycleTime: 10 }]

  it('en push el WIP crece sin techo delante del cuello de botella', () => {
    // La entrada libera cada 8 s contra un cuello de botella de 15 s: se le
    // mete a la linea casi el doble de lo que puede salir.
    const model = serialLine(stations, {
      line: { flowControl: 'push', timeUnit: 'sec' },
      source: { mode: 'interval', interval: 8, variability: 'none' },
    })
    const r = simulate(model, cfg({ horizon: 40_000, warmup: 0, seed: 1 })).result

    // El throughput lo fija el cuello de botella: 15 s -> 240 u/h.
    expect(r.kpis.throughputPerHour).toBeGreaterThan(230)
    expect(r.kpis.throughputPerHour).toBeLessThan(245)
    // Y el WIP se apila: miles de unidades esperando.
    expect(r.kpis.wipMax).toBeGreaterThan(1_000)
    const bottleneck = r.nodes.filter((n) => n.type === 'process')[1]!
    expect(bottleneck.utilization).toBeGreaterThan(0.99)
    // La cola se junta DELANTE del cuello de botella, no repartida.
    expect(bottleneck.avgQueue).toBeGreaterThan(500)
  })

  it('con CONWIP el throughput es el mismo pero el WIP y el lead time se desploman', () => {
    const push = simulate(
      serialLine(stations, {
        line: { flowControl: 'push', timeUnit: 'sec' },
        source: { mode: 'interval', interval: 8, variability: 'none' },
      }),
      cfg({ horizon: 40_000, warmup: 0, seed: 1 }),
    ).result

    const pull = simulate(
      serialLine(stations, {
        line: { flowControl: 'conwip', wipLimit: 6, timeUnit: 'sec' },
        source: { mode: 'unlimited' },
      }),
      cfg({ horizon: 40_000, warmup: 2_000, seed: 1 }),
    ).result

    // Mismo throughput: meter mas trabajo al sistema no aumenta la salida.
    expect(Math.abs(pull.kpis.throughputPerHour - push.kpis.throughputPerHour)).toBeLessThan(10)
    // Pero el WIP queda acotado por el tope...
    expect(pull.kpis.wipMax).toBeLessThanOrEqual(6)
    // ...y el lead time cae dos ordenes de magnitud.
    expect(pull.kpis.leadTimeMean).toBeLessThan(push.kpis.leadTimeMean / 50)
  })
})

describe('cuello de botella / TOC', () => {
  const run = (cycles: number[]) =>
    simulate(
      serialLine(
        cycles.map((c) => ({ cycleTime: c })),
        { line: { flowControl: 'conwip', wipLimit: 12, timeUnit: 'sec' }, source: { mode: 'unlimited' } },
      ),
      cfg({ maxCompletions: 20_000, warmup: 1_000, seed: 4 }),
    ).result

  it('linea base 8/8/20/8: el cuello de botella fija 180 u/h', () => {
    const r = run([8, 8, 20, 8])
    expect(r.kpis.throughputPerHour).toBeGreaterThan(179)
    expect(r.kpis.throughputPerHour).toBeLessThan(181)
  })

  it('mejorar un NO cuello de botella no cambia nada', () => {
    const base = run([8, 8, 20, 8])
    const improved = run([4, 8, 20, 8])
    // Una hora ganada en un no cuello de botella es un espejismo.
    expect(Math.abs(improved.kpis.throughputPerHour - base.kpis.throughputPerHour)).toBeLessThan(1)
  })

  it('mejorar el cuello de botella duplica el throughput', () => {
    const base = run([8, 8, 20, 8])
    const improved = run([8, 8, 10, 8])
    expect(improved.kpis.throughputPerHour / base.kpis.throughputPerHour).toBeGreaterThan(1.95)
    expect(improved.kpis.throughputPerHour / base.kpis.throughputPerHour).toBeLessThan(2.05)
  })

  it('la firma de bloqueo/hambre senala la restriccion (con espacio finito)', () => {
    // El bloqueo solo aparece si el espacio es FINITO: con buffers infinitos
    // una estacion nunca se bloquea, simplemente descarga a una cola que
    // crece. Y bajo CONWIP tampoco, porque el tope de fichas deja a todo el
    // mundo hambriento por diseno - de ahi que el diagnostico tenga que leer
    // sensibilidad de throughput y no utilizacion cuando hay control de WIP.
    // El caso realista de una planta es espacio finito, que es este.
    const r = simulate(
      serialLine(
        [8, 8, 20, 8].map((c) => ({ cycleTime: c, params: { queueCapacity: 5 } })),
        {
          line: { flowControl: 'push', timeUnit: 'sec' },
          source: { mode: 'interval', interval: 8, variability: 'none' },
        },
      ),
      cfg({ horizon: 40_000, warmup: 2_000, seed: 4 }),
    ).result

    const st = r.nodes.filter((n) => n.type === 'process')
    const bottleneck = st[2]!
    // La restriccion trabaja casi todo el tiempo y casi nunca esta hambrienta.
    expect(bottleneck.utilization).toBeGreaterThan(0.98)
    expect(bottleneck.states.starved).toBeLessThan(0.02)
    // Aguas arriba: bloqueadas. Aguas abajo: hambrientas. Esa es la firma que
    // se dibuja en el canvas y lo que hace que TOC haga clic.
    expect(st[1]!.states.blocked).toBeGreaterThan(0.3)
    expect(st[3]!.states.starved).toBeGreaterThan(0.3)
  })
})

describe('deadlock en pull', () => {
  it('un bucle de retrabajo bajo kanban se traba, y se reporta como tal', () => {
    // Con una sola tarjeta por etapa, la unidad retrabajada no puede volver a
    // la estacion (ya tiene su tarjeta ocupada) y la estacion no puede
    // entregar a la inspeccion (que retiene la unidad a retrabajar). Se miran
    // la cara para siempre.
    const model: SimModel = {
      schemaVersion: SCHEMA_VERSION,
      id: 'deadlock',
      name: 'Bucle de retrabajo con kanban de 1',
      line: defaultLine({ flowControl: 'kanban', wipLimit: 1, timeUnit: 'sec' }),
      nodes: [
        { id: 'a_src', type: 'source', label: 'Entrada', pos: { x: 0, y: 0 }, params: defaultSourceParams({ mode: 'unlimited' }) },
        { id: 'p01', type: 'process', label: 'Est.1', pos: { x: 180, y: 0 }, params: defaultProcessParams({ cycleTime: 10 }) },
        {
          id: 'q01',
          type: 'inspection',
          label: 'Inspeccion',
          pos: { x: 360, y: 0 },
          params: { yield: 0.5, inspectTime: 2, variability: 'none', onFail: 'rework', reworkTarget: 'p01', maxRework: 100 },
        },
        { id: 'z_sink', type: 'sink', label: 'Salida', pos: { x: 540, y: 0 }, params: {} },
      ],
      edges: [
        { id: 'e01', source: 'a_src', target: 'p01' },
        { id: 'e02', source: 'p01', target: 'q01' },
        { id: 'e03', source: 'q01', target: 'z_sink' },
      ],
      defaults: defaultRunConfig(),
    }

    const r = simulate(model, cfg({ maxCompletions: 10_000, warmup: 0, seed: 8 })).result
    expect(r.stopReason).toBe('deadlock')
    // Y sobre todo: no se cuelga ni explota, informa POR QUE esta trabado.
    expect(r.waitReasons).toBeDefined()
    expect(r.waitReasons!.length).toBeGreaterThan(0)
    expect(r.kpis.inSystemAtEnd).toBeGreaterThan(0)
  })
})
