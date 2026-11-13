/**
 * CONWIP: un pool de fichas a nivel linea.
 *
 * La idea unificadora del motor es que el movimiento de material es SIEMPRE
 * push con bloqueo, y que pull es una capa de control de admision encima. Esta
 * es esa capa: una ficha = una unidad en la linea. La entrada solo libera si
 * hay ficha; la ficha vuelve cuando la unidad sale.
 *
 * TRAMPA CRITICA: una unidad descartada debe devolver su ficha EN EL PUNTO DE
 * SCRAP, no en la salida. Si no, las fichas se fugan y el throughput decae
 * invisiblemente a lo largo de la corrida - un bug que se presenta como
 * "misteriosamente la linea se va frenando" y es insoportable de encontrar.
 * Por eso hay un unico releaseToken() en el motor, alcanzable desde la salida
 * y desde el scrap, y un invariante que lo verifica.
 */

export class ConwipPool {
  private out = 0
  /** Indices de nodos (entradas) esperando una ficha. */
  readonly waiting: number[] = []

  constructor(readonly cap: number) {}

  get inUse(): number {
    return this.out
  }

  canTake(): boolean {
    return this.out < this.cap
  }

  take(): boolean {
    if (this.out >= this.cap) return false
    this.out++
    return true
  }

  /** Devuelve una ficha y entrega la lista de nodos a despertar. */
  release(): number[] {
    this.out--
    if (this.waiting.length === 0) return []
    const woken = this.waiting.slice()
    this.waiting.length = 0
    return woken
  }

  wait(nodeIdx: number): void {
    if (!this.waiting.includes(nodeIdx)) this.waiting.push(nodeIdx)
  }
}
