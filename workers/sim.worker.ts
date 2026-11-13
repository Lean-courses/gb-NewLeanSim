/**
 * Worker de simulacion.
 *
 * Fino a proposito: despacha mensajes, trocea la corrida y cede el event loop.
 * Toda la logica vive en lib/sim, que no toca ningun global del browser y por
 * eso corre igual aca y en Node bajo los tests.
 *
 * CANCELACION SIN SharedArrayBuffer: SharedArrayBuffer exige headers COOP/COEP
 * que complican el deploy en Vercel y rompen embeds. En su lugar, troceado
 * cooperativo: se corren ~50k eventos (unos 10 ms) y se cede con MessageChannel,
 * que da una macrotarea con ~0,1 ms de overhead, a diferencia del clamp de 4 ms
 * de setTimeout(0). En esa cesion llegan los mensajes de cancel.
 */

import { compileRun } from '@/lib/sim/run'
import { validate } from '@/lib/sim/validate/validate'
import { sensitivity } from '@/lib/sim/diagnose/sensitivity'
import type { FromWorker, RunVariant, ToWorker } from '@/lib/sim/types/protocol'
import type { RunResult } from '@/lib/sim/types/results'

const cancelled = new Set<string>()

const post = (m: FromWorker): void => {
  ;(self as unknown as DedicatedWorkerGlobalScope).postMessage(m)
}

self.onmessage = (ev: MessageEvent<ToWorker>) => {
  const msg = ev.data
  switch (msg.type) {
    case 'cancel':
      cancelled.add(msg.runId)
      return
    case 'validate':
      post({ type: 'validated', runId: msg.runId, issues: validate(msg.model) })
      return
    case 'run':
      void execute(msg.runId, [
        { id: 'default', label: '', model: msg.model, config: msg.config },
      ])
      return
    case 'sweep':
      void execute(msg.runId, msg.variants)
      return
  }
}

async function execute(runId: string, variants: RunVariant[]): Promise<void> {
  const results: Array<{
    variantId: string
    label: string
    result: RunResult
    sensitivity?: import('@/lib/sim/diagnose/sensitivity').SensitivityReport
  }> = []
  try {
    for (const v of variants) {
      const run = compileRun(v.model, v.config)
      for (;;) {
        if (cancelled.has(runId)) {
          cancelled.delete(runId)
          post({ type: 'cancelled', runId })
          return
        }
        const more = run.step()
        if (!more) break
        post({
          type: 'progress',
          runId,
          variantId: v.id,
          pct: run.progress(),
          simTimeMs: run.simTimeMs(),
          completions: run.completions(),
        })
        await yieldToEventLoop()
      }
      const result = run.finish()
      await yieldToEventLoop()
      // La sensibilidad son N corridas mas. Se hacen despues de entregar el
      // resultado principal para que la UI no quede esperando por ellas.
      const sens = v.withSensitivity ? sensitivity(v.model) : undefined
      results.push({ variantId: v.id, label: v.label, result, sensitivity: sens })
      post({
        type: 'variantDone',
        runId,
        variantId: v.id,
        label: v.label,
        result,
        sensitivity: sens,
      })
      await yieldToEventLoop()
    }
    post({ type: 'done', runId, results })
  } catch (e) {
    const err = e as { code?: string; message?: string; nodeId?: string }
    post({
      type: 'error',
      runId,
      code: err.code ?? 'UNKNOWN',
      message: err.message ?? String(e),
      nodeId: err.nodeId,
    })
  }
}

/** Macrotarea barata: deja correr los onmessage encolados (cancel incluido). */
function yieldToEventLoop(): Promise<void> {
  return new Promise<void>((resolve) => {
    const ch = new MessageChannel()
    ch.port1.onmessage = () => {
      ch.port1.close()
      resolve()
    }
    ch.port2.postMessage(0)
  })
}

export {}
