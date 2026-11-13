/**
 * PRNG sembrado y banco de streams.
 *
 * La separacion de streams NO es negociable. Si todos los nodos consumen del
 * mismo generador, cambiar el lote de transferencia de 10 a 1 reordena los
 * numeros aleatorios que ve cada estacion, y la comparacion As-Is / To-Be deja
 * de medir el cambio para medir ruido. Un generador independiente por
 * (nodo, proposito) nos da Common Random Numbers gratis: dos escenarios con la
 * misma semilla ven exactamente las mismas llegadas, los mismos tiempos de
 * servicio y las mismas paradas, asi que el delta entre ellos es causal.
 */

/** sfc32: 32 bits, 4 palabras de estado, rapido y estadisticamente solido. */
export function sfc32(a: number, b: number, c: number, d: number): () => number {
  return function next(): number {
    a |= 0
    b |= 0
    c |= 0
    d |= 0
    const t = ((a + b) | 0) + d | 0
    d = (d + 1) | 0
    a = b ^ (b >>> 9)
    b = (c + (c << 3)) | 0
    c = (c << 21) | (c >>> 11)
    c = (c + t) | 0
    return (t >>> 0) / 4294967296
  }
}

/** splitmix32: expande una semilla escalar a las 4 palabras de sfc32. */
export function splitmix32(seed: number): [number, number, number, number] {
  let s = seed | 0
  const step = (): number => {
    s = (s + 0x9e3779b9) | 0
    let z = s
    z = Math.imul(z ^ (z >>> 16), 0x21f0aaad)
    z = Math.imul(z ^ (z >>> 15), 0x735a2d97)
    return (z ^ (z >>> 15)) >>> 0
  }
  return [step(), step(), step(), step()]
}

/** Hash determinista de (semilla, nodo, stream) a una semilla escalar. */
export function hash32(seed: number, nodeIdx: number, stream: number): number {
  let h = (seed ^ 0x9e3779b9) | 0
  h = Math.imul(h ^ (nodeIdx + 0x85ebca6b), 0xc2b2ae35)
  h = Math.imul(h ^ (stream + 0x27d4eb2f), 0x165667b1)
  h ^= h >>> 15
  return h >>> 0
}

/** Propositos de aleatoriedad. Uno por cada fuente independiente de azar. */
export const Stream = {
  Interarrival: 0,
  Service: 1,
  Setup: 2,
  Quality: 3,
  Routing: 4,
  Downtime: 5,
} as const

export type StreamId = (typeof Stream)[keyof typeof Stream]

export const N_STREAMS = 6

/**
 * Banco de generadores indexado por (nodeIdx, stream).
 * Array plano: el orden de iteracion nunca influye en nada, pero el acceso
 * indexado garantiza que agregar un nodo no desplace los streams de los demas
 * mas alla de su propio indice.
 */
export class RngBank {
  private readonly gens: Array<() => number>

  constructor(seed: number, nodeCount: number) {
    this.gens = new Array(nodeCount * N_STREAMS)
    for (let n = 0; n < nodeCount; n++) {
      for (let s = 0; s < N_STREAMS; s++) {
        const [a, b, c, d] = splitmix32(hash32(seed, n, s))
        this.gens[n * N_STREAMS + s] = sfc32(a, b, c, d)
      }
    }
  }

  /** Uniforme [0,1) del stream pedido. */
  u(nodeIdx: number, stream: number): number {
    return this.gens[nodeIdx * N_STREAMS + stream]()
  }
}
