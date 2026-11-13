/**
 * Motor DES.
 *
 * El corazon del diseno es un LOOP DE DOS NIVELES:
 *
 *   nivel externo  - eventos con tiempo (fin de servicio, falla, llegada)
 *   nivel interno  - settle(): drena una cola de activacion a punto fijo
 *                    DENTRO del mismo instante simulado
 *
 * Todos los handshakes, desbloqueos y autorizaciones pull ocurren en el nivel
 * interno. Un nodo que despierta a su vecino no agenda un "evento futuro de
 * delay cero": lo encola para re-evaluarse ya. Eso mantiene el heap chico, el
 * orden determinista y elimina el anti-patron de reintentar por polling.
 */

import { Calendar, EvKind, type SimEvent } from './calendar'
import { resetClampedSamples, type SimTime } from './dist'
import { EntityPool, type Entity } from './entity'
import { RngBank } from './rng'
import type { EngineApi, NodeRuntime } from './runtime'
import { ConwipPool } from '../control/conwip'
import { TraceRecorder } from '../trace/recorder'
import { TraceKind } from '../types/trace'
import { StopReason, type StopReasonId, type WaitReason } from '../types/results'

/** Tope de activaciones dentro de un mismo instante. */
const MAX_ACTIVATIONS_PER_TICK = 200_000

export class SimError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly nodeId?: string,
  ) {
    super(message)
    this.name = 'SimError'
  }
}

export const SliceOutcome = {
  Budget: 'budget',
  Finished: 'finished',
} as const

export type SliceOutcomeId = (typeof SliceOutcome)[keyof typeof SliceOutcome]

export interface EngineInit {
  nodes: NodeRuntime[]
  seed: number
  horizonMs: SimTime | null
  maxCompletions: number | null
  warmupMs: SimTime
  maxEvents: number
  conwipCap: number | null
  trace: TraceRecorder
  /** Callback del colector de estadisticas, invocado por el motor. */
  hooks: EngineHooks
}

export interface EngineHooks {
  onRelease(e: Entity, t: SimTime): void
  onComplete(e: Entity, t: SimTime): void
  onScrap(e: Entity, nodeIdx: number, t: SimTime): void
  onWip(t: SimTime, wip: number): void
  onWarmup(t: SimTime): void
}

export class Engine implements EngineApi {
  t: SimTime = 0
  readonly cal = new Calendar()
  readonly rng: RngBank
  readonly pool = new EntityPool()
  readonly nodes: NodeRuntime[]
  readonly trace: TraceRecorder
  readonly tokens: ConwipPool | null

  private readonly hooks: EngineHooks
  private readonly horizonMs: SimTime | null
  private readonly maxCompletions: number | null
  private readonly warmupMs: SimTime
  private readonly maxEvents: number

  measuring: boolean
  eventCount = 0
  completions = 0
  scrapped = 0
  released = 0
  wip = 0
  stopReason: StopReasonId = StopReason.NoMoreEvents
  truncated = false
  finished = false
  /** true si ya se forzo la descarga de lotes parciales. */
  private drained = false
  private started = false

  /** Cola de activacion: ring buffer de indices de nodo. */
  private readonly activation: Int32Array
  private actHead = 0
  private actTail = 0
  private readonly actMask: number
  /** Dedupe: evita que un nodo quede encolado dos veces a la vez. */
  private readonly dirty: Uint8Array
  private endRunEvent: SimEvent | null = null

  constructor(init: EngineInit) {
    this.nodes = init.nodes
    this.rng = new RngBank(init.seed, init.nodes.length)
    this.trace = init.trace
    this.hooks = init.hooks
    this.horizonMs = init.horizonMs
    this.maxCompletions = init.maxCompletions
    this.warmupMs = init.warmupMs
    this.maxEvents = init.maxEvents
    this.measuring = init.warmupMs <= 0
    this.tokens = init.conwipCap !== null ? new ConwipPool(init.conwipCap) : null

    // Ring buffer con capacidad potencia de dos, holgado respecto al grafo.
    let cap = 64
    while (cap < init.nodes.length * 8) cap <<= 1
    this.activation = new Int32Array(cap)
    this.actMask = cap - 1
    this.dirty = new Uint8Array(init.nodes.length)

    resetClampedSamples()

    if (init.warmupMs > 0) {
      this.cal.schedule(init.warmupMs, EvKind.WarmupReset, 0, 0)
    }
    if (init.horizonMs !== null) {
      this.endRunEvent = this.cal.schedule(init.horizonMs, EvKind.EndRun, 0, 0)
    }
  }

