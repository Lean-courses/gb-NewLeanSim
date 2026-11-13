/**
 * Identificacion de la restriccion.
 *
 * La utilizacion SOLA MIENTE, y de varias maneras distintas:
 *
 *  - Si la entrada sobrealimenta la linea, varias estaciones quedan al 100% y
 *    la mas rapida de ellas no es la restriccion. (Caso tipico: 10 s / 15 s
 *    alimentadas cada 8 s: las dos marcan 100%, pero el que manda es el de 15.)
 *  - Bajo kanban o CONWIP la utilizacion se APLANA por diseno: el tope de WIP
 *    deja a todo el mundo parcialmente hambriento, asi que el ranking pierde
 *    resolucion justo cuando mas se lo necesita.
 *  - En una linea balanceada no hay restriccion, y nombrar una igual es peor
 *    que no decir nada: manda a mejorar donde no hay nada que ganar.
 *
 * Por eso se combinan tres senales. La que hace el trabajo pesado es la FIRMA
 * DE BLOQUEO Y HAMBRE: la restriccion es la estacion cuyos vecinos aguas arriba
 * estan mayormente bloqueados y los de aguas abajo mayormente hambrientos, y
 * que ella misma casi nunca esta hambrienta.
 */

import type { NodeStats, RunResult } from '../types/results'
import type { SimModel } from '../types/model'
import { capacityCheck } from '../validate/capacityCheck'

export type DiagnosisKind =
  | 'constraint'
  /** Linea pareja: ninguna estacion manda sobre las demas. */
  | 'balanced'
  /** Nadie esta saturado: la restriccion esta fuera de la linea (la demanda). */
  | 'demand-limited'

export interface BottleneckDiagnosis {
  kind: DiagnosisKind
  /** Estacion restriccion. null si kind no es 'constraint'. */
  nodeId: string | null
  label: string | null
  utilization: number
  /**
   * Fraccion del tiempo en que la estacion NO esta disponible para mas
   * trabajo: produciendo, en cambio de formato, parada o esperando operario.
   *
   * Es el numero honesto para una restriccion. Una estacion con 47% de
   * utilizacion, 33% de changeover y 17% de paradas esta ocupada el 97% del
   * tiempo: decir "trabaja al 47%" suena a que le sobra capacidad cuando en
   * realidad no le queda ni un minuto libre.
   */
  occupied: number
  /** Desglose de ese tiempo ocupado. */
  breakdown: { busy: number; setup: number; down: number; blocked: number; waitOp: number }
  /** Utilizacion promedio del resto de las estaciones. */
  restUtilization: number
  /** Ranking completo, de mas a menos sospechoso. */
  ranked: Array<{ nodeId: string; label: string; score: number; utilization: number }>
}

/** Por debajo de esto nadie esta realmente saturado. */
const SATURATED = 0.85
/** Diferencia de score por debajo de la cual se considera un empate. */
const TIE = 0.05

export function diagnoseBottleneck(model: SimModel, result: RunResult): BottleneckDiagnosis {
  const stations = result.nodes.filter((n) => n.type === 'process' || n.type === 'inspection')
  const EMPTY_BREAKDOWN = { busy: 0, setup: 0, down: 0, blocked: 0, waitOp: 0 }
  if (stations.length === 0) {
    return {
      kind: 'balanced',
      nodeId: null,
      label: null,
      utilization: 0,
      occupied: 0,
      breakdown: EMPTY_BREAKDOWN,
      restUtilization: 0,
      ranked: [],
    }
  }

  const byId = new Map(stations.map((s) => [s.nodeId, s]))
  const upstream = new Map<string, string[]>()
  const downstream = new Map<string, string[]>()
  for (const e of model.edges) {
    if (e.params?.kind === 'rework') continue
    downstream.set(e.source, [...(downstream.get(e.source) ?? []), e.target])
    upstream.set(e.target, [...(upstream.get(e.target) ?? []), e.source])
  }

  const avgOf = (ids: string[], pick: (s: NodeStats) => number): number => {
    const vals = ids.map((id) => byId.get(id)).filter((s): s is NodeStats => s !== undefined).map(pick)
    return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 0
  }

  // El chequeo estatico desempata cuando dos estaciones marcan la misma
  // utilizacion: entre dos saturadas, manda la de mayor tiempo de ciclo
  // efectivo. Pesa poco a proposito - solo rompe empates.
  const cap = capacityCheck(model)
  const effById = new Map(cap.stations.map((s) => [s.nodeId, s.effectiveMs]))
  const maxEff = Math.max(...cap.stations.map((s) => s.effectiveMs), 1)

  const ranked = stations
    .map((s) => {
      const up = avgOf(upstream.get(s.nodeId) ?? [], (x) => x.states.blocked)
      const down = avgOf(downstream.get(s.nodeId) ?? [], (x) => x.states.starved)
      const effShare = (effById.get(s.nodeId) ?? 0) / maxEff
      const score =
        s.utilization - s.states.starved + 0.5 * (up + down) + 0.2 * effShare
      return { nodeId: s.nodeId, label: s.label, score, utilization: s.utilization }
    })
    .sort((a, b) => b.score - a.score)

  const top = ranked[0]!
  const topStat = byId.get(top.nodeId)!
  const occupied = 1 - topStat.states.starved
  const breakdown = {
    busy: topStat.states.busy,
    setup: topStat.states.setup,
    down: topStat.states.down,
    blocked: topStat.states.blocked,
    waitOp: topStat.states.waitOp,
  }
  const second = ranked[1]
  const rest = stations.filter((s) => s.nodeId !== top.nodeId)
  const restUtilization =
    rest.length > 0 ? rest.reduce((a, s) => a + s.utilization, 0) / rest.length : 0

  // Nadie saturado: la linea sobra para la demanda, la restriccion esta afuera.
  // Se mide con el tiempo OCUPADO, no con la utilizacion: una estacion que
  // produce el 47% pero ademas pasa 33% en cambio de formato y 17% parada no
  // tiene capacidad de sobra, tiene un problema distinto.
  if (occupied < SATURATED) {
    const spread = Math.max(...stations.map((s) => s.utilization)) - Math.min(...stations.map((s) => s.utilization))
    if (spread < 0.1) {
      return {
        kind: 'demand-limited',
        nodeId: null,
        label: null,
        utilization: top.utilization,
        occupied,
        breakdown,
        restUtilization,
        ranked,
      }
    }
  }

  // Empate real: la linea esta pareja y no hay a quien senalar.
  if (second !== undefined && top.score - second.score < TIE && stations.length > 1) {
    return {
      kind: 'balanced',
      nodeId: null,
      label: null,
      utilization: top.utilization,
      occupied,
      breakdown,
      restUtilization,
      ranked,
    }
  }

  return {
    kind: 'constraint',
    nodeId: top.nodeId,
    label: top.label,
    utilization: top.utilization,
    occupied,
    breakdown,
    restUtilization,
    ranked,
  }
}
