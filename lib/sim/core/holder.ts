/**
 * Holder: la unica abstraccion de cola del motor.
 *
 * Sirve igual para un buffer explicito del canvas, la cola de entrada implicita
 * de una estacion y su slot de salida. Y es, entera, el mecanismo de
 * notificacion del motor:
 *
 *   put()  despierta a los consumidores en espera (aparecio trabajo)
 *   take() despierta a los productores en espera (aparecio espacio)
 *
 * No hay polling, no hay timers de reintento, no hay pasos epsilon. Un
 * productor que falla canPut() se registra en waitingProducers, RETIENE la
 * pieza en su slot de salida y pasa a BLOCKED; se lo despierta en el instante
 * exacto en que alguien saca algo de aguas abajo.
 */

import type { Entity } from './entity'

export interface Waker {
  wake(nodeIdx: number): void
}

export class Holder {
  /**
   * FIFO con puntero de cabeza.
   *
   * NO se usa `Array.shift()`: es O(n), y la cola que crece delante del cuello
   * de botella es precisamente la demo de push. Con shift() una corrida con
   * 100.000 unidades encoladas se vuelve cuadratica y tarda medio minuto en vez
   * de medio segundo. Se compacta cuando la mitad del array quedo consumida.
   */
  private items: Array<Entity | undefined> = []
  private head = 0
  /** Indices de nodo a despertar cuando BAJA el nivel (se libero espacio). */
  readonly waitingProducers: number[] = []
  /** Indices de nodo a despertar cuando SUBE el nivel (hay trabajo). */
  readonly waitingConsumers: number[] = []

  constructor(public cap: number) {}

  level(): number {
    return this.items.length - this.head
  }

  canPut(n = 1): boolean {
    return this.level() + n <= this.cap
  }

  peek(): Entity | undefined {
    return this.items[this.head]
  }

  put(e: Entity, w: Waker): void {
    this.items.push(e)
    this.flush(this.waitingConsumers, w)
  }

  /** Inserta sin despertar a nadie (carga de inventario inicial). */
  seed(e: Entity): void {
    this.items.push(e)
  }

  take(w: Waker): Entity | undefined {
    if (this.head >= this.items.length) return undefined
    const e = this.items[this.head]
    this.items[this.head] = undefined
    this.head++
    // Compactacion amortizada: solo cuando ya se consumio la mitad del array.
    if (this.head > 1024 && this.head * 2 >= this.items.length) {
      this.items = this.items.slice(this.head)
      this.head = 0
    }
    if (e !== undefined) this.flush(this.waitingProducers, w)
    return e
  }

  /** Registro idempotente: un nodo no puede quedar dos veces en la misma lista. */
  waitProduce(nodeIdx: number): void {
    if (!this.waitingProducers.includes(nodeIdx)) this.waitingProducers.push(nodeIdx)
  }

  waitConsume(nodeIdx: number): void {
    if (!this.waitingConsumers.includes(nodeIdx)) this.waitingConsumers.push(nodeIdx)
  }

  /**
   * Despierta y vacia la lista de espera.
   *
   * Se vacia a proposito: quien siga sin poder avanzar se vuelve a registrar
   * en su propio activate(). Dejarlos registrados haria que un nodo acumule
   * despertares redundantes y, peor, que el orden de la lista dependa del
   * historial en vez de ser FIFO limpio.
   */
  private flush(list: number[], w: Waker): void {
    if (list.length === 0) return
    for (let i = 0; i < list.length; i++) w.wake(list[i]!)
    list.length = 0
  }
}
