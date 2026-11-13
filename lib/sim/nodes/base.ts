/**
 * Base de los bloques que descargan material aguas abajo.
 *
 * Concentra tres cosas que si se duplican por nodo terminan divergiendo:
 *  - la regla del LOTE DE TRANSFERENCIA (retener hasta juntar N, soltar N)
 *  - el protocolo de bloqueo (retener la pieza, registrarse, esperar el wake)
 *  - el traslado por aristas con tiempo de movimiento
 */

import { EvKind, type SimEvent } from '../core/calendar'
import type { SimTime } from '../core/dist'
import type { Entity } from '../core/entity'
import { Holder } from '../core/holder'
import type { EngineApi, NodeRuntime } from '../core/runtime'
import { Stream } from '../core/rng'
import type { StationStateId, WaitReason } from '../types/results'
import { TraceKind } from '../types/trace'

export type RoutingRule = 'probability' | 'shortest-queue' | 'round-robin'

export interface InFlight {
  e: Entity
  dst: number
}

export abstract class DischargingNode implements NodeRuntime {
  readonly successors: number[] = []
  readonly predecessors: number[] = []
  /** Pesos normalizados por sucesor, si el ruteo es probabilistico. */
  weights: number[] = []
  routingRule: RoutingRule = 'shortest-queue'
  /** Tiempo de traslado en ms por sucesor, alineado con `successors`. */
  moveMs: number[] = []

  abstract readonly inbox: Holder | null

  /** Slot de salida: aca vive la regla del lote de transferencia. */
  readonly outSlot: Holder
  /** Unidades pendientes de soltar del lote actual. */
  protected releasing = 0
  /** Forzar descarga de lotes parciales (cierre de corrida o upstream seco). */
  protected flushing = false
  /** true si la descarga esta frenada porque aguas abajo no acepta. */
  protected blockedDownstream = false

  private readonly inFlight: Array<InFlight | null> = []
  private readonly freeSlots: number[] = []
  private inFlightCount = 0
  private rrCursor = 0

  constructor(
    readonly idx: number,
    readonly id: string,
    readonly type: string,
    readonly label: string,
    readonly transferBatch: number,
    outSlotCap: number,
  ) {
    this.outSlot = new Holder(outSlotCap)
  }

  // ------------------------------------------------------------------ interfaz

  abstract canAccept(n?: number): boolean
  abstract accept(e: Entity, eng: EngineApi): void
  abstract activate(eng: EngineApi): void
  abstract settleStats(t: SimTime): void
  abstract rebase(t: SimTime): void
  abstract serverStates(): StationStateId[]

  waitProduce(nodeIdx: number): void {
    this.inbox?.waitProduce(nodeIdx)
  }

  onEvent(ev: SimEvent, eng: EngineApi): void {
    if (ev.kind === EvKind.MoveEnd) {
      this.onMoveEnd(ev, eng)
      return
    }
    this.onOwnEvent(ev, eng)
  }

  protected abstract onOwnEvent(ev: SimEvent, eng: EngineApi): void

  setFlushing(on: boolean): void {
    this.flushing = on
  }

  heldCount(): number {
    return (this.inbox?.level() ?? 0) + this.outSlot.level() + this.inFlightCount + this.ownHeld()
  }

  protected ownHeld(): number {
    return 0
  }

  canStillProduce(): boolean {
    return this.heldCount() > 0
  }

  wantsMore(): boolean {
    return false
  }

  waitReason(): WaitReason | null {
    if (!this.blockedDownstream) return null
    return {
      nodeId: this.id,
      label: this.label,
      state: 'blocked',
      detail: 'No puede entregar: el bloque siguiente no acepta mas unidades.',
    }
  }

  // ----------------------------------------------------------------- descarga

