/**
 * Colector de estadisticas.
 *
 * Dos disciplinas que no se negocian:
 *  - Todo lo que es un NIVEL se integra en el tiempo, nunca se promedian
 *    muestras. Promediar muestras es como la utilizacion y el WIP terminan
 *    mal calculados sin que se note.
 *  - Al terminar el calentamiento se REBASEA todo y se marcan las unidades ya
 *    en la linea como excluidas del lead time. Si no, el transitorio de
 *    arranque contamina el estado estable y las unidades a medio hacer sesgan
 *    el promedio hacia abajo (censura por izquierda).
 */

import type { SimTime } from '../core/dist'
import type { Entity } from '../core/entity'
import type { EngineHooks } from '../core/engine'
import { RngBank } from '../core/rng'
import { TimeWeighted, Welford } from './accumulators'
import { AutoHistogram } from './histogram'
import { Reservoir } from './reservoir'
import { BucketSeries } from './timeseries'

export class StatsCollector implements EngineHooks {
  readonly leadTime = new Welford()
  readonly leadHist: AutoHistogram
  readonly leadSample: Reservoir
  readonly wipTw: TimeWeighted
  readonly wipSeries: BucketSeries

  /** Inicio de la ventana de medicion (fin del calentamiento). */
  measureStart: SimTime = 0
  /** Unidades descartadas, por indice de nodo. */
  readonly scrapByNode: number[]

  constructor(nodeCount: number, bucketMs: number, seed: number, sampleSize = 2000) {
    this.leadHist = new AutoHistogram(1000)
    // Generador propio para el muestreo: no debe consumir numeros de ningun
    // nodo, o activar la traza cambiaria los resultados de la simulacion.
    const sampleRng = new RngBank(seed ^ 0x5eed5eed, 1)
    this.leadSample = new Reservoir(sampleSize, sampleRng, 0, 0)
    this.wipTw = new TimeWeighted(0, 0)
    this.wipSeries = new BucketSeries(bucketMs, 0, 0)
    this.scrapByNode = new Array(nodeCount).fill(0)
  }

  onRelease(_e: Entity, _t: SimTime): void {
    /* el WIP se notifica por onWip */
  }

  onComplete(e: Entity, t: SimTime): void {
    if (e.excludeFromLeadTime) return
    const lt = t - e.createdAt
    this.leadTime.push(lt)
    this.leadHist.push(lt)
    this.leadSample.push(lt)
  }

  onScrap(_e: Entity, nodeIdx: number, _t: SimTime): void {
    this.scrapByNode[nodeIdx] = (this.scrapByNode[nodeIdx] ?? 0) + 1
  }

  onWip(t: SimTime, wip: number): void {
    this.wipTw.set(t, wip)
    this.wipSeries.set(t, wip)
  }

  onWarmup(t: SimTime): void {
    this.measureStart = t
    this.leadTime.reset()
    this.leadHist.reset()
    this.leadSample.reset()
    this.wipTw.rebase(t)
    this.wipSeries.rebase(t)
    this.scrapByNode.fill(0)
  }
}
