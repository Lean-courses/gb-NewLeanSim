/**
 * Serie temporal de buckets fijos con fusion por pares.
 *
 * Guarda el promedio PONDERADO POR TIEMPO y el maximo dentro de cada bucket.
 * Cuando el horizonte supera el rango cubierto, se fusionan buckets de a pares
 * y se duplica el ancho. Memoria constante sin importar el largo de la corrida:
 * nunca se guardan muestras crudas.
 */

import type { SimTime } from '../core/dist'
import type { Series } from '../types/results'

const N_BUCKETS = 400

export class BucketSeries {
  private area = new Float64Array(N_BUCKETS)
  private span = new Float64Array(N_BUCKETS)
  private maxv = new Float64Array(N_BUCKETS)
  private bucketMs: number
  private t0: SimTime = 0
  private lastT: SimTime = 0
  private v = 0

  constructor(bucketMs: number, t0: SimTime = 0, initial = 0) {
    this.bucketMs = Math.max(1, Math.round(bucketMs))
    this.t0 = t0
    this.lastT = t0
    this.v = initial
  }

  set(t: SimTime, value: number): void {
    this.accrue(t)
    this.v = value
    const i = this.indexOf(t)
    if (i >= 0 && i < N_BUCKETS && value > this.maxv[i]!) this.maxv[i] = value
  }

  /** Reparte el area del nivel actual entre los buckets hasta `t`. */
  private accrue(t: SimTime): void {
    if (t <= this.lastT) return
    let cur = this.lastT
    while (cur < t) {
      let i = this.indexOf(cur)
      while (i >= N_BUCKETS) {
        this.grow()
        i = this.indexOf(cur)
      }
      const bucketEnd = this.t0 + (i + 1) * this.bucketMs
      const until = Math.min(t, bucketEnd)
      const dt = until - cur
      this.area[i]! += this.v * dt
      this.span[i]! += dt
      if (this.v > this.maxv[i]!) this.maxv[i] = this.v
      cur = until
    }
    this.lastT = t
  }

  private indexOf(t: SimTime): number {
    return Math.floor((t - this.t0) / this.bucketMs)
  }

  private grow(): void {
    const a = new Float64Array(N_BUCKETS)
    const s = new Float64Array(N_BUCKETS)
    const m = new Float64Array(N_BUCKETS)
    for (let i = 0; i < N_BUCKETS / 2; i++) {
      a[i] = this.area[2 * i]! + this.area[2 * i + 1]!
      s[i] = this.span[2 * i]! + this.span[2 * i + 1]!
      m[i] = Math.max(this.maxv[2 * i]!, this.maxv[2 * i + 1]!)
    }
    this.area = a
    this.span = s
    this.maxv = m
    this.bucketMs *= 2
  }

  rebase(t: SimTime): void {
    this.area = new Float64Array(N_BUCKETS)
    this.span = new Float64Array(N_BUCKETS)
    this.maxv = new Float64Array(N_BUCKETS)
    this.t0 = t
    this.lastT = t
  }

  toJSON(tNow: SimTime): Series {
    this.accrue(tNow)
    const used = Math.max(1, Math.ceil((tNow - this.t0) / this.bucketMs))
    const n = Math.min(used, N_BUCKETS)
    const mean: number[] = new Array(n)
    const max: number[] = new Array(n)
    for (let i = 0; i < n; i++) {
      mean[i] = this.span[i]! > 0 ? this.area[i]! / this.span[i]! : 0
      max[i] = this.maxv[i]!
    }
    return { bucketMs: this.bucketMs, t0: this.t0, mean, max }
  }
}
