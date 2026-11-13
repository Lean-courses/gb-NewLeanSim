/**
 * Salida: absorbe las unidades y mide el lead time.
 *
 * Tambien es uno de los dos puntos desde donde se libera una ficha CONWIP
 * (el otro es el scrap). Ambos pasan por el mismo releaseToken() del motor:
 * duplicar esa logica es como se fugan las fichas.
 */

import type { SimEvent } from '../core/calendar'
import type { SimTime } from '../core/dist'
import type { Entity } from '../core/entity'
import { Holder } from '../core/holder'
import type { EngineApi, NodeRuntime } from '../core/runtime'
import { UNLIMITED } from '../types/model'
import type { StationStateId, WaitReason } from '../types/results'

export class SinkNode implements NodeRuntime {
  readonly successors: number[] = []
  readonly predecessors: number[] = []
  readonly inbox: Holder
  readonly type = 'sink'

  received = 0

  constructor(
    readonly idx: number,
    readonly id: string,
    readonly label: string,
  ) {
    this.inbox = new Holder(UNLIMITED)
  }

  canAccept(): boolean {
    return true
  }

  accept(e: Entity, eng: EngineApi): void {
    this.received++
    eng.complete(e)
  }

  waitProduce(nodeIdx: number): void {
    this.inbox.waitProduce(nodeIdx)
  }

  activate(): void {
    /* absorbe en accept(); no retiene nada */
  }

  onEvent(_ev: SimEvent, _eng: EngineApi): void {
    /* no agenda eventos */
  }

  settleStats(_t: SimTime): void {}

  rebase(_t: SimTime): void {
    this.received = 0
  }

  heldCount(): number {
    return 0
  }

  waitReason(): WaitReason | null {
    return null
  }

  setFlushing(): void {}

  canStillProduce(): boolean {
    return false
  }

  wantsMore(): boolean {
    return false
  }

  serverStates(): StationStateId[] {
    return []
  }
}
