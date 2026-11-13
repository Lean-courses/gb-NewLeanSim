/**
 * Inventario: una cola explicita en el canvas.
 *
 * Funcionalmente es lo mismo que la cola de entrada implicita de una estacion,
 * pero existe como bloque propio por una razon que no es tecnica: es donde el
 * WIP se VE. En la vista isometrica la pila de cubos creciendo delante del
 * cuello de botella es el argumento visual de toda la demo de push.
 */

import type { SimEvent } from '../core/calendar'
import type { SimTime } from '../core/dist'
import type { Entity } from '../core/entity'
import { Holder } from '../core/holder'
import type { EngineApi } from '../core/runtime'
import { TimeWeighted } from '../stats/accumulators'
import type { StationStateId } from '../types/results'
import { TraceKind } from '../types/trace'
import { DischargingNode } from './base'

export interface BufferInit {
  idx: number
  id: string
  label: string
  capacity: number
  transferBatch: number
  initial: number
}

export class BufferNode extends DischargingNode {
  readonly inbox: Holder
  private readonly levelTw: TimeWeighted
  readonly initial: number

  constructor(init: BufferInit) {
    super(init.idx, init.id, 'buffer', init.label, init.transferBatch, init.transferBatch)
    this.inbox = new Holder(init.capacity)
    this.initial = init.initial
    this.levelTw = new TimeWeighted(0, 0)
  }

  canAccept(n = 1): boolean {
    return this.inbox.canPut(n)
  }

  accept(e: Entity, eng: EngineApi): void {
    e.enteredAt = eng.t
    this.inbox.put(e, eng)
    this.levelTw.set(eng.t, this.inbox.level())
    if (eng.shouldTrace(e)) {
      eng.traceEvent(TraceKind.ArriveNode, this.idx, 0, e.id, this.inbox.level())
    }
    eng.wake(this.idx)
  }

  activate(eng: EngineApi): void {
    // Pasa de la cola al slot de salida mientras haya lugar, y descarga.
    while (this.outSlot.canPut(1) && this.inbox.level() > 0) {
      const e = this.inbox.take(eng)
      if (e === undefined) break
      this.outSlot.put(e, eng)
    }
    this.levelTw.set(eng.t, this.inbox.level())
    this.discharge(eng)
    if (this.outSlot.canPut(1) && this.inbox.level() > 0) eng.wake(this.idx)
    else if (this.inbox.level() === 0) this.inbox.waitConsume(this.idx)
  }

  protected onOwnEvent(_ev: SimEvent, _eng: EngineApi): void {
    /* el inventario no agenda eventos propios */
  }

  settleStats(t: SimTime): void {
    this.levelTw.set(t, this.inbox.level())
  }

  rebase(t: SimTime): void {
    this.levelTw.rebase(t)
  }

  avgLevel(t: SimTime): number {
    return this.levelTw.mean(t)
  }

  maxLevel(): number {
    return this.levelTw.max
  }

  serverStates(): StationStateId[] {
    return []
  }

  /** Mantiene una unidad en espera, sin pre-stockear. */
  override wantsMore(): boolean {
    return this.inbox.level() < 1
  }
}
