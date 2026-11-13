/**
 * Punto de entrada del motor: simulate(model, config) -> RunResult.
 *
 * Funcion pura, sin dependencias del DOM. Es lo que permite correr exactamente
 * el mismo codigo dentro de un Web Worker en la app y dentro de Node en los
 * tests contra resultados analiticos.
 */

import { compile } from './core/compile'
import { clampedSamples, type SimTime } from './core/dist'
import { Engine, SliceOutcome } from './core/engine'
import { BufferNode } from './nodes/buffer'
import { InspectionNode } from './nodes/inspection'
import { OperatorNode } from './nodes/operators'
import { ProcessNode } from './nodes/process'
import { SinkNode } from './nodes/sink'
import { SourceNode } from './nodes/source'
import { StatsCollector } from './stats/collector'
import { BucketSeries } from './stats/timeseries'
import { TraceRecorder } from './trace/recorder'
import { MS_PER_UNIT, type RunConfig, type SimModel } from './types/model'
import {
  N_STATES,
  StopReason,
  type Kpis,
  type NodeStats,
  type RunResult,
  type Series,
  type StateBreakdown,
} from './types/results'
import type { TraceChunk } from './types/trace'

const DEFAULT_TRACE_RECORDS = 200_000
const DEFAULT_TRACE_ENTITIES = 2_500

export interface SimulateOptions {
  /** Numero de replica: desplaza la semilla. */
  replication?: number
  /** Devuelve tambien los chunks de traza para la animacion. */
  withTrace?: boolean
}

export interface SimulateOutput {
  result: RunResult
  trace: TraceChunk[]
}

export function simulate(
  model: SimModel,
  config: RunConfig,
  opts: SimulateOptions = {},
): SimulateOutput {
  const rep = opts.replication ?? 0
  const seed = (config.seed + rep) | 0
  const msPerUnit = MS_PER_UNIT[model.line.timeUnit]
  const toMs = (v: number): SimTime => Math.round(v * msPerUnit)

  const compiled = compile(model)
  const horizonMs = config.horizon === null ? null : toMs(config.horizon)
  const warmupMs = toMs(config.warmup)

  // Ancho de bucket de las series: si no hay horizonte, se arranca con una
  // estimacion y la serie se auto-fusiona cuando la corrida la supera.
  const bucketMs = Math.max(1, Math.round((horizonMs ?? 3_600_000) / 400))

  const trace = new TraceRecorder(
    config.trace,
    DEFAULT_TRACE_RECORDS,
    config.trace === 'full' ? DEFAULT_TRACE_ENTITIES : 0,
  )
  const stats = new StatsCollector(compiled.nodes.length, bucketMs, seed)

  const eng = new Engine({
    nodes: compiled.nodes,
    seed,
    horizonMs,
    maxCompletions: config.maxCompletions,
    warmupMs,
    maxEvents: config.maxEvents,
    conwipCap: compiled.conwipCap,
    trace,
    hooks: stats,
  })

  // Series por cola, una por bloque que acumula inventario.
  const queueSeries: Record<string, BucketSeries> = {}
  for (const n of compiled.nodes) {
    if (n instanceof ProcessNode || n instanceof BufferNode || n instanceof InspectionNode) {
      queueSeries[n.id] = new BucketSeries(bucketMs, 0, 0)
    }
  }

  seedInitialInventory(compiled.nodes, eng)
  for (const s of compiled.sources) s.start(eng)

  // Primera activacion de todos los nodos para que el estado inicial sea
  // consistente antes del primer evento.
  for (let i = 0; i < compiled.nodes.length; i++) eng.wake(i)

  while (eng.runSlice(1_000_000) === SliceOutcome.Budget) {
    sampleQueues(compiled.nodes, queueSeries, eng.t)
  }
  sampleQueues(compiled.nodes, queueSeries, eng.t)

  const result = report(model, compiled.nodes, eng, stats, queueSeries, warmupMs)
  return { result, trace: opts.withTrace ? trace.finish() : [] }
}

/** Carga el inventario inicial de los buffers antes de arrancar el reloj. */
function seedInitialInventory(nodes: readonly unknown[], eng: Engine): void {
  for (const n of nodes) {
    if (!(n instanceof BufferNode)) continue
    for (let k = 0; k < n.initial; k++) {
      if (!eng.canAdmit()) break
      const e = eng.pool.acquire(0)
      eng.admit(e)
      n.inbox.seed(e)
    }
  }
}

function sampleQueues(
  nodes: readonly unknown[],
  series: Record<string, BucketSeries>,
  t: SimTime,
): void {
  for (const n of nodes) {
    if (n instanceof ProcessNode || n instanceof InspectionNode) {
      series[n.id]?.set(t, n.inbox.level())
    } else if (n instanceof BufferNode) {
      series[n.id]?.set(t, n.inbox.level())
    }
  }
}

function breakdown(times: Float64Array, window: number): StateBreakdown {
  const d = window > 0 ? window : 1
  return {
    starved: times[0]! / d,
    setup: times[1]! / d,
    busy: times[2]! / d,
    blocked: times[3]! / d,
    waitOp: times[4]! / d,
    down: times[5]! / d,
  }
}

