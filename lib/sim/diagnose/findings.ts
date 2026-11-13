/**
 * Hallazgos de oportunidad, ordenados por impacto y con el numero al lado.
 *
 * La distincion que organiza todo el panel, y que es lo que separa un
 * diagnostico Lean de una lista de quejas:
 *
 *   CAPACIDAD - mover esto mueve el throughput de la linea. Solo pasa en la
 *               restriccion. Es donde esta la plata.
 *   FLUJO     - no cambia la salida, pero baja el lead time y el inventario.
 *               Es donde esta el capital de trabajo.
 *   COSTO     - una perdida real que NO mueve el throughput porque no esta en
 *               la restriccion. Vale arreglarlo por lo que cuesta, no por lo
 *               que produce, y hay que decirlo asi.
 *
 * Decirle a un cliente "tu Est.1 esta parada 22% del tiempo" sin aclarar que
 * arreglarlo no le va a dar una sola unidad mas es como se pierden proyectos
 * de mejora: se invierte, no pasa nada, y la proxima vez nadie escucha.
 */

import type { SimModel } from '../types/model'
import type { RunResult } from '../types/results'
import { capacityCheck, type CapacityReport } from '../validate/capacityCheck'
import { diagnoseBottleneck } from './bottleneck'
import type { SensitivityReport } from './sensitivity'

export type FindingKind = 'capacity' | 'flow' | 'cost' | 'info'

export interface Bilingual {
  es: string
  en: string
}

export interface Finding {
  id: string
  kind: FindingKind
  nodeId: string | null
  /** Ganancia estimada de throughput, como fraccion. null = no cuantificado. */
  impact: number | null
  /** true si el impacto viene de simular, no de una cuenta de capacidad. */
  measured: boolean
  title: Bilingual
  detail: Bilingual
}

export interface DiagnosisReport {
  findings: Finding[]
  /** false = el WIP y el lead time divergen; los numeros de flujo no aplican. */
  steadyState: boolean
  /** Fraccion del lead time en la que la pieza realmente se trabaja. */
  flowEfficiency: number
  /** Tiempo de toque: suma de los ciclos nominales. */
  touchTimeMs: number
  /** WIP por encima del minimo que exige la Ley de Little. */
  excessWip: number
  capacity: CapacityReport
}

/** Redondear 0,4% a "0%" es mentir por redondeo, asi que abajo del 1% se
 *  muestra un decimal. */
const pct = (v: number): string => {
  const p = v * 100
  if (p > 0 && p < 1) return `${p.toFixed(1)}%`
  return `${p.toFixed(0)}%`
}

/** " (47% produciendo, 33% en cambio, 17% parada)" - sin los ceros. */
function occupiedBreakdown(
  b: { busy: number; setup: number; down: number; blocked: number; waitOp: number },
  locale: 'es' | 'en',
): string {
  const parts: string[] = []
  const push = (v: number, es: string, en: string) => {
    if (v > 0.02) parts.push(`${pct(v)} ${locale === 'es' ? es : en}`)
  }
  push(b.busy, 'produciendo', 'producing')
  push(b.setup, 'en cambio de formato', 'in changeover')
  push(b.down, 'parada', 'down')
  push(b.blocked, 'bloqueada', 'blocked')
  push(b.waitOp, 'esperando operario', 'waiting for an operator')
  if (parts.length <= 1) return ''
  return ` (${parts.join(', ')})`
}

