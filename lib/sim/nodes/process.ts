/**
 * Estacion de trabajo. El bloque donde vive el data box de VSM y, de lejos,
 * donde se concentra la complejidad del motor.
 *
 * Maquina de estados por servidor: Starved / Setup / Busy / Blocked / WaitOp /
 * Down. Son mutuamente excluyentes y exhaustivos, asi que la suma de tiempos
 * de estado es exactamente la ventana de medicion - y ese desglose es el
 * entregable de diagnostico: "tu estacion 2 esta 31% bloqueada y 12% esperando
 * operario" es mucho mas accionable que un porcentaje de utilizacion.
 */

import { EvKind, type SimEvent } from '../core/calendar'
import { bernoulli, exponential, type Dist, type SimTime } from '../core/dist'
import type { Entity } from '../core/entity'
import { Holder } from '../core/holder'
import { Stream } from '../core/rng'
import type { EngineApi } from '../core/runtime'
import { TimeWeighted, Welford } from '../stats/accumulators'
import { N_STATES, StationState, type StationStateId, type WaitReason } from '../types/results'
import { TraceKind } from '../types/trace'
import { DischargingNode } from './base'
import type { OperatorNode } from './operators'

interface Server {
  state: StationStateId
  since: SimTime
  stateTime: Float64Array
  /** Unidades en el lote de proceso actual. */
  wip: Entity[]
  endEv: SimEvent | null
  failEv: SimEvent | null
  /** Servicio que falta cuando una falla interrumpe el ciclo. */
  remaining: SimTime
  /** Instante en que arranco el segmento de operacion actual. */
  segmentStart: SimTime
  /** Tiempo de OPERACION que falta hasta la proxima falla. */
  timeToFailure: SimTime
  opsHeld: number
}

export interface ProcessInit {
  idx: number
  id: string
  label: string
  transferBatch: number
  processBatch: number
  batchMode: 'sequential' | 'simultaneous'
  servers: number
  queueCap: number
  kanbanCards: number
  scrapRate: number
  operators: number
  serviceDist: Dist
  setupDist: Dist
  /** null = sin paradas (disponibilidad 1). */
  mtbfDist: Dist | null
  repairDist: Dist
}

export class ProcessNode extends DischargingNode {
  readonly inbox: Holder
  private readonly servers: Server[]
  private readonly processBatch: number
  private readonly batchMode: 'sequential' | 'simultaneous'
  private readonly kanbanCards: number
  private readonly scrapRate: number
  private readonly operatorsNeeded: number
  private readonly serviceDist: Dist
  private readonly setupDist: Dist
  private readonly mtbfDist: Dist | null
  private readonly repairDist: Dist

  /** Capacidad del slot de salida ya comprometida por lotes en curso. */
  private outReserved = 0

  opPool: OperatorNode | null = null

  // --- estadisticas ---
  private readonly queueTw: TimeWeighted
  private readonly queueWait = new Welford()
  processed = 0
  scrappedCount = 0
  failures = 0
  private readonly stageTw: TimeWeighted
  private statsT0: SimTime = 0

  constructor(init: ProcessInit) {
    // Dimensionado del slot de salida. Dos requisitos distintos:
    //
    //  1. Tiene que poder SOBREPASAR el lote de transferencia. Con lote de
    //     proceso 3 y de transferencia 10 nunca se llega a exactamente 10
    //     (9 -> 12), asi que un tope de 10 trabaria la estacion para siempre.
    //  2. Tiene que alcanzar para TODAS las maquinas en paralelo a la vez.
    //     Cada servidor reserva su lote antes de arrancar; si el slot solo
    //     entra un lote, la segunda maquina queda bloqueada permanentemente y
    //     la estacion entrega la mitad de su capacidad sin que nada avise.
    super(
      init.idx,
      init.id,
      'process',
      init.label,
      init.transferBatch,
      init.transferBatch + init.servers * init.processBatch - 1,
    )
    this.inbox = new Holder(init.queueCap)
    this.processBatch = init.processBatch
    this.batchMode = init.batchMode
    this.kanbanCards = init.kanbanCards
    this.scrapRate = init.scrapRate
    this.operatorsNeeded = init.operators
    this.serviceDist = init.serviceDist
    this.setupDist = init.setupDist
    this.mtbfDist = init.mtbfDist
    this.repairDist = init.repairDist

    this.servers = []
    for (let i = 0; i < init.servers; i++) {
      this.servers.push({
        state: StationState.Starved,
        since: 0,
        stateTime: new Float64Array(N_STATES),
        wip: [],
        endEv: null,
        failEv: null,
        remaining: 0,
        segmentStart: 0,
        timeToFailure: Number.POSITIVE_INFINITY,
        opsHeld: 0,
      })
    }
    this.queueTw = new TimeWeighted(0, 0)
    this.stageTw = new TimeWeighted(0, 0)
  }

