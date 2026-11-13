/**
 * Calendario de eventos.
 *
 * El orden total (tiempo, prioridad, secuencia) ES el contrato de determinismo
 * del motor. Los modelos de ensenanza son casi todos deterministicos (ciclo =
 * 60 s exacto en cada estacion), asi que el calendario es un mar de empates
 * exactos: lo opuesto a una simulacion estocastica tipica, donde dos eventos
 * casi nunca caen en el mismo instante. Si alguna decision de orden se filtra
 * por iterar un Map, un Set o un `for...in`, obtenes "misma semilla, distinta
 * respuesta", y se manifiesta como un cuello de botella que cambia en cada
 * carga de la pagina.
 */

import type { SimTime } from './dist'

export const EvKind = {
  /** Rebase de estadisticas al terminar el calentamiento. */
  WarmupReset: 0,
  /** Fin de servicio de un servidor. */
  ServiceEnd: 1,
  /** Fin de changeover/setup. */
  SetupEnd: 2,
  /** Reparacion terminada: la estacion vuelve de Down. */
  RepairEnd: 3,
  /** Llega una falla (se evalua contra tiempo de operacion). */
  Failure: 4,
  /** Fin de traslado por una arista con tiempo de movimiento. */
  MoveEnd: 5,
  /** La entrada libera una unidad. */
  SourceRelease: 6,
  /** Cierre de la corrida. */
  EndRun: 7,
} as const

export type EvKindId = (typeof EvKind)[keyof typeof EvKind]

/**
 * Prioridad dentro de un mismo timestamp. Menor = primero.
 *
 * Las salidas van antes que las llegadas: un ServiceEnd libera capacidad, y
 * procesarlo primero evita que una llegada simultanea vea la estacion ocupada
 * y se encole sin necesidad. RepairEnd va antes que Failure para que una
 * reparacion de duracion cero no se cruce con su propia falla.
 */
export const EV_PRIORITY: Record<EvKindId, number> = {
  [EvKind.WarmupReset]: 0,
  [EvKind.ServiceEnd]: 1,
  [EvKind.SetupEnd]: 1,
  [EvKind.RepairEnd]: 2,
  [EvKind.Failure]: 3,
  [EvKind.MoveEnd]: 4,
  [EvKind.SourceRelease]: 5,
  [EvKind.EndRun]: 9,
}

export interface SimEvent {
  time: SimTime
  kind: EvKindId
  /** Indice compilado del nodo. Nunca un string: el orden importa. */
  nodeIdx: number
  /** Significado segun `kind`: entityId, indice de servidor, etc. */
  payload: number
  /** Contador monotono de insercion: desempata de forma determinista (FIFO). */
  seq: number
  /**
   * Invalidacion lazy. Necesaria desde el dia uno porque una estacion puede
   * romperse en mitad de un ciclo, lo que obliga a cancelar el ServiceEnd ya
   * agendado y reagendarlo tras la reparacion.
   */
  cancelled: boolean
}

function before(a: SimEvent, b: SimEvent): boolean {
  if (a.time !== b.time) return a.time < b.time
  const pa = EV_PRIORITY[a.kind]
  const pb = EV_PRIORITY[b.kind]
  if (pa !== pb) return pa < pb
  return a.seq < b.seq
}

/** Heap binario de minimo sobre el orden total de arriba. */
export class Calendar {
  private heap: SimEvent[] = []
  private nextSeq = 0
  /** Eventos cancelados todavia en el heap, para no contarlos como pendientes. */
  private deadCount = 0

  get size(): number {
    return this.heap.length - this.deadCount
  }

  /** Agenda un evento y devuelve el token para poder cancelarlo. */
  schedule(
    time: SimTime,
    kind: EvKindId,
    nodeIdx: number,
    payload: number,
  ): SimEvent {
    const ev: SimEvent = {
      time,
      kind,
      nodeIdx,
      payload,
      seq: this.nextSeq++,
      cancelled: false,
    }
    this.heap.push(ev)
    this.siftUp(this.heap.length - 1)
    return ev
  }

  /** Invalidacion lazy: el evento queda en el heap pero se descarta al salir. */
  cancel(ev: SimEvent | null | undefined): void {
    if (!ev || ev.cancelled) return
    ev.cancelled = true
    this.deadCount++
  }

  /** Saca el proximo evento vivo. `undefined` = no queda nada por pasar. */
  pop(): SimEvent | undefined {
    for (;;) {
      if (this.heap.length === 0) return undefined
      const top = this.heap[0]!
      const last = this.heap.pop()!
      if (this.heap.length > 0) {
        this.heap[0] = last
        this.siftDown(0)
      }
      if (top.cancelled) {
        this.deadCount--
        continue
      }
      return top
    }
  }

  /** Tiempo del proximo evento vivo, sin sacarlo. */
  peekTime(): SimTime | undefined {
    // Los cancelados en la cima se purgan aca para no mentir sobre el proximo
    // instante; es amortizado O(1).
    while (this.heap.length > 0 && this.heap[0]!.cancelled) {
      const last = this.heap.pop()!
      this.deadCount--
      if (this.heap.length > 0) {
        this.heap[0] = last
        this.siftDown(0)
      }
    }
    return this.heap.length > 0 ? this.heap[0]!.time : undefined
  }

  private siftUp(i: number): void {
    const heap = this.heap
    const node = heap[i]!
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (!before(node, heap[parent]!)) break
      heap[i] = heap[parent]!
      i = parent
    }
    heap[i] = node
  }

  private siftDown(i: number): void {
    const heap = this.heap
    const n = heap.length
    const node = heap[i]!
    for (;;) {
      const l = 2 * i + 1
      if (l >= n) break
      const r = l + 1
      let best = l
      if (r < n && before(heap[r]!, heap[l]!)) best = r
      if (!before(heap[best]!, node)) break
      heap[i] = heap[best]!
      i = best
    }
    heap[i] = node
  }
}
