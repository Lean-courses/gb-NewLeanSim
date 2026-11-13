/**
 * Reservoir sampling (algoritmo R) con stream propio de aleatoriedad.
 *
 * Alimenta el box plot y sirve de contraste contra los cuantiles derivados del
 * histograma: si ambos discrepan mucho, hay un bug en uno de los dos.
 */

import type { RngBank } from '../core/rng'

export class Reservoir {
  private items: number[] = []
  private seen = 0

  constructor(
    private readonly capacity: number,
    private readonly rng: RngBank,
    private readonly nodeIdx: number,
    private readonly stream: number,
  ) {}

  push(x: number): void {
    this.seen++
    if (this.items.length < this.capacity) {
      this.items.push(x)
      return
    }
    const j = Math.floor(this.rng.u(this.nodeIdx, this.stream) * this.seen)
    if (j < this.capacity) this.items[j] = x
  }

  reset(): void {
    this.items = []
    this.seen = 0
  }

  values(): number[] {
    return this.items.slice()
  }
}
