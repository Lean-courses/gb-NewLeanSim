/**
 * Esquema del modelo. Serializable a JSON plano y directamente almacenable en
 * una columna `jsonb` de Postgres el dia que haya backend.
 *
 * REGLAS DURAS (cada una aprendida de un bug clasico):
 *  - Nada de `Infinity`, `NaN` ni `undefined`. `JSON.stringify(Infinity)` emite
 *    `null` en silencio, que luego se vuelve `0` en un parseo descuidado y te
 *    deja una capacidad cero. "Ilimitado" es SIEMPRE `null`, y se convierte a
 *    `Number.MAX_SAFE_INTEGER` recien en compile().
 *  - Nada de `Map` ni `Set`: no sobreviven a JSON y su orden de iteracion
 *    contamina el determinismo.
 *  - Una sola unidad de tiempo canonica adentro (ms enteros). `timeUnit` es
 *    presentacion; la conversion ocurre exactamente una vez, en compile().
 *  - El estado visual vive separado en `pos`/`ui`, para que un diff de
 *    parametros sea un diff real (arrastrar un nodo no ensucia el modelo).
 */

export const SCHEMA_VERSION = 1

/** Nivel de variabilidad expuesto al usuario. Nunca se le pide un desvio. */
export type VarLevel = 'none' | 'low' | 'high'

/** Coeficiente de variacion detras de cada nivel. */
export const CV_OF: Record<VarLevel, number> = {
  none: 0,
  low: 0.25,
  high: 0.75,
}

export type TimeUnit = 'sec' | 'min' | 'hour'

export const MS_PER_UNIT: Record<TimeUnit, number> = {
  sec: 1_000,
  min: 60_000,
  hour: 3_600_000,
}

export type FlowControl = 'push' | 'kanban' | 'conwip'

export interface Pos {
  x: number
  y: number
}

/** Palancas Lean globales: viven en la barra superior, no escondidas en un nodo. */
export interface LineSettings {
  flowControl: FlowControl
  /** kanban: tarjetas por etapa. conwip: tope de WIP de la linea. push: ignorado. */
  wipLimit: number
  /** 1 = one piece flow. Es el lote de TRANSFERENCIA, no el de proceso. */
  transferBatch: number
  /** Solo presentacion: toda entrada numerica de tiempo se interpreta en esta unidad. */
  timeUnit: TimeUnit
}

export type SourceMode = 'interval' | 'takt' | 'unlimited'

export interface SourceParams {
  mode: SourceMode
  /** Intervalo medio entre llegadas, en `line.timeUnit`. Ignorado si mode='unlimited'. */
  interval: number
  variability: VarLevel
  /** Tope de unidades a liberar. null = sin tope. */
  maxUnits: number | null
  /** Que hacer cuando no se puede admitir una llegada. */
  unsatisfiedDemand: 'backlog' | 'lost'
}

/**
 * Data box de VSM. Cada campo visible es un casillero que un practicante Lean
 * ya sabe leer; no hay ningun parametro arbitrario.
 */
export interface ProcessParams {
  // --- Data box (visible en el inspector) ---
  /** C/T - tiempo de ciclo por unidad, en `line.timeUnit`. */
  cycleTime: number
  /** C/O - changeover/setup, aplicado una vez por lote de proceso. */
  changeoverTime: number
  /** Disponibilidad 0..1 (el "A" de OEE). 1 = sin paradas. */
  availability: number
  /** MTTR - duracion media de una parada, en `line.timeUnit`. */
  mttr: number
  /** Fraccion descartada en esta estacion, 0..1. */
  scrapRate: number
  /** Dotacion requerida del pool de operarios mientras trabaja. 0 = no requiere. */
  operators: number
  variability: VarLevel

  // --- Avanzado ---
  /** Maquinas en paralelo. */
  servers: number
  /** Lote de PROCESO: unidades tomadas y trabajadas como un lote. */
  processBatch: number
  /** 'sequential' = linea (tiempo x n). 'simultaneous' = horno (tiempo fijo). */
  batchMode: 'sequential' | 'simultaneous'
  /** Lote de TRANSFERENCIA. null = hereda de line.transferBatch. */
  transferBatch: number | null
  /** Capacidad de la cola de entrada. null = ilimitada. */
  queueCapacity: number | null
  /** Tarjetas kanban de esta etapa. null = hereda de line.wipLimit. */
  kanbanCards: number | null
  /** Id del nodo 'operators' del que toma dotacion. null = ninguno. */
  operatorPool: string | null
}

export interface BufferParams {
  /** Capacidad. null = ilimitada. */
  capacity: number | null
  /** Inventario inicial. */
  initial: number
}

export interface InspectionParams {
  /** Fraccion que pasa, 0..1. */
  yield: number
  inspectTime: number
  variability: VarLevel
  onFail: 'scrap' | 'rework'
  /** Nodo al que vuelve una unidad rechazada. null = scrap. */
  reworkTarget: string | null
  /** Tope de reprocesos antes de descartar. */
  maxRework: number
}

export interface SinkParams {
  /** Reservado: sin parametros en v1. */
  readonly _?: never
}

export interface OperatorParams {
  /** Cantidad de operarios en el pool. */
  count: number
}

export type SimNode =
  | { id: string; type: 'source'; label: string; pos: Pos; params: SourceParams }
  | { id: string; type: 'process'; label: string; pos: Pos; params: ProcessParams }
  | { id: string; type: 'buffer'; label: string; pos: Pos; params: BufferParams }
  | { id: string; type: 'inspection'; label: string; pos: Pos; params: InspectionParams }
  | { id: string; type: 'sink'; label: string; pos: Pos; params: SinkParams }
  | { id: string; type: 'operators'; label: string; pos: Pos; params: OperatorParams }

export type NodeType = SimNode['type']

export interface SimEdge {
  id: string
  source: string
  target: string
  /** Compatibilidad con React Flow. */
  sourceHandle?: string
  targetHandle?: string
  params?: {
    /** Tiempo de traslado, en `line.timeUnit`. */
    moveTime?: number
    /** Peso para ruteo probabilistico. Los pesos salientes deben sumar 1. */
    weight?: number
    kind?: 'normal' | 'rework'
  }
}

/** Reglas de ruteo cuando una estacion tiene mas de una salida normal. */
export type RoutingRule = 'probability' | 'shortest-queue' | 'round-robin'

export interface RunConfig {
  seed: number
  /** Horizonte en `line.timeUnit`. null = sin tope de tiempo. */
  horizon: number | null
  /** Detener tras N unidades terminadas. null = sin tope. */
  maxCompletions: number | null
  /** Periodo de calentamiento descartado, en `line.timeUnit`. */
  warmup: number
  /** Replicas independientes (semilla + i). */
  replications: number
  /** Nivel de traza para animacion. */
  trace: TraceLevel
  /** Corte duro de seguridad en cantidad de eventos. */
  maxEvents: number
}

export type TraceLevel = 'none' | 'counts' | 'full'

export interface SimModel {
  schemaVersion: number
  id: string
  name: string
  description?: string
  line: LineSettings
  nodes: SimNode[]
  edges: SimEdge[]
  defaults: RunConfig
  /** Estado visual puro. El motor lo ignora por completo. */
  ui?: {
    viewport?: { x: number; y: number; zoom: number }
  }
}

/** Centinela interno para "ilimitado" una vez compilado. Nunca se serializa. */
export const UNLIMITED = Number.MAX_SAFE_INTEGER
