/**
 * Runner del motor.
 *
 * Expone dos formas de correr el mismo codigo:
 *
 *   simulate()   - de una, para tests y corridas cortas.
 *   compileRun() - paso a paso, para que el Web Worker pueda CEDER el event
 *                  loop entre tandas de eventos y atender un cancel sin
 *                  SharedArrayBuffer (que exigiria headers COOP/COEP y
 *                  complicaria el deploy en Vercel).
 *
 * Funcion pura, sin DOM: los mismos archivos corren en el worker y en Node.
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
/** Eventos por tanda: unos 10 ms de trabajo antes de ceder el event loop. */
const SLICE_EVENTS = 50_000

export interface SimulateOptions {
  /** Numero de replica: desplaza la semilla. */
  replication?: number
  /** Graba tambien la traza para la animacion. */
  withTrace?: boolean
}

export interface SimulateOutput {
  result: RunResult
  trace: TraceChunk[]
}

export class SimRun {
  private readonly eng: Engine
  private readonly stats: StatsCollector
  private readonly trace: TraceRecorder
  private readonly queueSeries: Record<string, BucketSeries> = {}
  private readonly warmupMs: SimTime
  private readonly horizonMs: SimTime | null
  private readonly maxCompletions: number | null
  private readonly nodes: readonly unknown[]
  private readonly model: SimModel
  private done = false
  private cached: RunResult | null = null

  constructor(model: SimModel, config: RunConfig, opts: SimulateOptions = {}) {
    this.model = model
    const rep = opts.replication ?? 0
    const seed = (config.seed + rep) | 0
    const msPerUnit = MS_PER_UNIT[model.line.timeUnit]
    const toMs = (v: number): SimTime => Math.round(v * msPerUnit)

    const compiled = compile(model)
    this.horizonMs = config.horizon === null ? null : toMs(config.horizon)
    this.warmupMs = toMs(config.warmup)
    this.maxCompletions = config.maxCompletions

    // Ancho de bucket de las series: si no hay horizonte se arranca con una
    // estimacion y la serie se auto-fusiona cuando la corrida la supera.
    const bucketMs = Math.max(1, Math.round((this.horizonMs ?? 3_600_000) / 400))

    this.trace = new TraceRecorder(
      opts.withTrace ? config.trace : 'none',
      DEFAULT_TRACE_RECORDS,
      config.trace === 'full' ? DEFAULT_TRACE_ENTITIES : 0,
    )
    this.stats = new StatsCollector(compiled.nodes.length, bucketMs, seed)

    this.eng = new Engine({
      nodes: compiled.nodes,
      seed,
      horizonMs: this.horizonMs,
      maxCompletions: config.maxCompletions,
      warmupMs: this.warmupMs,
      maxEvents: config.maxEvents,
      conwipCap: compiled.conwipCap,
      trace: this.trace,
      hooks: this.stats,
    })
    this.nodes = compiled.nodes

    for (const n of compiled.nodes) {
      if (n instanceof ProcessNode || n instanceof BufferNode || n instanceof InspectionNode) {
        this.queueSeries[n.id] = new BucketSeries(bucketMs, 0, 0)
      }
    }

    seedInitialInventory(compiled.nodes, this.eng)
    for (const s of compiled.sources) s.start(this.eng)
    // Primera activacion de todos los nodos, para que el estado inicial sea
    // consistente antes del primer evento.
    for (let i = 0; i < compiled.nodes.length; i++) this.eng.wake(i)
  }

  /** Corre una tanda. Devuelve true si todavia queda trabajo. */
  step(): boolean {
    if (this.done) return false
    const outcome = this.eng.runSlice(SLICE_EVENTS)
    sampleQueues(this.nodes, this.queueSeries, this.eng.t)
    if (outcome === SliceOutcome.Budget) return true
    this.done = true
    return false
  }

  /** Corre hasta el final sin ceder. */
  runToCompletion(): void {
    while (this.step()) {
      /* sigue */
    }
  }

  /** 0..1. Aproximado: usa el criterio de parada que este configurado. */
  progress(): number {
    if (this.done) return 1
    if (this.maxCompletions !== null && this.maxCompletions > 0) {
      return Math.min(1, this.eng.completions / this.maxCompletions)
    }
    if (this.horizonMs !== null && this.horizonMs > 0) {
      return Math.min(1, this.eng.t / this.horizonMs)
    }
    return 0
  }

  simTimeMs(): SimTime {
    return this.eng.t
  }

  completions(): number {
    return this.eng.completions
  }

  finish(): RunResult {
    this.runToCompletion()
    sampleQueues(this.nodes, this.queueSeries, this.eng.t)
    this.cached ??= report(this.model, this.nodes, this.eng, this.stats, this.queueSeries, this.warmupMs)
    return this.cached
  }

  traceChunks(): TraceChunk[] {
    return this.trace.finish()
  }
}

export function compileRun(
  model: SimModel,
  config: RunConfig,
  opts: SimulateOptions = {},
): SimRun {
  return new SimRun(model, config, opts)
}

export function simulate(
  model: SimModel,
  config: RunConfig,
  opts: SimulateOptions = {},
): SimulateOutput {
  const run = new SimRun(model, config, opts)
  const result = run.finish()
  return { result, trace: opts.withTrace ? run.traceChunks() : [] }
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
