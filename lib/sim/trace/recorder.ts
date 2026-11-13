/**
 * Grabador de traza para la animacion.
 *
 * Muestreo POR ENTIDAD, no por registro: descartar registros sueltos produce
 * puntos que se teletransportan y desaparecen a media conexion; descartar
 * entidades enteras mantiene coherente la historia de cada punto visible. Las
 * entidades no trazadas igual emiten cambios de estado y niveles de cola
 * agregados, asi que los badges y colores de los nodos siguen exactos.
 */

import type { SimTime } from '../core/dist'
import type { TraceLevel } from '../types/model'
import { NO_ENTITY, type TraceChunk } from '../types/trace'

const CHUNK = 16384

export class TraceRecorder {
  private t = new Float64Array(CHUNK)
  private kind = new Uint8Array(CHUNK)
  private node = new Uint8Array(CHUNK)
  private node2 = new Uint8Array(CHUNK)
  private entity = new Uint32Array(CHUNK)
  private aux = new Uint16Array(CHUNK)
  private n = 0

  private readonly chunks: TraceChunk[] = []
  private total = 0

  /** true cuando se agoto el presupuesto y se dejo de grabar. */
  truncated = false
  truncatedAt: SimTime = 0

  constructor(
    readonly level: TraceLevel,
    /** Tope de registros. 200k ~ 2,4 MB. */
    private readonly maxRecords: number,
    /** Solo las primeras N entidades admitidas se trazan individualmente. */
    readonly entityCap: number,
  ) {}

  get recordCount(): number {
    return this.total
  }

  push(
    t: SimTime,
    kind: number,
    node: number,
    node2: number,
    entity: number,
    aux: number,
  ): void {
    if (this.level === 'none' || this.truncated) return
    if (this.total >= this.maxRecords) {
      this.truncated = true
      this.truncatedAt = t
      return
    }
    this.t[this.n] = t
    this.kind[this.n] = kind
    this.node[this.n] = node
    this.node2[this.n] = node2
    this.entity[this.n] = entity
    this.aux[this.n] = aux > 0xffff ? 0xffff : aux
    this.n++
    this.total++
    if (this.n === CHUNK) this.seal()
  }

  pushNodeLevel(t: SimTime, kind: number, node: number, aux: number): void {
    this.push(t, kind, node, 0, NO_ENTITY, aux)
  }

  private seal(): void {
    this.chunks.push({
      t: this.t.subarray(0, this.n),
      kind: this.kind.subarray(0, this.n),
      node: this.node.subarray(0, this.n),
      node2: this.node2.subarray(0, this.n),
      entity: this.entity.subarray(0, this.n),
      aux: this.aux.subarray(0, this.n),
      count: this.n,
    })
    this.t = new Float64Array(CHUNK)
    this.kind = new Uint8Array(CHUNK)
    this.node = new Uint8Array(CHUNK)
    this.node2 = new Uint8Array(CHUNK)
    this.entity = new Uint32Array(CHUNK)
    this.aux = new Uint16Array(CHUNK)
    this.n = 0
  }

  /** Cierra el chunk abierto y devuelve todos los chunks grabados. */
  finish(): TraceChunk[] {
    if (this.n > 0) this.seal()
    return this.chunks
  }
}
