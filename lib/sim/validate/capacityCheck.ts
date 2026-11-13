/**
 * Chequeo estatico de capacidad: SIN simular.
 *
 * Con la demanda y el data box de cada estacion alcanza para saber si la linea
 * da o no da. Esto no es un warning escondido: es la primera pantalla que se
 * le muestra a un cliente. Un grafico de barras de tiempo de ciclo efectivo
 * por estacion con la linea de takt cruzandolo ES la leccion de balanceo de
 * linea, y esta disponible antes de apretar Run.
 *
 * El tiempo de ciclo EFECTIVO no es el que figura en el tablero de la maquina:
 *
 *   te = (ciclo_por_unidad + changeover/lote) / (disponibilidad * maquinas)
 *
 * y ademas la estacion i tiene que procesar MAS unidades de las que salen,
 * porque aguas abajo se descarta parte. De ahi el factor de scrap acumulado.
 */

import { MS_PER_UNIT, type ProcessParams, type SimModel } from '../types/model'

export interface StationCapacity {
  nodeId: string
  label: string
  /** Tiempo de ciclo nominal por unidad, en ms. */
  nominalMs: number
  /** Tiempo de ciclo efectivo por unidad buena, en ms. */
  effectiveMs: number
  /** Unidades que debe procesar por cada unidad buena que sale de la linea. */
  scrapInflation: number
  /** Utilizacion prevista. null si la demanda es ilimitada. */
  rho: number | null
  /** Capacidad maxima, unidades por hora. */
  capacityPerHour: number
  /** Desglose de donde se va el tiempo, en ms por unidad. */
  lossChangeoverMs: number
  lossAvailabilityMs: number
  lossScrapMs: number
}

export interface CapacityReport {
  /** Takt en ms por unidad. null si la entrada es ilimitada. */
  taktMs: number | null
  /** Demanda en unidades por hora. null si la entrada es ilimitada. */
  demandPerHour: number | null
  stations: StationCapacity[]
  /** Id de la estacion con mayor tiempo de ciclo efectivo. */
  bottleneckId: string | null
  /** Capacidad de la linea, unidades por hora (la del cuello de botella). */
  lineCapacityPerHour: number
  /** true si alguna estacion no llega al takt. */
  infeasible: boolean
}

export function capacityCheck(model: SimModel): CapacityReport {
  const msPerUnit = MS_PER_UNIT[model.line.timeUnit]
  const toMs = (v: number): number => v * msPerUnit

  const processes = model.nodes.filter(
    (n): n is Extract<typeof n, { type: 'process' }> => n.type === 'process',
  )

  // Demanda: solo esta definida si la entrada tiene reloj propio.
  let taktMs: number | null = null
  for (const n of model.nodes) {
    if (n.type !== 'source') continue
    if (n.params.mode !== 'unlimited' && n.params.interval > 0) {
      taktMs = toMs(n.params.interval)
    }
  }
  // En modo pull la entrada se fuerza a ilimitada, asi que no hay takt externo.
  if (model.line.flowControl !== 'push') taktMs = null

  // Inflacion por scrap: la estacion i debe procesar 1 / prod(1 - scrap_j)
  // unidades por cada buena que sale, con j desde i hasta el final.
  const inflation: number[] = new Array(processes.length).fill(1)
  let acc = 1
  for (let i = processes.length - 1; i >= 0; i--) {
    const p = processes[i]!.params
    acc = acc / Math.max(1e-9, 1 - clamp01(p.scrapRate))
    inflation[i] = acc
  }

  const stations: StationCapacity[] = processes.map((n, i) => {
    const p: ProcessParams = n.params
    const pb = Math.max(1, Math.floor(p.processBatch))
    const servers = Math.max(1, Math.floor(p.servers))
    const avail = p.availability <= 0 ? 1 : Math.min(1, p.availability)

    // En un horno el tiempo es del lote, no de la unidad.
    const perUnit = p.batchMode === 'simultaneous' ? toMs(p.cycleTime) / pb : toMs(p.cycleTime)
    const changeoverPerUnit = toMs(p.changeoverTime) / pb
    const beforeAvail = (perUnit + changeoverPerUnit) / servers
    const afterAvail = beforeAvail / avail
    const effective = afterAvail * inflation[i]!

    return {
      nodeId: n.id,
      label: n.label,
      nominalMs: perUnit / servers,
      effectiveMs: effective,
      scrapInflation: inflation[i]!,
      rho: taktMs !== null && taktMs > 0 ? effective / taktMs : null,
      capacityPerHour: effective > 0 ? 3_600_000 / effective : 0,
      lossChangeoverMs: changeoverPerUnit / servers,
      lossAvailabilityMs: afterAvail - beforeAvail,
      lossScrapMs: effective - afterAvail,
    }
  })

  // Cuello de botella, SOLO si hay uno de verdad. En una linea pareja todas
  // las estaciones empatan, y nombrar la primera por orden de array manda a
  // mejorar donde no hay nada que ganar - que es exactamente el error que la
  // herramienta existe para evitar.
  const sorted = [...stations].sort((a, b) => b.effectiveMs - a.effectiveMs)
  const worst = sorted[0]?.effectiveMs ?? -1
  const second = sorted[1]?.effectiveMs
  const TIE = 0.02
  const isTie = second !== undefined && worst > 0 && (worst - second) / worst < TIE
  const bottleneckId = sorted.length > 0 && !isTie ? sorted[0]!.nodeId : null

  return {
    taktMs,
    demandPerHour: taktMs !== null && taktMs > 0 ? 3_600_000 / taktMs : null,
    stations,
    bottleneckId,
    lineCapacityPerHour: worst > 0 ? 3_600_000 / worst : 0,
    infeasible: stations.some((s) => s.rho !== null && s.rho >= 1),
  }
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}