  // ---------------------------------------------------------------- activacion

  wake(nodeIdx: number): void {
    if (this.dirty[nodeIdx]) return
    this.dirty[nodeIdx] = 1
    this.activation[this.actTail & this.actMask] = nodeIdx
    this.actTail++
  }

  wakeAll(list: readonly number[]): void {
    for (let i = 0; i < list.length; i++) this.wake(list[i]!)
  }

  /**
   * Drena la cola de activacion a punto fijo.
   *
   * El tope duro existe porque esto PUEDE entrar en livelock: A despierta a B,
   * B despierta a A, ninguno progresa. Preferimos un error diagnosticable con
   * el nombre del nodo antes que una pestania congelada.
   */
  private settle(): void {
    let passes = 0
    while (this.actHead !== this.actTail) {
      const i = this.activation[this.actHead & this.actMask]!
      this.actHead++
      this.dirty[i] = 0
      this.nodes[i]!.activate(this)
      if (++passes > MAX_ACTIVATIONS_PER_TICK) {
        const n = this.nodes[i]!
        throw new SimError(
          'ZERO_DELAY_LOOP',
          `Bucle de delay cero detectado en "${n.label}" en t=${this.t}ms`,
          n.id,
        )
      }
    }
  }

  // ------------------------------------------------------------------- eventos

  schedule(delay: SimTime, kind: number, nodeIdx: number, payload: number): SimEvent {
    return this.cal.schedule(this.t + Math.max(0, delay), kind as never, nodeIdx, payload)
  }

  private dispatch(ev: SimEvent): void {
    switch (ev.kind) {
      case EvKind.WarmupReset:
        this.doWarmupReset()
        return
      case EvKind.EndRun:
        // El horizonte CIERRA la corrida. No se drena: dejar que las unidades
        // en proceso terminen despues del horizonte inflaria el throughput
        // contra una ventana de medicion que ya cerro. Lo que quedo a medio
        // hacer queda como inSystemAtEnd, que es lo honesto.
        this.finish(StopReason.Horizon)
        return
      default:
        this.nodes[ev.nodeIdx]!.onEvent(ev, this)
    }
  }

  private doWarmupReset(): void {
    // Las unidades que ya estan en la linea quedan fuera del lead time: su
    // tiempo de entrada es anterior a la ventana de medicion y sesgarian el
    // promedio hacia abajo (censura por izquierda).
    this.measuring = true
    this.completions = 0
    this.scrapped = 0
    this.released = 0
    for (const n of this.nodes) n.rebase(this.t)
    this.hooks.onWarmup(this.t)
  }

  /**
   * Cierre ordenado: se fuerza la descarga de lotes parciales para que el
   * inventario varado no distorsione las estadisticas finales, y se deja que
   * el sistema drene en el mismo instante.
   */
  private beginDrain(): void {
    for (const n of this.nodes) n.setFlushing(true)
    for (let i = 0; i < this.nodes.length; i++) this.wake(i)
  }

  // ------------------------------------------------------------------- CONWIP

  canAdmit(): boolean {
    return this.tokens === null || this.tokens.canTake()
  }

  waitForToken(nodeIdx: number): void {
    this.tokens?.wait(nodeIdx)
  }

  admit(e: Entity): void {
    if (this.tokens !== null) {
      if (!this.tokens.take()) {
        throw new SimError('TOKEN_OVERDRAW', 'Se admitio una unidad sin ficha CONWIP')
      }
      e.conwipToken = true
    }
    e.excludeFromLeadTime = !this.measuring
    e.traced =
      this.trace.level === 'full' && this.released < this.trace.entityCap && this.measuring
    this.released++
    this.wip++
    this.hooks.onRelease(e, this.t)
    this.hooks.onWip(this.t, this.wip)
    if (e.traced) this.trace.push(this.t, TraceKind.Spawn, 0, 0, e.id, 0)
  }

  /** Unico punto de liberacion de fichas. Alcanzable desde salida y scrap. */
  releaseToken(e: Entity): void {
    if (!e.conwipToken || this.tokens === null) return
    e.conwipToken = false
    const woken = this.tokens.release()
    this.wakeAll(woken)
  }

