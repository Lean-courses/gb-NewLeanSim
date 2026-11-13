/**
 * Inspeccion: control de calidad con descarte o bucle de retrabajo.
 *
 * Usa un stream de aleatoriedad PROPIO (Quality). Eso importa: si compartiera
 * el stream de servicio, cambiar la variabilidad de los tiempos de ciclo
 * reordenaria que unidades fallan, y la comparacion As-Is / To-Be dejaria de
 * ser limpia.
 *
 * TRAMPA: una unidad retrabajada CONSERVA su ficha CONWIP (nunca salio de la
 * linea). Una descartada la devuelve en el acto. Las dos cosas pasan por el
 * releaseToken() unico del motor.
 */

import { EvKind, type SimEvent } from '../core/calendar'
import { bernoulli, type Dist, type SimTime } from '../core/dist'
import type { Entity } from '../core/entity'
import { Holder } from '../core/holder'
import { Stream } from '../core/rng'
import type { EngineApi } from '../core/runtime'
import { TimeWeighted } from '../stats/accumulators'
import { N_STATES, StationState, type StationStateId } from '../types/results'
import { TraceKind } from '../types/trace'
import { DischargingNode } from './base'

export interface InspectionInit {
  idx: number
  id: string
  label: string
  transferBatch: number
  queueCap: number
  kanbanCards: number
  yieldRate: number
  inspectDist: Dist
  onFail: 'scrap' | 'rework'
  /** Indice del nodo destino del retrabajo. -1 = descartar. */
  reworkTarget: number
  maxRework: number
}

export class InspectionNode extends DischargingNode {
  readonly inbox: Holder
  private readonly yieldRate: number
  private readonly inspectDist: Dist
  private readonly onFail: 'scrap' | 'rework'
  /** Mutable: compile() lo resuelve recien cuando todos los nodos tienen indice. */
  reworkTarget: number
  private readonly maxRework: number
  private readonly kanbanCards: number

  /** Salida separada para el retrabajo: no participa del lote de transferencia. */
  private readonly reworkOut: Holder

  private state: StationStateId = StationState.Starved
  private since: SimTime = 0
  private readonly stateTime = new Float64Array(N_STATES)
  private current: Entity | null = null

  passed = 0
  failed = 0
  reworked = 0
  scrappedCount = 0
  private readonly queueTw: TimeWeighted

  constructor(init: InspectionInit) {
    super(init.idx, init.id, 'inspection', init.label, init.transferBatch, init.transferBatch)
    this.inbox = new Holder(init.queueCap)
    this.reworkOut = new Holder(1)
    this.yieldRate = init.yieldRate
    this.inspectDist = init.inspectDist
    this.onFail = init.onFail
    this.reworkTarget = init.reworkTarget
    this.maxRework = init.maxRework
    this.kanbanCards = init.kanbanCards
    this.queueTw = new TimeWeighted(0, 0)
  }

  private stageWip(): number {
    return this.inbox.level() + this.outSlot.level() + this.reworkOut.level() + (this.current ? 1 : 0)
  }

  canAccept(n = 1): boolean {
    if (!this.inbox.canPut(n)) return false
    return this.stageWip() + n <= this.kanbanCards
  }

  accept(e: Entity, eng: EngineApi): void {
    e.enteredAt = eng.t
    this.inbox.put(e, eng)
    this.queueTw.set(eng.t, this.inbox.level())
    if (eng.shouldTrace(e)) {
      eng.traceEvent(TraceKind.ArriveNode, this.idx, 0, e.id, this.inbox.level())
    }
    eng.wake(this.idx)
  }


  /**
   * Con kanban, canAccept() depende del WIP de TODA la etapa, no solo de la
   * cola de entrada. Pero el despertar por defecto esta atado a Holder.take()
   * de la cola. Resultado: cuando la etapa libera lugar al DESCARGAR hacia
   * aguas abajo, el productor que habia quedado esperando no se entera nunca y
   * la linea se duerme con una sola unidad. Por eso la espera se registra a
   * nivel de etapa y se notifica al final de cada activate().
   */
  private readonly stageWaiters: number[] = []