  // ------------------------------------------------------------------ entrada

  private stageWip(): number {
    let w = this.inbox.level() + this.outSlot.level()
    for (const s of this.servers) w += s.wip.length
    return w
  }

  /**
   * Aca vive la compuerta kanban. Ponerla del lado del RECEPTOR es lo correcto:
   * una etapa solo jala mientras su WIP total esta por debajo del tope, y el
   * bloqueo se propaga solo hacia arriba.
   */
  canAccept(n = 1): boolean {
    if (!this.inbox.canPut(n)) return false
    return this.stageWip() + n <= this.kanbanCards
  }

  accept(e: Entity, eng: EngineApi): void {
    e.enteredAt = eng.t
    this.inbox.put(e, eng)
    this.queueTw.set(eng.t, this.inbox.level())
    this.stageTw.set(eng.t, this.stageWip())
    if (eng.shouldTrace(e)) {
      eng.traceEvent(TraceKind.ArriveNode, this.idx, 0, e.id, this.inbox.level())
      eng.traceEvent(TraceKind.EnterQueue, this.idx, 0, e.id, this.inbox.level())
    }
    eng.wake(this.idx)
  }

  // ---------------------------------------------------------------- activacion


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
    this.discharge(eng)
    this.tryStart(eng)
    this.stageTw.set(eng.t, this.stageWip())
    this.notifyAcceptable(eng)
  }

  private tryStart(eng: EngineApi): void {
    for (let i = 0; i < this.servers.length; i++) {
      const s = this.servers[i]!
      if (
        s.state === StationState.Busy ||
        s.state === StationState.Setup ||
        s.state === StationState.Down
      ) {
        continue
      }

      // Hay que tener lugar para el resultado antes de empezar, o dos
      // servidores que terminan juntos desbordan el slot de salida.
      if (this.outSlot.level() + this.outReserved + this.processBatch > this.outSlot.cap) {
        this.setState(s, StationState.Blocked, eng.t)
        this.outSlot.waitProduce(this.idx)
        continue
      }

      const avail = this.inbox.level()
      let take = this.processBatch
      if (avail < this.processBatch) {
        // Lote de proceso incompleto: solo se arranca si estamos drenando.
        if (this.flushing && avail > 0) {
          take = avail
        } else {
          this.setState(s, StationState.Starved, eng.t)
          this.inbox.waitConsume(this.idx)
          continue
        }
      }

      if (this.operatorsNeeded > 0 && this.opPool !== null) {
        if (!this.opPool.trySeize(this.operatorsNeeded)) {
          this.setState(s, StationState.WaitOp, eng.t)
          this.opPool.enqueue(this.idx)
          continue
        }
        s.opsHeld = this.operatorsNeeded
      }

      s.wip = []
      for (let k = 0; k < take; k++) {
        const e = this.inbox.take(eng)
        if (e === undefined) break
        this.queueWait.push(eng.t - e.enteredAt)
        s.wip.push(e)
      }
      this.queueTw.set(eng.t, this.inbox.level())
      this.outReserved += s.wip.length

      if (this.setupDist.mean > 0) {
        this.setState(s, StationState.Setup, eng.t)
        s.endEv = eng.schedule(
          this.setupDist.sample(eng.rng, this.idx, Stream.Setup),
          EvKind.SetupEnd,
          this.idx,
          i,
        )
      } else {
        this.beginService(s, i, eng)
      }
    }
  }

  // -------------------------------------------------------------------- ciclo

  private sampleService(eng: EngineApi, units: number): SimTime {
    if (this.batchMode === 'simultaneous') {
      // Horno/autoclave: el tiempo es del lote, no de la unidad.
      return this.serviceDist.sample(eng.rng, this.idx, Stream.Service)
    }
    // Linea: n muestras independientes. Que sean independientes importa - es
    // lo que hace que el CV del lote escale como CV/sqrt(n), igual que en la
    // realidad, en vez de amplificar la variabilidad.
    let total = 0
    for (let k = 0; k < units; k++) {
      total += this.serviceDist.sample(eng.rng, this.idx, Stream.Service)
    }
    return total
  }

  private beginService(s: Server, i: number, eng: EngineApi): void {
    s.remaining = this.sampleService(eng, s.wip.length)
    if (this.mtbfDist !== null && !Number.isFinite(s.timeToFailure)) {
      s.timeToFailure = this.mtbfDist.sample(eng.rng, this.idx, Stream.Downtime)
    }
    for (const e of s.wip) {
      if (eng.shouldTrace(e)) {
        eng.traceEvent(TraceKind.StartService, this.idx, 0, e.id, 0)
      }
    }
    this.beginSegment(s, i, eng)
  }

  /**
   * Arranca (o reanuda) un segmento de operacion.
   *
   * Las fallas se cuentan sobre TIEMPO DE OPERACION, no de calendario, que es
   * como se define la disponibilidad en OEE. Si la proxima falla cae dentro de
   * este servicio, se agenda la falla en vez del fin de servicio.
   */
  private beginSegment(s: Server, i: number, eng: EngineApi): void {
    this.setState(s, StationState.Busy, eng.t)
    s.segmentStart = eng.t
    if (this.mtbfDist !== null && s.timeToFailure <= s.remaining) {
      s.failEv = eng.schedule(s.timeToFailure, EvKind.Failure, this.idx, i)
      s.endEv = null
    } else {
      s.endEv = eng.schedule(s.remaining, EvKind.ServiceEnd, this.idx, i)
      s.failEv = null
    }
  }

  protected onOwnEvent(ev: SimEvent, eng: EngineApi): void {
    const i = ev.payload
    const s = this.servers[i]
    if (s === undefined) return
    switch (ev.kind) {
      case EvKind.SetupEnd:
        s.endEv = null
        this.beginService(s, i, eng)
        return
      case EvKind.Failure:
        this.onFailure(s, i, eng)
        return
      case EvKind.RepairEnd:
        this.beginSegment(s, i, eng)
        return
      case EvKind.ServiceEnd:
        this.onServiceEnd(s, i, eng)
        return
      default:
        return
    }
  }

  /** La estacion se rompe en mitad del ciclo: se guarda lo que falta y se repara. */
  private onFailure(s: Server, i: number, eng: EngineApi): void {
    const operated = eng.t - s.segmentStart
    s.remaining = Math.max(0, s.remaining - operated)
    s.failEv = null
    eng.cal.cancel(s.endEv)
    s.endEv = null
    this.failures++
    // Nueva vida util tras la reparacion.
    s.timeToFailure =
      this.mtbfDist !== null
        ? this.mtbfDist.sample(eng.rng, this.idx, Stream.Downtime)
        : Number.POSITIVE_INFINITY
    this.setState(s, StationState.Down, eng.t)
    eng.schedule(
      this.repairDist.sample(eng.rng, this.idx, Stream.Downtime),
      EvKind.RepairEnd,
      this.idx,
      i,
    )
  }

  private onServiceEnd(s: Server, i: number, eng: EngineApi): void {
    s.endEv = null
    const operated = eng.t - s.segmentStart
    if (Number.isFinite(s.timeToFailure)) s.timeToFailure -= operated
    s.remaining = 0

    const batch = s.wip
    s.wip = []
    this.outReserved -= batch.length

    for (const e of batch) {
      if (eng.shouldTrace(e)) eng.traceEvent(TraceKind.EndService, this.idx, 0, e.id, 0)
      if (this.scrapRate > 0 && bernoulli(eng.rng, this.idx, Stream.Quality, this.scrapRate)) {
        this.scrappedCount++
        eng.scrap(e, this.idx)
        continue
      }
      this.processed++
      e.enteredAt = eng.t
      this.outSlot.put(e, eng)
    }

    if (s.opsHeld > 0 && this.opPool !== null) {
      this.opPool.release(s.opsHeld, eng)
      s.opsHeld = 0
    }

    this.setState(s, StationState.Starved, eng.t)
    eng.wake(this.idx)
  }

  // ---------------------------------------------------------------- estadistica

  private setState(s: Server, next: StationStateId, t: SimTime): void {
    if (s.state === next) return
    s.stateTime[s.state]! += t - s.since
    s.state = next
    s.since = t
  }

  settleStats(t: SimTime): void {
    for (const s of this.servers) {
      s.stateTime[s.state]! += t - s.since
      s.since = t
    }
    this.queueTw.set(t, this.inbox.level())
    this.stageTw.set(t, this.stageWip())
  }

  rebase(t: SimTime): void {
    this.settleStats(t)
    for (const s of this.servers) s.stateTime.fill(0)
    this.queueTw.rebase(t)
    this.stageTw.rebase(t)
    this.queueWait.reset()
    this.processed = 0
    this.scrappedCount = 0
    this.failures = 0
    this.statsT0 = t
  }

  serverStates(): StationStateId[] {
    return this.servers.map((s) => s.state)
  }

  /** Tiempos de estado promediados sobre los servidores, en ms. */
  stateTimes(): Float64Array {
    const out = new Float64Array(N_STATES)
    for (const s of this.servers) {
      for (let k = 0; k < N_STATES; k++) out[k]! += s.stateTime[k]!
    }
    for (let k = 0; k < N_STATES; k++) out[k]! /= this.servers.length
    return out
  }

  avgQueue(t: SimTime): number {
    return this.queueTw.mean(t)
  }

  maxQueue(): number {
    return this.queueTw.max
  }

  avgStageWip(t: SimTime): number {
    return this.stageTw.mean(t)
  }

  avgQueueWait(): number {
    return this.queueWait.n > 0 ? this.queueWait.mean : 0
  }

  statsStart(): SimTime {
    return this.statsT0
  }

  protected override ownHeld(): number {
    let n = 0
    for (const s of this.servers) n += s.wip.length
    return n
  }

  override canStillProduce(): boolean {
    return this.heldCount() > 0
  }

  /** Quiere mas mientras no tenga un lote completo por servidor esperando. */
  override wantsMore(): boolean {
    return this.inbox.level() < this.processBatch * this.servers.length
  }

  override waitReason(): WaitReason | null {
    const base = super.waitReason()
    if (base !== null) return base
    const s = this.servers[0]!
    if (s.state === StationState.Blocked) {
      return {
        nodeId: this.id,
        label: this.label,
        state: 'blocked',
        detail: 'El slot de salida esta lleno y no puede entregar aguas abajo.',
      }
    }
    if (s.state === StationState.Starved && this.inbox.level() > 0) {
      return {
        nodeId: this.id,
        label: this.label,
        state: 'starved',
        detail: `Tiene ${this.inbox.level()} unidades en cola pero no completa el lote de proceso de ${this.processBatch}.`,
      }
    }
    if (s.state === StationState.WaitOp) {
      return {
        nodeId: this.id,
        label: this.label,
        state: 'waitOp',
        detail: 'Esperando operarios disponibles.',
      }
    }
    return null
  }
}
