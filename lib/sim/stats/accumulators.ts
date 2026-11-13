/**
 * Acumuladores. Todo lo que es un nivel a lo largo del tiempo (WIP, largo de
 * cola, cantidad de servidores ocupados) se acumula PONDERADO POR TIEMPO:
 * sum(valor * dt) / ventana. Promediar muestras en vez de integrar es el error
 * clasico que infla o desinfla la utilizacion sin que se note.
 */

import type { SimTime } from '../core/dist'

export class TimeWeighted {
  private lastT: SimTime = 0
  private v = 0
  private t0: SimTime = 0
  area = 0
  max = 0

  constructor(initial = 0, t0: SimTime = 0) {
    this.v = initial
    this.max = initial
    this.lastT = t0
    this.t0 = t0
  }

  get value(): number {
    return this.v
  }

  set(t: SimTime, value: number): void {
    this.area += this.v * (t - this.lastT)
    this.lastT = t
    this.v = value
    if (value > this.max) this.max = value
  }

  add(t: SimTime, delta: number): void {
    this.set(t, this.v + delta)
  }

  /** Reinicia la acumulacion manteniendo el nivel actual. */
  rebase(t: SimTime): void {
    this.area = 0
    this.lastT = t
    this.t0 = t
    this.max = this.v
  }

  mean(tNow: SimTime): number {
    const area = this.area + this.v * (tNow - this.lastT)
    const span = tNow - this.t0
    return span > 0 ? area / span : this.v
  }
}

/** Welford: media y desvio en O(1) de memoria. */
export class Welford {
  n = 0
  mean = 0
  private m2 = 0
  min = Infinity
  max = -Infinity

  push(x: number): void {
    this.n++
    const d = x - this.mean
    this.mean += d / this.n
    this.m2 += d * (x - this.mean)
    if (x < this.min) this.min = x
    if (x > this.max) this.max = x
  }

  sd(): number {
    return this.n > 1 ? Math.sqrt(this.m2 / (this.n - 1)) : 0
  }

  reset(): void {
    this.n = 0
    this.mean = 0
    this.m2 = 0
    this.min = Infinity
    this.max = -Infinity
  }
}