  override waitProduce(nodeIdx: number): void {
    if (!this.stageWaiters.includes(nodeIdx)) this.stageWaiters.push(nodeIdx)
  }

  private notifyAcceptable(eng: EngineApi): void {
    if (this.stageWaiters.length === 0 || !this.canAccept(1)) return
    const woken = this.stageWaiters.slice()
    this.stageWaiters.length = 0
    for (const i of woken) eng.wake(i)
  }

  activate(eng: EngineApi): void {
    this.sendRework(eng)
    this.discharge(eng)
    this.notifyAcceptable(eng)
    if (this.current !== null) return
    if (this.reworkOut.level() > 0) return
    if (!this.outSlot.canPut(1)) {
      this.setState(StationState.Blocked, eng.t)
      this.outSlot.waitProduce(this.idx)
      return
    }
    const e = this.inbox.take(eng)
    if (e === undefined) {
      this.setState(StationState.Starved, eng.t)
      this.inbox.waitConsume(this.idx)
      return
    }
    this.notifyAcceptable(eng)
    this.queueTw.set(eng.t, this.inbox.level())
    this.current = e
    this.setState(StationState.Busy, eng.t)
    eng.schedule(
      this.inspectDist.sample(eng.rng, this.idx, Stream.Service),
      EvKind.ServiceEnd,
      this.idx,
      0,
    )
  }

  protected onOwnEvent(ev: SimEvent, eng: EngineApi): void {
    if (ev.kind !== EvKind.ServiceEnd) return
    const e = this.current
    this.current = null
    if (e === null) return

    const ok = bernoulli(eng.rng, this.idx, Stream.Quality, this.yieldRate)
    if (ok) {
      this.passed++
      e.enteredAt = eng.t
      this.outSlot.put(e, eng)
    } else {
      this.failed++
      const canRework =
        this.onFail === 'rework' && this.reworkTarget >= 0 && e.reworkCount < this.maxRework
      if (canRework) {
        e.reworkCount++
        this.reworked++
        if (eng.shouldTrace(e)) {
          eng.traceEvent(TraceKind.Rework, this.idx, this.reworkTarget, e.id, e.reworkCount)
        }
        this.reworkOut.put(e, eng)
      } else {
        this.scrappedCount++
        eng.scrap(e, this.idx)
      }
    }
    this.setState(StationState.Starved, eng.t)
    eng.wake(this.idx)
  }

  /** Entrega al destino de retrabajo, con el mismo protocolo de bloqueo. */
  private sendRework(eng: EngineApi): void {
    while (this.reworkOut.level() > 0) {
      if (this.reworkTarget < 0) return
      const dst = eng.nodes[this.reworkTarget]!
      if (!dst.canAccept(1)) {
        dst.waitProduce(this.idx)
        this.setState(StationState.Blocked, eng.t)
        return
      }
      const e = this.reworkOut.take(eng)
      if (e === undefined) return
      dst.accept(e, eng)
    }
  }

  private setState(next: StationStateId, t: SimTime): void {
    if (this.state === next) return
    this.stateTime[this.state]! += t - this.since
    this.state = next
    this.since = t
  }

  settleStats(t: SimTime): void {
    this.stateTime[this.state]! += t - this.since
    this.since = t
    this.queueTw.set(t, this.inbox.level())
  }

  rebase(t: SimTime): void {
    this.settleStats(t)
    this.stateTime.fill(0)
    this.queueTw.rebase(t)
    this.passed = 0
    this.failed = 0
    this.reworked = 0
    this.scrappedCount = 0
  }

  stateTimes(): Float64Array {
    return this.stateTime
  }

  avgQueue(t: SimTime): number {
    return this.queueTw.mean(t)
  }

  maxQueue(): number {
    return this.queueTw.max
  }

  serverStates(): StationStateId[] {
    return [this.state]
  }

  protected override ownHeld(): number {
    return (this.current !== null ? 1 : 0) + this.reworkOut.level()
  }

  override wantsMore(): boolean {
    return this.inbox.level() < 1
  }
}
