import { describe, expect, it } from 'vitest'
import { defaultProcessParams, defaultSourceParams, serialLine } from '../presets/builders'
import { capacityCheck } from '../validate/capacityCheck'
import { hasErrors, validate } from '../validate/validate'

const codes = (m: Parameters<typeof validate>[0]) => validate(m).map((i) => i.code)

describe('validacion', () => {
  it('un modelo sano no tiene errores', () => {
    const m = serialLine([{ cycleTime: 10 }, { cycleTime: 12 }], {
      line: { flowControl: 'push', timeUnit: 'sec' },
      source: { mode: 'unlimited' },
    })
    expect(hasErrors(validate(m))).toBe(false)
  })

  it('detecta falta de entrada y de salida', () => {
    const m = serialLine([{ cycleTime: 10 }], { source: { mode: 'unlimited' } })
    m.nodes = m.nodes.filter((n) => n.type === 'process')
    m.edges = []
    expect(codes(m)).toContain('NO_SOURCE')
    expect(codes(m)).toContain('NO_SINK')
  })

  it('detecta un bloque que no llega a la salida', () => {
    const m = serialLine([{ cycleTime: 10 }, { cycleTime: 10 }], { source: { mode: 'unlimited' } })
    m.edges = m.edges.filter((e) => e.target !== 'z_sink')
    expect(codes(m)).toContain('CANNOT_REACH_SINK')
  })

  it('detecta el tope de WIP por debajo del lote: deadlock garantizado en t=0', () => {
    const m = serialLine([{ cycleTime: 10, params: { processBatch: 8 } }], {
      line: { flowControl: 'conwip', wipLimit: 3, timeUnit: 'sec' },
      source: { mode: 'unlimited' },
    })
    expect(codes(m)).toContain('PULL_CAP_BELOW_BATCH')
  })

  it('avisa de un bucle bajo control de WIP en vez de bloquear la corrida', () => {
    const m = serialLine([{ cycleTime: 10 }, { cycleTime: 10 }], {
      line: { flowControl: 'kanban', wipLimit: 5, timeUnit: 'sec' },
      source: { mode: 'unlimited' },
    })
    m.edges.push({ id: 'e99', source: 'p02', target: 'p01' })
    const issues = validate(m)
    const cycle = issues.find((i) => i.code === 'CYCLE_UNDER_PULL')
    expect(cycle).toBeDefined()
    // Es un aviso, no un error: un deadlock puede ser justo lo que se quiere mostrar.
    expect(cycle!.severity).toBe('warning')
  })

  it('avisa cuando una estacion no da la demanda', () => {
    const m = serialLine([{ cycleTime: 10 }, { cycleTime: 30 }], {
      line: { flowControl: 'push', timeUnit: 'sec' },
      source: { mode: 'interval', interval: 20 },
    })
    expect(codes(m)).toContain('OVERLOADED_STATION')
  })

  it('rechaza valores imposibles del data box', () => {
    const m = serialLine([{ cycleTime: 10 }], { source: { mode: 'unlimited' } })
    m.nodes[1] = {
      ...m.nodes[1]!,
      type: 'process',
      params: defaultProcessParams({ cycleTime: 0, availability: 1.5, scrapRate: 1.2 }),
    } as (typeof m.nodes)[number]
    const c = codes(m)
    expect(c).toContain('CYCLE_TIME_NOT_POSITIVE')
    expect(c).toContain('AVAILABILITY_RANGE')
    expect(c).toContain('SCRAP_RANGE')
  })

  it('detecta una entrada que no termina nunca', () => {
    const m = serialLine([{ cycleTime: 10 }], { source: { mode: 'unlimited' } })
    m.nodes[0] = {
      ...m.nodes[0]!,
      type: 'source',
      params: defaultSourceParams({ mode: 'interval', interval: 0, maxUnits: null }),
    } as (typeof m.nodes)[number]
    expect(codes(m)).toContain('SOURCE_RUNAWAY')
  })
})

