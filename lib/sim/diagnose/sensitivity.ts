/**
 * Auto-sensibilidad: cual estacion mueve de verdad el throughput.
 *
 * Se vuelve a correr el modelo bajando un 10% el tiempo de ciclo de CADA
 * estacion, una por vez, y se mide el delta de throughput. La de mayor delta
 * ES la restriccion, por definicion - no por heuristica.
 *
 * Es el numero que convence en una reunion: "mejorar la Est.1 un 10% te da
 * cero; mejorar la Est.3 un 10% te da 9%". Y encima es barato: N corridas de
 * un motor que hace 300.000 unidades en medio segundo.
 *
 * Todas las corridas usan la MISMA SEMILLA, asi que con streams de
 * aleatoriedad separados por nodo el delta es causal y no ruido estadistico.
 */

import type { SimModel } from '../types/model'
import { simulate } from '../run'

/** Cuanto se mejora cada estacion para medir su efecto. */
export const SENSITIVITY_STEP = 0.1

export interface StationSensitivity {
  nodeId: string
  label: string
  /** Fraccion de mejora del throughput al acelerar esta estacion un 10%. */
  deltaThroughput: number
}

export interface SensitivityReport {
  baselineThroughput: number
  stations: StationSensitivity[]
}

export function sensitivity(model: SimModel): SensitivityReport {
  const base = simulate(model, model.defaults).result.kpis.throughputPerHour
  const stations: StationSensitivity[] = []

  for (const n of model.nodes) {
    if (n.type !== 'process') continue
    const faster: SimModel = {
      ...model,
      nodes: model.nodes.map((x) =>
        x.id === n.id && x.type === 'process'
          ? { ...x, params: { ...x.params, cycleTime: x.params.cycleTime * (1 - SENSITIVITY_STEP) } }
          : x,
      ),
    }
    const t = simulate(faster, faster.defaults).result.kpis.throughputPerHour
    stations.push({
      nodeId: n.id,
      label: n.label,
      deltaThroughput: base > 0 ? (t - base) / base : 0,
    })
  }

  stations.sort((a, b) => b.deltaThroughput - a.deltaThroughput)
  return { baselineThroughput: base, stations }
}