  complete(e: Entity): void {
    this.releaseToken(e)
    this.completions++
    this.wip--
    this.hooks.onComplete(e, this.t)
    this.hooks.onWip(this.t, this.wip)
    if (e.traced) this.trace.push(this.t, TraceKind.Exit, 0, 0, e.id, 0)
    this.pool.release(e)
  }

  scrap(e: Entity, nodeIdx: number): void {
    this.releaseToken(e)
    this.scrapped++
    this.wip--
    this.hooks.onScrap(e, nodeIdx, this.t)
    this.hooks.onWip(this.t, this.wip)
    if (e.traced) this.trace.push(this.t, TraceKind.Scrap, nodeIdx, 0, e.id, 0)
    this.pool.release(e)
  }

  onWipChange(delta: number): void {
    this.wip += delta
    this.hooks.onWip(this.t, this.wip)
  }

  // -------------------------------------------------------------------- traza

  shouldTrace(e: Entity): boolean {
    return e.traced
  }

  traceEvent(
    kind: number,
    nodeIdx: number,
    node2: number,
    entityId: number,
    aux: number,
  ): void {
    this.trace.push(this.t, kind, nodeIdx, node2, entityId, aux)
  }

  // --------------------------------------------------------------------- loop

  private stopCondition(): StopReasonId | null {
    if (this.maxCompletions !== null && this.completions >= this.maxCompletions) {
      return StopReason.Completions
    }
    if (this.eventCount >= this.maxEvents) return StopReason.EventBudget
    return null
  }

  /**
   * Corre como mucho `budget` eventos. Devolver Budget significa que queda
   * trabajo: el worker aprovecha para ceder el event loop y atender un cancel.
   */
  runSlice(budget: number): SliceOutcomeId {
    if (this.finished) return SliceOutcome.Finished
    // Primer drenaje: los nodos se despiertan al construir el grafo, pero
    // settle() solo corre despues de un evento. Una entrada 'unlimited' no
    // agenda ningun evento inicial, asi que sin esto el modelo arranca con la
    // cola de activacion llena y el calendario vacio: cero unidades.
    if (!this.started) {
      this.started = true
      this.settle()
    }
    let n = 0
    while (n < budget) {
      const ev = this.cal.pop()
      if (ev === undefined) {
        // El calendario se vacio. Antes de llamarlo deadlock hay que descartar
        // el caso benigno: un LOTE DE TRANSFERENCIA PARCIAL varado porque
        // aguas arriba ya no queda nada. Sin esta purga, una corrida con lote
        // de 10 y una entrada finita termina siempre "colgada" con 7 unidades
        // retenidas, y reportariamos un deadlock que no existe.
        if (!this.drained && this.heldUnits() > 0) {
          this.drained = true
          this.beginDrain()
          this.settle()
          if (this.cal.size > 0) continue
        }
        this.finish(this.heldUnits() > 0 ? StopReason.Deadlock : StopReason.NoMoreEvents)
        return SliceOutcome.Finished
      }
      n++
      this.eventCount++
      this.t = ev.time
      this.dispatch(ev)
      if (this.finished) return SliceOutcome.Finished
      this.settle()
      const stop = this.stopCondition()
      if (stop !== null) {
        this.truncated = stop === StopReason.EventBudget
        this.finish(stop)
        return SliceOutcome.Finished
      }
    }
    return SliceOutcome.Budget
  }

  /** Corre hasta el final sin ceder. Para tests y corridas cortas. */
  runToCompletion(): void {
    while (this.runSlice(1_000_000) === SliceOutcome.Budget) {
      /* sigue */
    }
  }

  private finish(reason: StopReasonId): void {
    if (this.finished) return
    this.finished = true
    this.stopReason = reason
    this.cal.cancel(this.endRunEvent)
    for (const n of this.nodes) n.settleStats(this.t)
    this.hooks.onWip(this.t, this.wip)
  }

  /** Unidades retenidas por los bloques (para conservacion y deadlock). */
  heldUnits(): number {
    let total = 0
    for (const n of this.nodes) total += n.heldCount()
    return total
  }

  waitReasons(): WaitReason[] {
    const out: WaitReason[] = []
    for (const n of this.nodes) {
      const r = n.waitReason()
      if (r !== null) out.push(r)
    }
    return out
  }
}
