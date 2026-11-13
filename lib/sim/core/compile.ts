/**
 * Compilacion: SimModel -> grafo de runtime indexado por array.
 *
 * Tres responsabilidades, y las tres son fuente de bugs si se hacen en otro
 * lado:
 *  1. Asignar INDICES deterministas (orden por id, estable), porque ninguna
 *     decision de orden del motor puede depender de iterar una estructura.
 *  2. Convertir a milisegundos enteros EXACTAMENTE UNA VEZ. `line.timeUnit` es
 *     presentacion; adentro del motor no existe otra unidad.
 *  3. Resolver la herencia de las palancas de linea: que significan push,
 *     kanban y conwip en terminos de capacidades concretas.
 */

import { deterministic, exponential, makeArrival, makeDuration } from './dist'
import type { NodeRuntime } from './runtime'
import { BufferNode } from '../nodes/buffer'
import { InspectionNode } from '../nodes/inspection'
import { OperatorNode } from '../nodes/operators'
import { ProcessNode } from '../nodes/process'
import { SinkNode } from '../nodes/sink'
import { SourceNode } from '../nodes/source'
import {
  MS_PER_UNIT,
  UNLIMITED,
  type ProcessParams,
  type SimModel,
  type SimNode,
} from '../types/model'

export interface Compiled {
  nodes: NodeRuntime[]
  sources: SourceNode[]
  /** null = sin control CONWIP. */
  conwipCap: number | null
  indexOf: Record<string, number>
  /** Milisegundos por unidad de tiempo del modelo. */
  msPerUnit: number
}

/** Deriva el MTBF a partir de la disponibilidad: A = MTBF / (MTBF + MTTR). */
export function mtbfFromAvailability(availability: number, mttrMs: number): number | null {
  if (availability >= 1 || availability <= 0) return null
  if (mttrMs <= 0) return null
  return (mttrMs * availability) / (1 - availability)
}

export function compile(model: SimModel): Compiled {
  const msPerUnit = MS_PER_UNIT[model.line.timeUnit]
  const toMs = (v: number): number => Math.round(v * msPerUnit)

  // Orden estable por id: agregar o reordenar nodos en el array del modelo no
  // debe cambiar un solo numero del resultado.
  const sorted = [...model.nodes].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const indexOf: Record<string, number> = {}
  sorted.forEach((n, i) => {
    indexOf[n.id] = i
  })

  const flow = model.line.flowControl
  const conwipCap = flow === 'conwip' ? Math.max(1, Math.floor(model.line.wipLimit)) : null

  // Herencia de las palancas de linea.
  const stageCards = (p: ProcessParams | null): number => {
    if (flow !== 'kanban') return UNLIMITED
    const own = p?.kanbanCards
    return Math.max(1, Math.floor(own ?? model.line.wipLimit))
  }

  const nodes: NodeRuntime[] = []
  const sources: SourceNode[] = []
  const operatorNodes: Record<string, OperatorNode> = {}

  sorted.forEach((n, idx) => {
    const built = buildNode(n, idx, model, toMs, stageCards, flow)
    nodes.push(built)
    if (built instanceof SourceNode) sources.push(built)
    if (built instanceof OperatorNode) operatorNodes[n.id] = built
  })

  // Aristas en orden estable por id, para que el orden de sucesores (y por lo
  // tanto el desempate del ruteo) sea reproducible.
  const edges = [...model.edges].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const weightsBySource: Record<number, number[]> = {}
  const hasWeight: Record<number, boolean> = {}

  for (const e of edges) {
    const si = indexOf[e.source]
    const ti = indexOf[e.target]
    if (si === undefined || ti === undefined) continue
    if (e.params?.kind === 'rework') continue // el retrabajo se rutea aparte
    const src = nodes[si]!
    const dst = nodes[ti]!
    src.successors.push(ti)
    dst.predecessors.push(si)
    if ('moveMs' in src) {
      ;(src as unknown as { moveMs: number[] }).moveMs.push(toMs(e.params?.moveTime ?? 0))
    }
    const w = e.params?.weight
    weightsBySource[si] ??= []
    weightsBySource[si]!.push(w ?? 0)
    if (w !== undefined) hasWeight[si] = true
  }

  // Regla de ruteo: probabilistica si el modelo trae pesos, cola mas corta si no.
  for (const [siStr, ws] of Object.entries(weightsBySource)) {
    const si = Number(siStr)
    const node = nodes[si]!
    if (!('routingRule' in node)) continue
    const target = node as unknown as { routingRule: string; weights: number[] }
    if (hasWeight[si]) {
      const total = ws.reduce((a, b) => a + b, 0)
      target.routingRule = 'probability'
      target.weights = total > 0 ? ws.map((w) => w / total) : ws.map(() => 1 / ws.length)
    } else {
      target.routingRule = 'shortest-queue'
    }
  }

  // Enlaces por referencia que no se pueden resolver durante la construccion.
  sorted.forEach((n, idx) => {
    if (n.type === 'process' && n.params.operatorPool) {
      const pool = operatorNodes[n.params.operatorPool]
      if (pool) (nodes[idx] as ProcessNode).opPool = pool
    }
    if (n.type === 'inspection') {
      const insp = nodes[idx] as InspectionNode
      // Destino de retrabajo: primero el declarado en los parametros, si no la
      // arista marcada como 'rework' que sale de este nodo.
      const explicit = n.params.reworkTarget ? indexOf[n.params.reworkTarget] : undefined
      if (explicit !== undefined) {
        insp.reworkTarget = explicit
      } else {
        const re = edges.find((e) => e.source === n.id && e.params?.kind === 'rework')
        const ti = re ? indexOf[re.target] : undefined
        insp.reworkTarget = ti ?? -1
      }
    }
  })

  return { nodes, sources, conwipCap, indexOf, msPerUnit }
}

