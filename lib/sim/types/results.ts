/** Estados de un servidor. Mutuamente excluyentes y exhaustivos. */
export const StationState = {
  /** Ocioso: no hay entrada disponible. */
  Starved: 0,
  /** Haciendo changeover. */
  Setup: 1,
  /** Trabajando. */
  Busy: 2,
  /** Termino o podria arrancar, pero aguas abajo no acepta. */
  Blocked: 3,
  /** Hay entrada, pero el pool de operarios esta ocupado. */
  WaitOp: 4,
  /** Parada por falla. */
  Down: 5,
} as const

export type StationStateId = (typeof StationState)[keyof typeof StationState]

export const N_STATES = 6

export const STATE_NAMES: Record<StationStateId, string> = {
  [StationState.Starved]: 'starved',
  [StationState.Setup]: 'setup',
  [StationState.Busy]: 'busy',
  [StationState.Blocked]: 'blocked',
  [StationState.WaitOp]: 'waitOp',
  [StationState.Down]: 'down',
}

export const StopReason = {
  Horizon: 'horizon',
  Completions: 'completions',
  NoMoreEvents: 'noMoreEvents',
  /** El calendario se vacio con entidades todavia en la linea. */
  Deadlock: 'deadlock',
  EventBudget: 'eventBudget',
  Cancelled: 'cancelled',
} as const

export type StopReasonId = (typeof StopReason)[keyof typeof StopReason]

/** Por que esta esperando un nodo, para explicar un deadlock. */
export interface WaitReason {
  nodeId: string
  label: string
  state: string
  detail: string
}

export interface StateBreakdown {
  starved: number
  setup: number
  busy: number
  blocked: number
  waitOp: number
  down: number
}

export interface NodeStats {
  nodeId: string
  label: string
  type: string
  /** Fracciones 0..1 del tiempo de medicion, suman 1 por servidor promediado. */
  states: StateBreakdown
  /** Fraccion del tiempo trabajando = utilizacion. */
  utilization: number
  /** Largo promedio de la cola de entrada, ponderado por tiempo. */
  avgQueue: number
  maxQueue: number
  /** WIP promedio de la etapa (cola + en proceso + slot de salida). */
  avgStageWip: number
  /** Espera promedio en cola, por unidad. */
  avgQueueWait: number
  /** Unidades que terminaron servicio en esta estacion. */
  processed: number
  scrapped: number
  /** Cantidad de paradas por falla. */
  failures: number
}

export interface Histogram {
  /** Limite inferior del primer bin. */
  lo: number
  /** Ancho de bin. */
  width: number
  counts: number[]
}

export interface Series {
  /** Ancho de bucket en ms. */
  bucketMs: number
  t0: number
  /** Promedio ponderado por tiempo dentro de cada bucket. */
  mean: number[]
  max: number[]
}

export interface Kpis {
  /** Unidades terminadas por hora. */
  throughputPerHour: number
  completions: number
  scrapped: number
  released: number
  inSystemAtEnd: number
  /** Demanda no satisfecha (backlog + perdida). */
  unmetDemand: number

  leadTimeMean: number
  leadTimeSd: number
  leadTimeP50: number
  leadTimeP90: number
  leadTimeP95: number
  leadTimeMin: number
  leadTimeMax: number

  /** WIP promedio de la linea, ponderado por tiempo. */
  wipMean: number
  wipMax: number

  /** Chequeo de la Ley de Little: L estimado vs lambda*W. */
  littleL: number
  littleLambdaW: number
  littleError: number

  /** Ventana de medicion en ms (horizonte menos calentamiento). */
  measureWindowMs: number
}

export interface RunResult {
  stopReason: StopReasonId
  /** true si se corto por presupuesto de eventos: los numeros son parciales. */
  truncated: boolean
  simTimeMs: number
  eventCount: number
  kpis: Kpis
  nodes: NodeStats[]
  leadTimeHistogram: Histogram
  wipSeries: Series
  queueSeries: Record<string, Series>
  /** Muestra de lead times para el box plot. */
  leadTimeSample: number[]
  /** Presente solo si stopReason = deadlock. */
  waitReasons?: WaitReason[]
  /** Muestras recortadas por la guarda de cola: distinto de cero es un aviso. */
  clampedSamples: number
}