  /**
   * Suelta el lote de transferencia si ya se junto.
   *
   * La regla es: retener hasta tener `transferBatch` unidades, y entonces
   * soltarlas TODAS en el mismo instante. De aca sale, sin ningun caso
   * especial, que la primera unidad de un lote de 10 espere a sus nueve
   * companeras en cada estacion - que es exactamente la demo de one-piece flow.
   */
  protected discharge(eng: EngineApi): void {
    for (;;) {
      if (this.releasing === 0) {
        const lvl = this.outSlot.level()
        if (lvl >= this.transferBatch) this.releasing = this.transferBatch
        else if (this.flushing && lvl > 0) this.releasing = lvl
        else {
          this.blockedDownstream = false
          return
        }
      }
      let moved = false
      while (this.releasing > 0 && this.outSlot.level() > 0) {
        const e = this.outSlot.peek()!
        const dstIdx = this.route(e, eng)
        if (dstIdx < 0) {
          this.blockedDownstream = true
          return
        }
        const dst = eng.nodes[dstIdx]!
        if (!dst.canAccept(1)) {
          dst.waitProduce(this.idx)
          this.blockedDownstream = true
          return
        }
        this.outSlot.take(eng)
        this.releasing--
        moved = true
        this.send(e, dstIdx, eng)
      }
      this.blockedDownstream = false
      if (!moved) return
    }
  }

  /** Entrega una unidad al destino, con o sin tiempo de traslado. */
  private send(e: Entity, dstIdx: number, eng: EngineApi): void {
    const si = this.successors.indexOf(dstIdx)
    const ms = si >= 0 ? (this.moveMs[si] ?? 0) : 0
    if (eng.shouldTrace(e)) {
      eng.traceEvent(TraceKind.DepartEdge, this.idx, dstIdx, e.id, Math.min(0xffff, ms))
    }
    if (ms <= 0) {
      eng.nodes[dstIdx]!.accept(e, eng)
      return
    }
    const slot = this.allocSlot({ e, dst: dstIdx })
    eng.schedule(ms, EvKind.MoveEnd, this.idx, slot)
  }

  private onMoveEnd(ev: SimEvent, eng: EngineApi): void {
    const f = this.inFlight[ev.payload]
    if (!f) return
    this.inFlight[ev.payload] = null
    this.freeSlots.push(ev.payload)
    this.inFlightCount--
    const dst = eng.nodes[f.dst]!
    if (dst.canAccept(1)) {
      dst.accept(f.e, eng)
      return
    }
    // El destino se lleno durante el traslado: la unidad vuelve al slot de
    // salida (cabe, porque salio de ahi) y la estacion queda bloqueada.
    this.outSlot.seed(f.e)
    this.releasing++
    dst.waitProduce(this.idx)
    this.blockedDownstream = true
    eng.wake(this.idx)
  }

  private allocSlot(f: InFlight): number {
    this.inFlightCount++
    const free = this.freeSlots.pop()
    if (free !== undefined) {
      this.inFlight[free] = f
      return free
    }
    this.inFlight.push(f)
    return this.inFlight.length - 1
  }

  // -------------------------------------------------------------------- ruteo

  /** Elige sucesor. Devuelve -1 si no hay ninguno. */
  protected route(_e: Entity, eng: EngineApi): number {
    const n = this.successors.length
    if (n === 0) return -1
    if (n === 1) return this.successors[0]!
    switch (this.routingRule) {
      case 'probability': {
        const u = eng.rng.u(this.idx, Stream.Routing)
        let acc = 0
        for (let i = 0; i < n; i++) {
          acc += this.weights[i] ?? 0
          if (u < acc) return this.successors[i]!
        }
        return this.successors[n - 1]!
      }
      case 'round-robin': {
        // Avanza hasta el primer sucesor que acepte, para no frenar la linea
        // entera por un destino lleno.
        for (let k = 0; k < n; k++) {
          const i = (this.rrCursor + k) % n
          const cand = this.successors[i]!
          if (eng.nodes[cand]!.canAccept(1)) {
            this.rrCursor = (i + 1) % n
            return cand
          }
        }
        return this.successors[this.rrCursor]!
      }
      default: {
        // Cola mas corta, con desempate por orden del modelo (nunca por el
        // orden de iteracion de una estructura).
        let best = this.successors[0]!
        let bestLvl = Number.POSITIVE_INFINITY
        for (let i = 0; i < n; i++) {
          const cand = eng.nodes[this.successors[i]!]!
          if (!cand.canAccept(1)) continue
          const lvl = cand.inbox?.level() ?? 0
          if (lvl < bestLvl) {
            bestLvl = lvl
            best = this.successors[i]!
          }
        }
        return best
      }
    }
  }
}
