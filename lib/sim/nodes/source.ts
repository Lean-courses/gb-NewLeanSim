/**
 * Entrada: genera las unidades que entran a la linea.
 *
 * Tres modos. `unlimited` ("la materia prima siempre esta") es el que se fuerza
 * en modo pull, y no es un detalle: con una entrada a intervalo fijo y un tope
 * de WIP ajustado, la ENTRADA pasa a ser la restriccion, el cuello de botella
 * real queda hambriento y la demo de pull no muestra absolutamente nada.
 */

import { EvKind, type SimEvent } from '../core/calendar'
import type { Dist, SimTime } from '../core/dist'
import type { Entity } from '../core/entity'
import type { Holder } from '../core/holder'
import { Stream } from '../core/rng'
import type { EngineApi } from '../core/runtime'
import { SimError } from '../core/engine'
import type { SourceMode } from '../types/model'
import type { StationStateId, WaitReason } from '../types/results'
import { DischargingNode } from './base'

/** Tope de liberaciones dentro de un mismo instante, como red de seguridad. */
const MAX_RELEASES_PER_TICK = 100_000

export interface SourceInit {
  idx: number
  id: string
  label: string
  mode: SourceMode
  arrivalDist: Dist
  maxUnits: number | null
  unsatisfiedDemand: 'backlog' | 'lost'
}

export class SourceNode extends DischargingNode {
  readonly inbox: Holder | null = null
  private readonly mode: SourceMode
  private readonly arrivalDist: Dist
  private readonly maxUnits: number | null
  private readonly unsatisfied: 'backlog' | 'lost'

  released = 0
  /** Demanda que llego y no se pudo admitir. */
  backlog = 0
  lost = 0
  private exhausted = false
  private waitingForToken = false

  constructor(init: SourceInit) {
    // La entrada no agrupa: el lote de transferencia es un fenomeno ENTRE
    // estaciones. Agruparlo tambien aca confundiria la lectura de la demo.
    super(init.idx, init.id, 'source', init.label, 1, 1)
    this.mode = init.mode
    this.arrivalDist = init.arrivalDist
    this.maxUnits = init.maxUnits
    this.unsatisfied = init.unsatisfiedDemand
  }

  /** Agenda la primera llegada. Llamado por compile tras construir el grafo. */
  start(eng: EngineApi): void {
    if (this.mode === 'unlimited') {
      eng.wake(this.idx)
      return
    }
    eng.schedule(
      this.arrivalDist.sample(eng.rng, this.idx, Stream.Interarrival),
      EvKind.SourceRelease,
      this.idx,
      0,
    )
  }

  canAccept(): boolean {
    return false
  }

  accept(): void {
    throw new SimError('SOURCE_RECEIVES', `La entrada "${this.label}" no puede recibir material`)
  }

  protected onOwnEvent(ev: SimEvent, eng: EngineApi): void {
    if (ev.kind !== EvKind.SourceRelease) return
    // Se reagenda SIEMPRE, se haya podido admitir o no: la demanda del cliente
    // no se detiene porque la planta este llena.
    if (!this.capReached()) {
      eng.schedule(
        this.arrivalDist.sample(eng.rng, this.idx, Stream.Interarrival),
        EvKind.SourceRelease,
        this.idx,
        0,
      )
    }
    if (!this.tryRelease(eng)) {
      if (this.unsatisfied === 'backlog') this.backlog++
      else this.lost++
    }
    eng.wake(this.idx)
  }

  activate(eng: EngineApi): void {
    this.discharge(eng)
    if (this.mode === 'unlimited') {
      let n = 0
      // "La materia prima siempre esta" NO significa volcar inventario
      // infinito: significa que la estacion siguiente nunca se queda sin
      // trabajo. Por eso se repone solo mientras el sucesor pide mas. Sin esta
      // compuerta, una entrada ilimitada con buffers infinitos libera unidades
      // sin freno en el instante cero.
      while (this.outSlot.level() === 0 && !this.capReached()) {
        if (!this.successorWantsMore(eng)) {
          // Nadie necesita material ahora. Hay que REGISTRARSE para que nos
          // despierten cuando la estacion siguiente consuma: sin esto la
          // entrada se duerme para siempre tras la primera unidad y la linea
          // entrega cero.
          this.registerWithSuccessors(eng)
          break
        }
        if (!this.tryRelease(eng)) break
        this.discharge(eng)
        if (++n > MAX_RELEASES_PER_TICK) {
          throw new SimError(
            'SOURCE_RUNAWAY',
            `La entrada "${this.label}" libera sin freno: en modo push no puede ser ilimitada.`,
            this.id,
          )
        }
      }
      return
    }
    // Modo con reloj propio: se reintenta el backlog acumulado.
    while (this.backlog > 0 && this.outSlot.level() === 0) {
      if (!this.tryRelease(eng)) {
        this.registerWithSuccessors(eng)
        break
      }
      this.backlog--
      this.discharge(eng)
    }
  }

  /** Pide ser despertada cuando algun sucesor libere espacio o consuma. */
  private registerWithSuccessors(eng: EngineApi): void {
    for (const si of this.successors) eng.nodes[si]!.waitProduce(this.idx)
  }

  /** true si algun sucesor necesita otra unidad para no quedarse parado. */
  private successorWantsMore(eng: EngineApi): boolean {
    for (const si of this.successors) {
      const dst = eng.nodes[si]!
      if (dst.canAccept(1) && dst.wantsMore()) return true
    }
    return false
  }

  private capReached(): boolean {
    if (this.maxUnits === null) return false
    if (this.released >= this.maxUnits) {
      this.exhausted = true
      return true
    }
    return false
  }

  /** Intenta admitir y colocar una unidad. false = no habia ficha o lugar. */
  private tryRelease(eng: EngineApi): boolean {
    if (this.capReached()) return false
    if (!this.outSlot.canPut(1)) return false
    if (!eng.canAdmit()) {
      eng.waitForToken(this.idx)
      this.waitingForToken = true
      return false
    }
    this.waitingForToken = false
    const e = eng.pool.acquire(eng.t)
    eng.admit(e)
    this.released++
    this.outSlot.put(e, eng)
    return true
  }

  settleStats(_t: SimTime): void {
    /* la entrada no acumula tiempos de estado */
  }

  rebase(_t: SimTime): void {
    this.released = 0
    this.backlog = 0
    this.lost = 0
  }

  serverStates(): StationStateId[] {
    return []
  }

  override canStillProduce(): boolean {
    if (this.heldCount() > 0) return true
    if (this.mode === 'unlimited') return !this.exhausted
    return !this.capReached()
  }

  override waitReason(): WaitReason | null {
    const base = super.waitReason()
    if (base !== null) return base
    if (this.waitingForToken) {
      return {
        nodeId: this.id,
        label: this.label,
        state: 'blocked',
        detail: 'Sin fichas CONWIP disponibles: no puede liberar mas unidades a la linea.',
      }
    }
    return null
  }

  /** Solo para el tipado estructural. */
  declare readonly _entityBrand?: Entity
}
