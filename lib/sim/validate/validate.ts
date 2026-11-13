/**
 * Validacion del modelo antes de correr.
 *
 * Funcion pura, rapida (<1 ms en modelos de 25 nodos), para correr con debounce
 * en cada cambio del canvas y otra vez en el worker antes de simular.
 *
 * Los errores bloquean la corrida; los avisos no. La diferencia importa: un
 * modelo que deadlockea bajo pull puede ser EXACTAMENTE lo que el usuario
 * quiere mostrar, asi que eso es un aviso y no un error.
 */

import { capacityCheck } from './capacityCheck'
import { CV_OF, type SimModel } from '../types/model'

export type Severity = 'error' | 'warning' | 'info'

export interface ValidationIssue {
  code: string
  severity: Severity
  /** Mensaje para el usuario, en espanol. */
  message: string
  nodeIds?: string[]
  edgeIds?: string[]
}

export function validate(model: SimModel): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const err = (code: string, message: string, nodeIds?: string[], edgeIds?: string[]) =>
    issues.push({ code, severity: 'error', message, nodeIds, edgeIds })
  const warn = (code: string, message: string, nodeIds?: string[], edgeIds?: string[]) =>
    issues.push({ code, severity: 'warning', message, nodeIds, edgeIds })

  const byId = new Map(model.nodes.map((n) => [n.id, n]))
  const sources = model.nodes.filter((n) => n.type === 'source')
  const sinks = model.nodes.filter((n) => n.type === 'sink')

  // --- estructura del grafo ---
  if (sources.length === 0) err('NO_SOURCE', 'El modelo no tiene ninguna Entrada.')
  if (sinks.length === 0) err('NO_SINK', 'El modelo no tiene ninguna Salida.')

  const succ = new Map<string, string[]>()
  const pred = new Map<string, string[]>()
  const seenEdge = new Set<string>()

  for (const e of model.edges) {
    if (!byId.has(e.source) || !byId.has(e.target)) {
      err('EDGE_DANGLING', 'Hay una conexion que apunta a un bloque inexistente.', undefined, [e.id])
      continue
    }
    if (e.source === e.target) {
      err('SELF_LOOP', `"${byId.get(e.source)!.label}" esta conectado a si mismo.`, [e.source], [e.id])
      continue
    }
    const key = `${e.source}->${e.target}`
    if (seenEdge.has(key)) {
      err('DUPLICATE_EDGE', 'Hay dos conexiones iguales entre los mismos bloques.', undefined, [e.id])
      continue
    }
    seenEdge.add(key)
    if (byId.get(e.target)!.type === 'source') {
      err('EDGE_INTO_SOURCE', 'Una Entrada no puede recibir material.', [e.target], [e.id])
    }
    if (byId.get(e.source)!.type === 'sink') {
      err('EDGE_OUT_OF_SINK', 'Una Salida no puede entregar material.', [e.source], [e.id])
    }
    succ.set(e.source, [...(succ.get(e.source) ?? []), e.target])
    pred.set(e.target, [...(pred.get(e.target) ?? []), e.source])
  }

  const material = model.nodes.filter((n) => n.type !== 'operators')
  const reachable = bfs(sources.map((s) => s.id), (id) => succ.get(id) ?? [])
  const coreachable = bfs(sinks.map((s) => s.id), (id) => pred.get(id) ?? [])

  for (const n of material) {
    if (n.type !== 'source' && !reachable.has(n.id)) {
      err('UNREACHABLE_FROM_SOURCE', `"${n.label}" no recibe material de ninguna Entrada.`, [n.id])
    }
    if (n.type !== 'sink' && !coreachable.has(n.id)) {
      err('CANNOT_REACH_SINK', `"${n.label}" no tiene camino hacia una Salida.`, [n.id])
    }
  }

  // --- parametros por bloque ---
  const lineTb = Math.max(1, Math.floor(model.line.transferBatch))
  const operatorIds = new Set(model.nodes.filter((n) => n.type === 'operators').map((n) => n.id))

  for (const n of model.nodes) {
    if (n.type === 'process') {
      const p = n.params
      if (p.cycleTime <= 0) {
        err('CYCLE_TIME_NOT_POSITIVE', `"${n.label}" tiene tiempo de ciclo cero o negativo.`, [n.id])
      }
      if (p.availability <= 0 || p.availability > 1) {
        err('AVAILABILITY_RANGE', `La disponibilidad de "${n.label}" tiene que estar entre 0 y 100%.`, [n.id])
      }
      if (p.scrapRate < 0 || p.scrapRate >= 1) {
        err('SCRAP_RANGE', `El scrap de "${n.label}" tiene que estar entre 0 y 100%.`, [n.id])
      }
      if (p.availability < 1 && p.mttr <= 0) {
        warn(
          'AVAILABILITY_NO_MTTR',
          `"${n.label}" tiene disponibilidad menor al 100% pero no tiene duracion de parada: no se van a simular paradas.`,
          [n.id],
        )
      }
      if (p.servers < 1) err('SERVERS_RANGE', `"${n.label}" tiene menos de una maquina.`, [n.id])
      if (p.queueCapacity !== null && p.queueCapacity < p.processBatch) {
        err(
          'BATCH_EXCEEDS_CAPACITY',
          `"${n.label}" tiene un lote de proceso de ${p.processBatch} pero su cola solo admite ${p.queueCapacity}: nunca va a poder arrancar.`,
          [n.id],
        )
      }
      if (p.operatorPool !== null && !operatorIds.has(p.operatorPool)) {
        err('OPERATOR_POOL_MISSING', `"${n.label}" apunta a un pool de operarios que no existe.`, [n.id])
      }
      if ((succ.get(n.id) ?? []).length === 0) {
        err('PROCESS_NO_OUTPUT', `"${n.label}" no entrega a ningun lado.`, [n.id])
      }
      if ((pred.get(n.id) ?? []).length === 0) {
        err('PROCESS_NO_INPUT', `"${n.label}" no recibe de ningun lado.`, [n.id])
      }
    }

    if (n.type === 'buffer' && n.params.capacity !== null && n.params.capacity < 1) {
      err('CAPACITY_ZERO', `"${n.label}" tiene capacidad cero.`, [n.id])
    }

    if (n.type === 'inspection') {
      const p = n.params
      if (p.yield <= 0) {
        err('YIELD_ZERO', `"${n.label}" rechaza el 100%: nunca va a salir nada.`, [n.id])
      } else if (p.yield > 1) {
        err('YIELD_RANGE', `El rendimiento de "${n.label}" no puede superar el 100%.`, [n.id])
      }
      if (p.onFail === 'rework' && p.reworkTarget === null) {
        const hasReworkEdge = model.edges.some((e) => e.source === n.id && e.params?.kind === 'rework')
        if (!hasReworkEdge) {
          err('REWORK_NO_TARGET', `"${n.label}" manda a retrabajo pero no tiene destino de retrabajo.`, [n.id])
        }
      }
    }

    if (n.type === 'source') {
      const p = n.params
      if (p.mode !== 'unlimited' && p.interval <= 0 && p.maxUnits === null) {
        err(
          'SOURCE_RUNAWAY',
          `"${n.label}" libera con intervalo cero y sin tope de unidades: la corrida no termina nunca.`,
          [n.id],
        )
      }
    }
  }

  // --- palancas de linea ---
  if (model.line.flowControl !== 'push') {
    const cap = Math.floor(model.line.wipLimit)
    if (cap < 1) {
      err('WIP_LIMIT_RANGE', 'El tope de WIP tiene que ser al menos 1.')
    } else {
      const maxBatch = Math.max(
        lineTb,
        ...model.nodes.map((n) => (n.type === 'process' ? n.params.processBatch : 1)),
      )
      if (cap < maxBatch) {
        err(
          'PULL_CAP_BELOW_BATCH',
          `El tope de WIP (${cap}) es menor que el lote mas grande (${maxBatch}): la linea se traba en el instante cero.`,
        )
      }
    }
    if (hasCycle(model.nodes.map((n) => n.id), succ)) {
      warn(
        'CYCLE_UNDER_PULL',
        'Hay un bucle en el flujo con control de WIP activo. Puede trabarse: si pasa, te vamos a mostrar exactamente que esta esperando cada bloque.',
      )
    }
  }

  // --- capacidad estatica ---
  const cap = capacityCheck(model)
  for (const s of cap.stations) {
    if (s.rho === null) continue
    if (s.rho >= 1) {
      warn(
        'OVERLOADED_STATION',
        `"${s.label}" necesita ${fmt(s.effectiveMs)} por unidad y el takt es ${fmt(cap.taktMs!)}: no da la demanda y la cola va a crecer sin techo.`,
        [s.nodeId],
      )
    } else if (s.rho > 0.9) {
      warn(
        'STATION_NEAR_CAPACITY',
        `"${s.label}" trabaja al ${(s.rho * 100).toFixed(0)}% de su capacidad: a partir de ahi cualquier variabilidad dispara la cola.`,
        [s.nodeId],
      )
    }
  }

  // --- configuracion de la corrida ---
  const run = model.defaults
  const anyVariability = model.nodes.some(
    (n) =>
      (n.type === 'process' && CV_OF[n.params.variability] > 0) ||
      (n.type === 'source' && CV_OF[n.params.variability] > 0) ||
      (n.type === 'process' && n.params.availability < 1),
  )
  if (anyVariability && run.warmup <= 0) {
    warn(
      'NO_WARMUP_WITH_VARIABILITY',
      'El modelo tiene variabilidad pero no descarta periodo de calentamiento: el arranque en vacio va a ensuciar los promedios.',
    )
  }
  if (anyVariability && run.replications <= 1) {
    warn(
      'SINGLE_REPLICATION',
      'Una sola replica con variabilidad: los numeros son una muestra, no un promedio. Para comparar escenarios conviene subir las replicas.',
    )
  }

  return issues
}

export function hasErrors(issues: readonly ValidationIssue[]): boolean {
  return issues.some((i) => i.severity === 'error')
}

function bfs(roots: string[], next: (id: string) => string[]): Set<string> {
  const seen = new Set<string>(roots)
  const stack = [...roots]
  while (stack.length > 0) {
    const id = stack.pop()!
    for (const n of next(id)) {
      if (!seen.has(n)) {
        seen.add(n)
        stack.push(n)
      }
    }
  }
  return seen
}

function hasCycle(ids: string[], succ: Map<string, string[]>): boolean {
  const WHITE = 0
  const GREY = 1
  const BLACK = 2
  const color = new Map(ids.map((id) => [id, WHITE]))
  const visit = (id: string): boolean => {
    color.set(id, GREY)
    for (const n of succ.get(id) ?? []) {
      const c = color.get(n)
      if (c === GREY) return true
      if (c === WHITE && visit(n)) return true
    }
    color.set(id, BLACK)
    return false
  }
  for (const id of ids) {
    if (color.get(id) === WHITE && visit(id)) return true
  }
  return false
}

function fmt(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(0)} ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`
  return `${(ms / 60_000).toFixed(1)} min`
}
