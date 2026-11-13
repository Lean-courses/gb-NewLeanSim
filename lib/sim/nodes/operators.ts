/**
 * Pool de operarios: un recurso compartido que se toma mientras la estacion
 * trabaja y se devuelve al terminar. Es lo que permite mostrar que la
 * restriccion real de una linea muchas veces es la dotacion y no la maquina.
 *
 * No maneja material: implementa NodeRuntime solo para vivir en el mismo array
 * indexado que el resto y participar del ciclo de wake/activate.
 */

import type { SimEvent } from '../core/calendar'
import type { SimTime } from '../core/dist'
import type { Entity } from '../core/entity'
import type { Holder } from '../core/holder'
import type { EngineApi, NodeRuntime } from '../core/runtime'
import { TimeWeighted } from '../stats/accumulators'
import type { StationStateId, WaitReason } from '../types/results'

export class OperatorNode implements NodeRuntime {
  readonly successors: number[] = []
  readonly predecessors: number[] = []
  readonly inbox: Holder | null = null
  readonly type = 'operators'

  private inUse = 0
  /** Cola FIFO de indices de estacion esperando dotacion. */
  private readonly queue: number[] = []
  private readonly busyTw: TimeWeighted

  constructor(
    readonly idx: number,
    readonly id: string,
    readonly label: string,
    readonly count: number,
  ) {
    this.busyTw = new TimeWeighted(0, 0)
  }

  trySeize(n: number): boolean {
    if (this.inUse + n > this.count) return false
    this.inUse += n
    return true
  }

  release(n: number, eng: EngineApi): void {
    this.inUse -= n
    this.busyTw.set(eng.t, this.inUse)
    // FIFO estricto: se despierta en orden de llegada, nunca por el orden de
    // iteracion de una estructura.
    if (this.queue.length === 0) return
    const woken = this.queue.slice()
    this.queue.length = 0
    for (const i of woken) eng.wake(i)
  }

  enqueue(nodeIdx: number): void {
    if (!this.queue.includes(nodeIdx)) this.queue.push(nodeIdx)
  }

  utilization(t: SimTime): number {
    return this.count > 0 ? this.busyTw.mean(t) / this.count : 0
  }

  canAccept(): boolean {
    return false
  }

  accept(): void {
    throw new Error('El pool de operarios no recibe material')
  }

  waitProduce(): void {
    /* no recibe material */
  }

  activate(): void {
    /* sin logica propia: reacciona via trySeize/release */
  }

  onEvent(_ev: SimEvent, _eng: EngineApi): void {
    /* no agenda eventos */
  }

  settleStats(t: SimTime): void {
    this.busyTw.set(t, this.inUse)
  }

  rebase(t: SimTime): void {
    this.busyTw.rebase(t)
  }

  heldCount(): number {
    return 0
  }

  waitReason(): WaitReason | null {
    return null
  }

  setFlushing(): void {
    /* nada que drenar */
  }

  canStillProduce(): boolean {
    return false
  }

  wantsMore(): boolean {
    return false
  }

  serverStates(): StationStateId[] {
    return []
  }

  /** Solo para satisfacer el tipado estructural de entidades. */
  declare readonly _entityBrand?: Entity
}
