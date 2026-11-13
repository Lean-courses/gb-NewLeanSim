/**
 * Entidades = unidades individuales. SIEMPRE.
 *
 * Nunca existe una "entidad lote". Un lote es solamente un `batchId` mas una
 * regla de retencion en el slot de salida de la estacion. Mantenerlo asi es lo
 * que deja el lead time por unidad, el conteo de WIP y la Ley de Little
 * correctos sin un solo caso especial.
 */

import type { SimTime } from './dist'

export interface Entity {
  id: number
  /** Instante en que entro a la linea (tomo su ficha CONWIP). */
  createdAt: SimTime
  /** Instante en que llego al holder actual, para el tiempo de espera en cola. */
  enteredAt: SimTime
  /** Grupo de lote de transferencia. -1 = suelta. */
  batchId: number
  reworkCount: number
  /** true si tiene una ficha CONWIP tomada. */
  conwipToken: boolean
  /** true si sus movimientos se registran en la traza de animacion. */
  traced: boolean
  /** true si fue liberada antes del fin del calentamiento: no cuenta su lead time. */
  excludeFromLeadTime: boolean
}

/**
 * Pool con free-list. Nunca se retiene un array con todas las entidades: las
 * estadisticas se acumulan en streaming, asi que una corrida de 10^6 unidades
 * usa la misma memoria que una de 10^3.
 */
export class EntityPool {
  private free: Entity[] = []
  private nextId = 0
  /** Total de entidades creadas desde el inicio (no se resetea al calentar). */
  created = 0

  acquire(now: SimTime): Entity {
    this.created++
    const e = this.free.pop()
    if (e) {
      e.id = this.nextId++
      e.createdAt = now
      e.enteredAt = now
      e.batchId = -1
      e.reworkCount = 0
      e.conwipToken = false
      e.traced = false
      e.excludeFromLeadTime = false
      return e
    }
    return {
      id: this.nextId++,
      createdAt: now,
      enteredAt: now,
      batchId: -1,
      reworkCount: 0,
      conwipToken: false,
      traced: false,
      excludeFromLeadTime: false,
    }
  }

  release(e: Entity): void {
    this.free.push(e)
  }
}