describe('chequeo estatico de capacidad', () => {
  it('el tiempo de ciclo efectivo descuenta disponibilidad, changeover y scrap', () => {
    // Ciclo 10 s, changeover 20 s cada lote de 4 (=5 s/unidad), disponibilidad
    // 0,8. Efectivo = (10 + 5) / 0,8 = 18,75 s. Sin scrap aguas abajo.
    const m = serialLine(
      [{ cycleTime: 10, params: { changeoverTime: 20, processBatch: 4, availability: 0.8, mttr: 30 } }],
      { line: { flowControl: 'push', timeUnit: 'sec' }, source: { mode: 'interval', interval: 25 } },
    )
    const r = capacityCheck(m)
    expect(r.stations[0]!.effectiveMs).toBeCloseTo(18_750, 0)
    expect(r.taktMs).toBe(25_000)
    expect(r.stations[0]!.rho).toBeCloseTo(0.75, 3)
    expect(r.infeasible).toBe(false)
  })

  it('el scrap aguas abajo obliga a procesar de mas aguas arriba', () => {
    // Si la Est.2 descarta el 20%, la Est.1 tiene que procesar 1/0,8 = 1,25
    // unidades por cada buena que sale.
    const m = serialLine(
      [{ cycleTime: 10 }, { cycleTime: 10, params: { scrapRate: 0.2 } }],
      { line: { flowControl: 'push', timeUnit: 'sec' }, source: { mode: 'unlimited' } },
    )
    const r = capacityCheck(m)
    expect(r.stations[0]!.scrapInflation).toBeCloseTo(1.25, 6)
    expect(r.stations[0]!.effectiveMs).toBeCloseTo(12_500, 0)
    // Y el cuello de botella pasa a ser la Est.1, no la que descarta.
    expect(r.bottleneckId).toBe('p01')
  })

  it('identifica el cuello de botella y la capacidad de la linea sin simular', () => {
    const m = serialLine([{ cycleTime: 8 }, { cycleTime: 20 }, { cycleTime: 8 }], {
      line: { flowControl: 'push', timeUnit: 'sec' },
      source: { mode: 'unlimited' },
    })
    const r = capacityCheck(m)
    expect(r.bottleneckId).toBe('p02')
    expect(r.lineCapacityPerHour).toBeCloseTo(180, 6)
  })

  it('marca infactible una linea que no llega al takt', () => {
    const m = serialLine([{ cycleTime: 10 }, { cycleTime: 30 }], {
      line: { flowControl: 'push', timeUnit: 'sec' },
      source: { mode: 'interval', interval: 20 },
    })
    expect(capacityCheck(m).infeasible).toBe(true)
  })
})

describe('el analisis estatico y el motor tienen que coincidir', () => {
  // Si la cuenta de servilleta y la simulacion dan distinto, una de las dos
  // esta mal - y frente a un cliente no hay forma de saber cual.
  const cases = [
    { name: 'linea pareja', stations: [{ cycleTime: 10 }, { cycleTime: 10 }] },
    { name: 'linea desbalanceada', stations: [{ cycleTime: 8 }, { cycleTime: 20 }, { cycleTime: 8 }] },
    {
      name: 'con disponibilidad',
      stations: [{ cycleTime: 10, params: { availability: 0.8, mttr: 30 } }, { cycleTime: 9 }],
    },
    {
      name: 'con changeover por lote',
      stations: [{ cycleTime: 10, params: { changeoverTime: 20, processBatch: 4 } }, { cycleTime: 9 }],
    },
    {
      name: 'con scrap aguas abajo',
      stations: [{ cycleTime: 10 }, { cycleTime: 10, params: { scrapRate: 0.2 } }],
    },
    {
      name: 'con maquinas en paralelo',
      stations: [{ cycleTime: 20, params: { servers: 2 } }, { cycleTime: 12 }],
    },
  ]

  for (const c of cases) {
    it(`la capacidad calculada coincide con la simulada: ${c.name}`, async () => {
      const { simulate } = await import('../run')
      const { defaultRunConfig } = await import('../presets/builders')
      const m = serialLine(c.stations, {
        line: { flowControl: 'push', timeUnit: 'sec' },
        source: { mode: 'unlimited' },
      })
      const predicted = capacityCheck(m).lineCapacityPerHour
      const simulated = simulate(
        m,
        defaultRunConfig({ maxCompletions: 30_000, warmup: 5_000, seed: 19 }),
      ).result.kpis.throughputPerHour
      expect(simulated).toBeGreaterThan(predicted * 0.97)
      expect(simulated).toBeLessThan(predicted * 1.03)
    })
  }
})