function report(
  model: SimModel,
  nodes: readonly unknown[],
  eng: Engine,
  stats: StatsCollector,
  queueSeries: Record<string, BucketSeries>,
  warmupMs: SimTime,
): RunResult {
  const tEnd = eng.t
  const window = Math.max(1, tEnd - Math.max(warmupMs, stats.measureStart))

  const nodeStats: NodeStats[] = []
  for (const n of nodes) {
    if (n instanceof ProcessNode) {
      const times = n.stateTimes()
      const b = breakdown(times, window)
      nodeStats.push({
        nodeId: n.id,
        label: n.label,
        type: 'process',
        states: b,
        utilization: b.busy,
        avgQueue: n.avgQueue(tEnd),
        maxQueue: n.maxQueue(),
        avgStageWip: n.avgStageWip(tEnd),
        avgQueueWait: n.avgQueueWait(),
        processed: n.processed,
        scrapped: n.scrappedCount,
        failures: n.failures,
      })
    } else if (n instanceof InspectionNode) {
      const times = n.stateTimes()
      const b = breakdown(times, window)
      nodeStats.push({
        nodeId: n.id,
        label: n.label,
        type: 'inspection',
        states: b,
        utilization: b.busy,
        avgQueue: n.avgQueue(tEnd),
        maxQueue: n.maxQueue(),
        avgStageWip: n.avgQueue(tEnd),
        avgQueueWait: 0,
        processed: n.passed,
        scrapped: n.scrappedCount,
        failures: 0,
      })
    } else if (n instanceof BufferNode) {
      nodeStats.push({
        nodeId: n.id,
        label: n.label,
        type: 'buffer',
        states: breakdown(new Float64Array(N_STATES), window),
        utilization: 0,
        avgQueue: n.avgLevel(tEnd),
        maxQueue: n.maxLevel(),
        avgStageWip: n.avgLevel(tEnd),
        avgQueueWait: 0,
        processed: 0,
        scrapped: 0,
        failures: 0,
      })
    } else if (n instanceof OperatorNode) {
      const u = n.utilization(tEnd)
      nodeStats.push({
        nodeId: n.id,
        label: n.label,
        type: 'operators',
        states: { starved: 1 - u, setup: 0, busy: u, blocked: 0, waitOp: 0, down: 0 },
        utilization: u,
        avgQueue: 0,
        maxQueue: 0,
        avgStageWip: 0,
        avgQueueWait: 0,
        processed: 0,
        scrapped: 0,
        failures: 0,
      })
    }
  }

  let unmet = 0
  for (const n of nodes) {
    if (n instanceof SourceNode) unmet += n.backlog + n.lost
  }
  let received = 0
  for (const n of nodes) {
    if (n instanceof SinkNode) received += n.received
  }

  const hours = window / 3_600_000
  const ltMean = stats.leadTime.n > 0 ? stats.leadTime.mean : 0
  const wipMean = stats.wipTw.mean(tEnd)
  const throughputPerHour = hours > 0 ? eng.completions / hours : 0
  // Little: L = lambda * W. Es a la vez una leccion y un auto-test: un desvio
  // grande casi siempre delata un rebase de calentamiento mal hecho, unidades
  // sin terminar contadas en el lead time, o una confusion de unidades.
  const lambdaPerMs = window > 0 ? eng.completions / window : 0
  const lambdaW = lambdaPerMs * ltMean

  const kpis: Kpis = {
    throughputPerHour,
    completions: eng.completions,
    scrapped: eng.scrapped,
    released: eng.released,
    inSystemAtEnd: eng.heldUnits(),
    unmetDemand: unmet,
    leadTimeMean: ltMean,
    leadTimeSd: stats.leadTime.sd(),
    leadTimeP50: stats.leadHist.quantile(0.5),
    leadTimeP90: stats.leadHist.quantile(0.9),
    leadTimeP95: stats.leadHist.quantile(0.95),
    leadTimeMin: Number.isFinite(stats.leadTime.min) ? stats.leadTime.min : 0,
    leadTimeMax: Number.isFinite(stats.leadTime.max) ? stats.leadTime.max : 0,
    wipMean,
    wipMax: stats.wipTw.max,
    littleL: wipMean,
    littleLambdaW: lambdaW,
    littleError: wipMean > 0 ? Math.abs(wipMean - lambdaW) / wipMean : 0,
    measureWindowMs: window,
  }

  const qs: Record<string, Series> = {}
  for (const [id, s] of Object.entries(queueSeries)) qs[id] = s.toJSON(tEnd)

  const out: RunResult = {
    stopReason: eng.stopReason,
    truncated: eng.truncated,
    simTimeMs: tEnd,
    eventCount: eng.eventCount,
    kpis,
    nodes: nodeStats,
    leadTimeHistogram: stats.leadHist.toJSON(),
    wipSeries: stats.wipSeries.toJSON(tEnd),
    queueSeries: qs,
    leadTimeSample: stats.leadSample.values(),
    clampedSamples,
  }
  if (eng.stopReason === StopReason.Deadlock) out.waitReasons = eng.waitReasons()
  void model
  void received
  return out
}