function buildNode(
  n: SimNode,
  idx: number,
  model: SimModel,
  toMs: (v: number) => number,
  stageCards: (p: ProcessParams | null) => number,
  flow: string,
): NodeRuntime {
  const lineTb = Math.max(1, Math.floor(model.line.transferBatch))

  switch (n.type) {
    case 'source': {
      // En modo pull la entrada se fuerza a ilimitada: la materia prima
      // siempre esta, asi la restriccion la fija la linea y no la entrada.
      const mode = flow === 'push' ? n.params.mode : 'unlimited'
      return new SourceNode({
        idx,
        id: n.id,
        label: n.label,
        mode,
        arrivalDist: makeArrival(toMs(n.params.interval), n.params.variability),
        maxUnits: n.params.maxUnits,
        unsatisfiedDemand: n.params.unsatisfiedDemand,
      })
    }

    case 'process': {
      const p = n.params
      const mttrMs = toMs(p.mttr)
      const mtbfMs = mtbfFromAvailability(p.availability, mttrMs)
      return new ProcessNode({
        idx,
        id: n.id,
        label: n.label,
        transferBatch: Math.max(1, Math.floor(p.transferBatch ?? lineTb)),
        processBatch: Math.max(1, Math.floor(p.processBatch)),
        batchMode: p.batchMode,
        servers: Math.max(1, Math.floor(p.servers)),
        queueCap: p.queueCapacity === null ? UNLIMITED : Math.max(1, p.queueCapacity),
        kanbanCards: stageCards(p),
        scrapRate: clamp01(p.scrapRate),
        operators: Math.max(0, Math.floor(p.operators)),
        serviceDist: makeDuration(toMs(p.cycleTime), p.variability),
        // El changeover se modela deterministico: es un procedimiento
        // estandarizado, y mantenerlo sin ruido deja limpio el argumento SMED.
        setupDist: deterministic(toMs(p.changeoverTime)),
        mtbfDist: mtbfMs === null ? null : exponential(mtbfMs),
        repairDist: exponential(Math.max(1, mttrMs)),
      })
    }

    case 'buffer':
      return new BufferNode({
        idx,
        id: n.id,
        label: n.label,
        capacity: n.params.capacity === null ? UNLIMITED : Math.max(1, n.params.capacity),
        transferBatch: lineTb,
        initial: Math.max(0, Math.floor(n.params.initial)),
      })

    case 'inspection': {
      const p = n.params
      return new InspectionNode({
        idx,
        id: n.id,
        label: n.label,
        transferBatch: lineTb,
        queueCap: UNLIMITED,
        kanbanCards: stageCards(null),
        yieldRate: clamp01(p.yield),
        inspectDist: makeDuration(toMs(p.inspectTime), p.variability),
        onFail: p.onFail,
        reworkTarget: -1, // se resuelve despues de indexar todos los nodos
        maxRework: Math.max(0, Math.floor(p.maxRework)),
      })
    }

    case 'sink':
      return new SinkNode(idx, n.id, n.label)

    case 'operators':
      return new OperatorNode(idx, n.id, n.label, Math.max(1, Math.floor(n.params.count)))
  }
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}
