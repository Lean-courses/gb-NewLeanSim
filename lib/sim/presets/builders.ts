/**
 * Constructores de modelos. Los usan las plantillas Lean y los tests.
 *
 * Existen para que definir "una linea de 3 estaciones de 1 minuto" sea una
 * linea de codigo y no treinta, y para que los tests dorados describan el caso
 * analitico y no la plomeria del esquema.
 */

import {
  SCHEMA_VERSION,
  type LineSettings,
  type ProcessParams,
  type RunConfig,
  type SimEdge,
  type SimModel,
  type SimNode,
  type SourceParams,
  type VarLevel,
} from '../types/model'

export function defaultProcessParams(overrides: Partial<ProcessParams> = {}): ProcessParams {
  return {
    cycleTime: 1,
    changeoverTime: 0,
    availability: 1,
    mttr: 0,
    scrapRate: 0,
    operators: 0,
    variability: 'none',
    servers: 1,
    processBatch: 1,
    batchMode: 'sequential',
    transferBatch: null,
    queueCapacity: null,
    kanbanCards: null,
    operatorPool: null,
    ...overrides,
  }
}

export function defaultSourceParams(overrides: Partial<SourceParams> = {}): SourceParams {
  return {
    mode: 'unlimited',
    interval: 1,
    variability: 'none',
    maxUnits: null,
    unsatisfiedDemand: 'backlog',
    ...overrides,
  }
}

export function defaultRunConfig(overrides: Partial<RunConfig> = {}): RunConfig {
  return {
    seed: 12345,
    horizon: null,
    maxCompletions: null,
    warmup: 0,
    replications: 1,
    trace: 'none',
    maxEvents: 5_000_000,
    ...overrides,
  }
}

export function defaultLine(overrides: Partial<LineSettings> = {}): LineSettings {
  return {
    flowControl: 'push',
    wipLimit: 10,
    transferBatch: 1,
    timeUnit: 'min',
    ...overrides,
  }
}

export interface StationSpec {
  label?: string
  cycleTime: number
  variability?: VarLevel
  params?: Partial<ProcessParams>
}

/**
 * Linea serial: entrada -> est.1 -> ... -> est.n -> salida.
 *
 * Los ids se emiten con padding (`p01`, `p02`, ...) a proposito: el motor
 * ordena los nodos por id para asignar indices, y sin padding `p10` quedaria
 * antes que `p2`. No cambia ningun resultado, pero deja los indices alineados
 * con el orden visual de la linea, que hace mucho mas legible un diagnostico.
 */
export function serialLine(
  stations: StationSpec[],
  opts: {
    name?: string
    line?: Partial<LineSettings>
    source?: Partial<SourceParams>
    run?: Partial<RunConfig>
  } = {},
): SimModel {
  const nodes: SimNode[] = []
  const edges: SimEdge[] = []

  nodes.push({
    id: 'a_source',
    type: 'source',
    label: 'Entrada',
    pos: { x: 0, y: 0 },
    params: defaultSourceParams(opts.source),
  })

  stations.forEach((s, i) => {
    const id = `p${String(i + 1).padStart(2, '0')}`
    nodes.push({
      id,
      type: 'process',
      label: s.label ?? `Est.${i + 1}`,
      pos: { x: (i + 1) * 180, y: 0 },
      params: defaultProcessParams({
        cycleTime: s.cycleTime,
        variability: s.variability ?? 'none',
        ...s.params,
      }),
    })
  })

  nodes.push({
    id: 'z_sink',
    type: 'sink',
    label: 'Salida',
    pos: { x: (stations.length + 1) * 180, y: 0 },
    params: {},
  })

  const chain = ['a_source', ...stations.map((_, i) => `p${String(i + 1).padStart(2, '0')}`), 'z_sink']
  for (let i = 0; i < chain.length - 1; i++) {
    edges.push({
      id: `e${String(i + 1).padStart(2, '0')}`,
      source: chain[i]!,
      target: chain[i + 1]!,
    })
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    id: 'test-model',
    name: opts.name ?? 'Linea serial',
    line: defaultLine(opts.line),
    nodes,
    edges,
    defaults: defaultRunConfig(opts.run),
  }
}
