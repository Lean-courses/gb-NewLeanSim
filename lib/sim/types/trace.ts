export const TraceKind = {
  Spawn: 0,
  EnterQueue: 1,
  StartService: 2,
  EndService: 3,
  DepartEdge: 4,
  ArriveNode: 5,
  StateChange: 6,
  Exit: 7,
  Scrap: 8,
  Rework: 9,
  QueueLevel: 10,
} as const

export type TraceKindId = (typeof TraceKind)[keyof typeof TraceKind]

/**
 * Struct-of-arrays, 12 bytes por registro, transferible sin copia.
 *
 * NO es un array de objetos a proposito: clonar 200k objetos por postMessage
 * cuesta ~100 ms y duplica memoria, y cambiarlo despues obliga a tocar todos
 * los call sites del recorder.
 */
export interface TraceChunk {
  t: Float64Array
  kind: Uint8Array
  node: Uint8Array
  node2: Uint8Array
  entity: Uint32Array
  aux: Uint16Array
  count: number
}

export const NO_ENTITY = 0xffffffff