export function diagnose(
  model: SimModel,
  result: RunResult,
  sens?: SensitivityReport,
): DiagnosisReport {
  const cap = capacityCheck(model)
  const bottleneck = diagnoseBottleneck(model, result)
  const findings: Finding[] = []

  const stations = result.nodes.filter((n) => n.type === 'process')

  /**
   * ¿El sistema llego a estado estable?
   *
   * Si la demanda supera la capacidad, el WIP y el lead time CRECEN SIN TECHO:
   * el "lead time promedio" que sale no describe el proceso, describe cuanto
   * duro la corrida. Mostrarle a un cliente "tu lead time es 2,6 h" cuando en
   * realidad diverge es peor que no mostrar nada, asi que esto encabeza el
   * diagnostico y los hallazgos que dependen del lead time se callan.
   */
  const steady = result.kpis.littleError < 0.1
  const byId = new Map(cap.stations.map((s) => [s.nodeId, s]))
  const lineCap = cap.lineCapacityPerHour

  // Capacidad de la linea si la estacion `id` pasara a tardar `newEffMs`.
  const capacityIf = (id: string, newEffMs: number): number => {
    let worst = 0
    for (const s of cap.stations) {
      const eff = s.nodeId === id ? newEffMs : s.effectiveMs
      if (eff > worst) worst = eff
    }
    return worst > 0 ? 3_600_000 / worst : 0
  }
  const gainIf = (id: string, newEffMs: number): number =>
    lineCap > 0 ? capacityIf(id, newEffMs) / lineCap - 1 : 0

  if (!steady) {
    const demand = cap.demandPerHour
    findings.push({
      id: 'not-steady',
      kind: 'capacity',
      nodeId: bottleneck.nodeId,
      impact: null,
      measured: false,
      title: {
        es: 'La linea no da la demanda: el inventario crece sin techo',
        en: 'The line cannot meet demand: inventory grows without bound',
      },
      detail: {
        es: `${demand ? `Se liberan ${demand.toFixed(0)} u/h a una linea que puede con ${lineCap.toFixed(0)} u/h. ` : ''}Mientras eso siga asi, el WIP y el lead time no se estabilizan: siguen subiendo mientras corra el reloj. Los valores de lead time y WIP de esta corrida describen cuanto duro la corrida, no el proceso. Primero hay que cerrar la brecha de capacidad o bajar el ritmo de liberacion; recien ahi los numeros de flujo significan algo.`,
        en: `${demand ? `${demand.toFixed(0)} u/h are released into a line that can do ${lineCap.toFixed(0)} u/h. ` : ''}While that holds, WIP and lead time never settle: they keep climbing as long as the clock runs. This run's lead time and WIP describe how long the run was, not the process. Close the capacity gap or slow the release rate first; only then do the flow numbers mean anything.`,
      },
    })
  }

  // ---------------------------------------------------------------- restriccion
  if (bottleneck.kind === 'demand-limited') {
    findings.push({
      id: 'demand',
      kind: 'info',
      nodeId: null,
      impact: null,
      measured: false,
      title: {
        es: 'La restriccion no esta en la linea',
        en: 'The constraint is not the line',
      },
      detail: {
        es: `Ninguna estacion pasa del ${pct(bottleneck.utilization)} de uso. La linea tiene capacidad de sobra para la demanda actual: acelerar maquinas no va a dar una sola unidad mas. La conversacion es de demanda o de costo, no de capacidad.`,
        en: `No station exceeds ${pct(bottleneck.utilization)} utilisation. The line has spare capacity for current demand: speeding up machines will not deliver a single extra unit. The conversation is about demand or cost, not capacity.`,
      },
    })
  } else if (bottleneck.kind === 'balanced') {
    findings.push({
      id: 'balanced',
      kind: 'info',
      nodeId: null,
      impact: null,
      measured: false,
      title: { es: 'La linea esta pareja', en: 'The line is balanced' },
      detail: {
        es: `Todas las estaciones rondan el ${pct(bottleneck.utilization)}. No hay una restriccion unica, asi que mejorar cualquiera por separado casi no mueve la salida: para subir el throughput hay que subir a todas, o sacar trabajo de la linea.`,
        en: `Every station sits near ${pct(bottleneck.utilization)}. There is no single constraint, so improving any one alone barely moves output: to lift throughput you must lift them all, or take work out of the line.`,
      },
    })
  } else if (bottleneck.nodeId) {
    const measured = sens?.stations.find((s) => s.nodeId === bottleneck.nodeId)
    findings.push({
      id: 'bottleneck',
      kind: 'capacity',
      nodeId: bottleneck.nodeId,
      impact: measured?.deltaThroughput ?? null,
      measured: measured !== undefined,
      title: {
        es: `"${bottleneck.label}" es la restriccion`,
        en: `"${bottleneck.label}" is the constraint`,
      },
      detail: {
        es:
          `Esta ocupada el ${pct(bottleneck.occupied)} del tiempo` +
          occupiedBreakdown(bottleneck.breakdown, 'es') +
          `, contra ${pct(bottleneck.restUtilization)} de uso en el resto de la linea.` +
          (measured
            ? ` Acelerarla un 10% sube el throughput de toda la linea ${pct(measured.deltaThroughput)}; acelerar cualquier otra no cambia nada.`
            : ' Es la unica estacion donde una mejora se convierte en unidades.'),
        en:
          `It is occupied ${pct(bottleneck.occupied)} of the time` +
          occupiedBreakdown(bottleneck.breakdown, 'en') +
          `, against ${pct(bottleneck.restUtilization)} utilisation across the rest of the line.` +
          (measured
            ? ` Speeding it up 10% lifts whole-line throughput by ${pct(measured.deltaThroughput)}; speeding up any other station changes nothing.`
            : ' It is the only station where an improvement turns into units.'),
      },
    })
  }

  // -------------------------------------------------- disponibilidad y changeover
  for (const n of model.nodes) {
    if (n.type !== 'process') continue
    const stat = stations.find((s) => s.nodeId === n.id)
    const c = byId.get(n.id)
    if (!stat || !c) continue
    const isConstraint = n.id === bottleneck.nodeId

    if (stat.states.down > 0.02) {
      // Si llevara la disponibilidad al 100%, su ciclo efectivo bajaria a lo
      // que es sin paradas.
      const without = c.effectiveMs - c.lossAvailabilityMs
      const gain = gainIf(n.id, without)
      findings.push({
        id: `availability-${n.id}`,
        kind: isConstraint && gain > 0.01 ? 'capacity' : 'cost',
        nodeId: n.id,
        impact: gain > 0.001 ? gain : null,
        measured: false,
        title: {
          es: `"${n.label}" esta parada el ${pct(stat.states.down)} del tiempo`,
          en: `"${n.label}" is down ${pct(stat.states.down)} of the time`,
        },
        detail:
          gain > 0.01
            ? {
                es: `Llevarla al 100% de disponibilidad subiria el throughput de la linea ${pct(gain)}. Es la palanca de capacidad mas barata que tenes: no requiere comprar maquina.`,
                en: `Taking it to 100% availability would lift line throughput by ${pct(gain)}. It is the cheapest capacity lever you have: no new machine required.`,
              }
            : {
                es: `No es la restriccion, asi que arreglar las paradas NO va a dar una sola unidad mas. Vale lo que valga el costo de esas paradas, no la capacidad - y conviene decirlo asi antes de pedir presupuesto.`,
                en: `It is not the constraint, so fixing the downtime will NOT deliver a single extra unit. It is worth whatever the downtime costs, not capacity - and it is worth saying so before asking for budget.`,
              },
      })
    }

    if (c.lossChangeoverMs > 0 && c.lossChangeoverMs / c.effectiveMs > 0.05) {
      const halved = c.effectiveMs - c.lossChangeoverMs / 2
      const gain = gainIf(n.id, halved)
      const share = c.lossChangeoverMs / c.effectiveMs
      findings.push({
        id: `changeover-${n.id}`,
        kind: isConstraint && gain > 0.01 ? 'capacity' : 'cost',
        nodeId: n.id,
        impact: gain > 0.001 ? gain : null,
        measured: false,
        title: {
          es: `El cambio de formato se come el ${pct(share)} de "${n.label}"`,
          en: `Changeover eats ${pct(share)} of "${n.label}"`,
        },
        detail:
          gain > 0.01
            ? {
                es: `Partir el tiempo de cambio al medio (SMED) subiria el throughput ${pct(gain)}. Es la misma maquina, el mismo operario y la misma inversion: solo un cambio mejor preparado.`,
                en: `Halving the changeover (SMED) would lift throughput by ${pct(gain)}. Same machine, same operator, same investment: just a better-prepared changeover.`,
              }
            : {
                es: `No esta en la restriccion, asi que acortar el cambio no va a subir la salida. Donde si paga es en poder hacer lotes mas chicos, y eso baja el lead time y el inventario.`,
                en: `It is not on the constraint, so a shorter changeover will not raise output. Where it does pay is in enabling smaller batches, which cuts lead time and inventory.`,
              },
      })
    }

    if (stat.states.blocked > 0.15) {
      findings.push({
        id: `blocked-${n.id}`,
        kind: 'flow',
        nodeId: n.id,
        impact: null,
        measured: false,
        title: {
          es: `"${n.label}" esta bloqueada el ${pct(stat.states.blocked)} del tiempo`,
          en: `"${n.label}" is blocked ${pct(stat.states.blocked)} of the time`,
        },
        detail: {
          es: 'Termina piezas que no tienen donde ir: esta empujando contra un espacio lleno aguas abajo. Producir mas aca no sirve de nada, y el inventario que genera es puro costo.',
          en: 'It finishes parts with nowhere to go: it is pushing against full space downstream. Producing more here achieves nothing, and the inventory it creates is pure cost.',
        },
      })
    }

    if (stat.states.waitOp > 0.1) {
      findings.push({
        id: `waitop-${n.id}`,
        kind: isConstraint ? 'capacity' : 'cost',
        nodeId: n.id,
        impact: null,
        measured: false,
        title: {
          es: `"${n.label}" espera operario el ${pct(stat.states.waitOp)} del tiempo`,
          en: `"${n.label}" waits for an operator ${pct(stat.states.waitOp)} of the time`,
        },
        detail: {
          es: 'La maquina esta libre y la pieza esta lista: lo que falta es la persona. La restriccion real aca es la dotacion, no el equipo.',
          en: 'The machine is free and the part is ready: what is missing is the person. The real constraint here is staffing, not equipment.',
        },
      })
    }
  }

  // ---------------------------------------------------------- flujo e inventario
  const touchTimeMs = cap.stations.reduce((a, s) => a + s.nominalMs, 0)
  const flowEfficiency =
    result.kpis.leadTimeMean > 0 ? touchTimeMs / result.kpis.leadTimeMean : 0
  const minWip = (result.kpis.throughputPerHour / 3_600_000) * touchTimeMs
  const excessWip = Math.max(0, result.kpis.wipMean - minWip)

  if (steady && flowEfficiency > 0 && flowEfficiency < 0.3) {
    findings.push({
      id: 'flow-efficiency',
      kind: 'flow',
      nodeId: null,
      impact: null,
      measured: false,
      title: {
        es: `Solo el ${pct(flowEfficiency)} del lead time es trabajo real`,
        en: `Only ${pct(flowEfficiency)} of lead time is actual work`,
      },
      detail: {
        es: `Una pieza pasa ${(result.kpis.leadTimeMean / Math.max(1, touchTimeMs)).toFixed(1)} veces mas tiempo esperando que siendo trabajada. Ese ${pct(1 - flowEfficiency)} de espera no agrega valor y no cuesta maquina: se ataca con tamano de lote y control de WIP, no con inversion.`,
        en: `A part spends ${(result.kpis.leadTimeMean / Math.max(1, touchTimeMs)).toFixed(1)}x longer waiting than being worked on. That ${pct(1 - flowEfficiency)} of waiting adds no value and costs no machine: you attack it with batch size and WIP control, not capital.`,
      },
    })
  }

  if (steady && excessWip > 1 && result.kpis.wipMean > 0) {
    findings.push({
      id: 'excess-wip',
      kind: 'flow',
      nodeId: null,
      impact: null,
      measured: false,
      title: {
        es: `Sobran ${excessWip.toFixed(0)} unidades de inventario en proceso`,
        en: `${excessWip.toFixed(0)} units of work in process are surplus`,
      },
      detail: {
        es: `Con el throughput actual, la Ley de Little dice que alcanzaria con ${minWip.toFixed(1)} unidades en la linea; hay ${result.kpis.wipMean.toFixed(1)}. Ese excedente no compra ni una unidad mas de salida: solo alarga el lead time y tapa los problemas.`,
        en: `At current throughput, Little's Law says ${minWip.toFixed(1)} units in the line would be enough; there are ${result.kpis.wipMean.toFixed(1)}. That surplus buys no extra output: it only stretches lead time and hides problems.`,
      },
    })
  }

  // -------------------------------------------------------------- variabilidad
  for (const n of model.nodes) {
    if (n.type !== 'process' || n.params.variability === 'none') continue
    const stat = stations.find((s) => s.nodeId === n.id)
    if (!stat || stat.avgQueue < 2) continue
    // Cola desproporcionada para el nivel de carga: la firma de Kingman.
    const expectedish = stat.utilization / Math.max(0.01, 1 - stat.utilization)
    if (stat.avgQueue > expectedish * 1.5) {
      findings.push({
        id: `variability-${n.id}`,
        kind: 'flow',
        nodeId: n.id,
        impact: null,
        measured: false,
        title: {
          es: `La cola de "${n.label}" es desproporcionada para su carga`,
          en: `The queue at "${n.label}" is out of proportion to its load`,
        },
        detail: {
          es: `Acumula ${stat.avgQueue.toFixed(1)} unidades trabajando al ${pct(stat.utilization)}. No le falta capacidad: le sobra dispersion. Estandarizar el trabajo baja esa cola sin tocar el tiempo de ciclo promedio.`,
          en: `It holds ${stat.avgQueue.toFixed(1)} units while running at ${pct(stat.utilization)}. It is not short of capacity: it has too much spread. Standardising the work cuts that queue without touching the average cycle time.`,
        },
      })
    }
  }

  // Orden: primero lo que mueve el throughput, y dentro de eso por impacto.
  // Con una excepcion que va siempre arriba de todo: el aviso de que el
  // sistema no llego a estado estable. No es el hallazgo de mayor impacto, es
  // el que determina si los demas numeros significan algo.
  const rank: Record<FindingKind, number> = { capacity: 0, flow: 1, cost: 2, info: 3 }
  findings.sort((a, b) => {
    if (a.id === 'not-steady') return -1
    if (b.id === 'not-steady') return 1
    if (rank[a.kind] !== rank[b.kind]) return rank[a.kind] - rank[b.kind]
    return (b.impact ?? -1) - (a.impact ?? -1)
  })

  return { findings, steadyState: steady, flowEfficiency, touchTimeMs, excessWip, capacity: cap }
}
