/**
 * Contrato entre el motor y los bloques.
 *
 * Esta en un archivo aparte para que `engine.ts` y `nodes/*.ts` no se importen
 * en circulo. Los bloques ven de `Engine` solo lo que esta aca.
 */

import type { Calendar, SimEvent } from './calendar'
import type { SimTime } from './dist'
import type { Entity, EntityPool } from './entity'
import type { Holder, Waker } from './holder'
import type { RngBank } from './rng'
import type { StationStateId } from '../types/results'
import type { WaitReason } from '../types/results'

export interface EngineApi extends Waker {
  readonly t: SimTime
  readonly cal: Calendar
  readonly rng: RngBank
  readonly pool: EntityPool
  readonly nodes: NodeRuntime[]

  /** Agenda un evento. Atajo sobre cal.schedule con el reloj actual. */
  schedule(delay: SimTime, kind: number, nodeIdx: number, payload: number): SimEvent

  /** Registra que una unidad entro a la linea (toma ficha CONWIP si corresponde). */
  admit(e: Entity): void
  /** Libera la ficha CONWIP de una unidad. Unico punto de liberacion. */
  releaseToken(e: Entity): void
  /** Hay ficha disponible para admitir una unidad mas. */
  canAdmit(): boolean
  /** Registra un nodo que espera por una ficha CONWIP. */
  waitForToken(nodeIdx: number): void

  /** Una unidad llego a la salida. */
  complete(e: Entity): void
  /** Una unidad fue descartada en `nodeIdx`. */
  scrap(e: Entity, nodeIdx: number): void

  /** Notifica un cambio de WIP de la linea para la serie temporal. */
  onWipChange(delta: number): void

  /** Registra un evento de traza para la animacion. */
  traceEvent(kind: number, nodeIdx: number, node2: number, entityId: number, aux: number): void
  /** true si hay que trazar esta entidad. */
  shouldTrace(e: Entity): boolean

  /** El calentamiento ya termino (las estadisticas estan acumulando). */
  readonly measuring: boolean
}

/**
 * Un bloque compilado.
 *
 * Regla de oro: los handlers de evento NUNCA mueven material. Mutan estado y
 * llaman wake(). Todo el movimiento ocurre en activate(), drenado a punto fijo
 * por settle() dentro del mismo instante simulado.
 */
export interface NodeRuntime {
  readonly idx: number
  readonly id: string
  readonly type: string
  readonly label: string

  /** Indices de nodos sucesores, en orden del modelo. */
  readonly successors: number[]
  /** Indices de nodos predecesores, en orden del modelo. */
  readonly predecessors: number[]

  /** Cola de entrada, si el bloque recibe material. */
  readonly inbox: Holder | null

  /** Puede recibir `n` unidades ahora. */
  canAccept(n?: number): boolean
  /** Recibe una unidad. Solo valido si canAccept(). */
  accept(e: Entity, eng: EngineApi): void
  /** Registra a `nodeIdx` para ser despertado cuando haya espacio. */
  waitProduce(nodeIdx: number): void

  /** Re-evalua el estado del bloque en el instante actual. Idempotente. */
  activate(eng: EngineApi): void
  /** Maneja un evento agendado por este bloque. */
  onEvent(ev: SimEvent, eng: EngineApi): void

  /** Acumula tiempos de estado hasta `t` (cierre de corrida o rebase). */
  settleStats(t: SimTime): void
  /** Rebasea los acumuladores al terminar el calentamiento. */
  rebase(t: SimTime): void

  /** Unidades que este bloque retiene ahora (para conservacion y deadlock). */
  heldCount(): number
  /** Por que esta esperando, si lo esta. null = no esta bloqueado. */
  waitReason(): WaitReason | null
  /** Fuerza la descarga de lotes parciales al cerrar la corrida. */
  setFlushing(on: boolean): void
  /** true si este bloque podria todavia producir trabajo aguas abajo. */
  canStillProduce(): boolean

  /**
   * true si al bloque le sirve recibir una unidad mas AHORA para no quedarse
   * sin trabajo. Lo consulta la entrada en modo 'unlimited': "la materia prima
   * siempre esta" significa mantener alimentada la estacion siguiente, NO
   * pre-stockear inventario infinito delante de ella.
   */
  wantsMore(): boolean

  /** Estado actual de cada servidor (solo estaciones; vacio en el resto). */
  serverStates(): StationStateId[]
}
