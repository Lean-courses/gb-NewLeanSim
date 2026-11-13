/**
 * Histograma de bins fijos con rango auto-duplicante.
 *
 * Al desbordar se fusionan bins adyacentes de a pares y se duplica el ancho.
 * Memoria O(1) y a lo sumo log2(rango) fusiones. Los conteos quedan exactos;
 * los bordes, aproximados - mas que suficiente para un histograma de lead time,
 * y el min/max exactos se guardan aparte.
 */

import type { Histogram } from '../types/results'

const N_BINS = 64

export class AutoHistogram {
  private counts = new Float64Array(N_BINS)
  private width: number
  private lo = 0

  constructor(initialWidth = 1) {
    this.width = Math.max(1e-9, initialWidth)
  }

  push(x: number): void {
    if (x < this.lo) {
      // Valores por debajo del piso caen en el primer bin. En la practica el
      // piso es 0 y los lead times son positivos.
      this.counts[0]! += 1
      return
    }
    let i = Math.floor((x - this.lo) / this.width)
    while (i >= N_BINS) {
      this.grow()
      i = Math.floor((x - this.lo) / this.width)
    }
    this.counts[i]! += 1
  }

  private grow(): void {
    const next = new Float64Array(N_BINS)
    for (let i = 0; i < N_BINS / 2; i++) {
      next[i] = this.counts[2 * i]! + this.counts[2 * i + 1]!
    }
    this.counts = next
    this.width *= 2
  }

  reset(): void {
    this.counts = new Float64Array(N_BINS)
  }

  /** Cuantil interpolado dentro del bin. */
  quantile(q: number): number {
    let total = 0
    for (let i = 0; i < N_BINS; i++) total += this.counts[i]!
    if (total === 0) return 0
    const target = q * total
    let cum = 0
    for (let i = 0; i < N_BINS; i++) {
      const c = this.counts[i]!
      if (cum + c >= target) {
        const frac = c > 0 ? (target - cum) / c : 0
        return this.lo + (i + frac) * this.width
      }
      cum += c
    }
    return this.lo + N_BINS * this.width
  }

  toJSON(): Histogram {
    return { lo: this.lo, width: this.width, counts: Array.from(this.counts) }
  }
}
