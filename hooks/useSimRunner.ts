'use client'

/**
 * Ciclo de vida del worker de simulacion.
 *
 * El worker se crea y se destruye DENTRO del mismo efecto. Memoizarlo con
 * useMemo y destruirlo en el cleanup parece equivalente pero no lo es: con
 * StrictMode de React el efecto se monta, se limpia y se vuelve a montar, asi
 * que el segundo montaje se queda con un worker ya terminado y la corrida nunca
 * entrega resultados. Crear y destruir juntos hace que el remontaje levante un
 * worker nuevo y vivo.
 *
 * Los resultados se correlacionan por runId: una corrida vieja que llega tarde
 * se descarta en vez de pisar la pantalla con numeros de otro escenario.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { FromWorker, RunVariant, ToWorker } from '@/lib/sim/types/protocol'
import type { RunResult } from '@/lib/sim/types/results'

export interface VariantResult {
  variantId: string
  label: string
  result: RunResult
}

export interface RunnerState {
  running: boolean
  pct: number
  results: VariantResult[]
  error: { code: string; message: string; nodeId?: string } | null
}

const IDLE: RunnerState = { running: false, pct: 0, results: [], error: null }

export function useSimRunner() {
  const workerRef = useRef<Worker | null>(null)
  const runIdRef = useRef<string | null>(null)
  const [ready, setReady] = useState(false)
  const [state, setState] = useState<RunnerState>(IDLE)

  useEffect(() => {
    const w = new Worker(new URL('../workers/sim.worker.ts', import.meta.url), { type: 'module' })
    workerRef.current = w

    w.onmessage = (ev: MessageEvent<FromWorker>) => {
      const m = ev.data
      if ('runId' in m && m.runId !== runIdRef.current) return
      switch (m.type) {
        case 'progress':
          setState((s) => ({ ...s, pct: m.pct }))
          return
        case 'variantDone':
          setState((s) => ({
            ...s,
            results: [...s.results, { variantId: m.variantId, label: m.label, result: m.result }],
          }))
          return
        case 'done':
          setState((s) => ({ ...s, running: false, pct: 1, results: m.results }))
          return
        case 'cancelled':
          setState((s) => ({ ...s, running: false }))
          return
        case 'error':
          setState((s) => ({
            ...s,
            running: false,
            error: { code: m.code, message: m.message, nodeId: m.nodeId },
          }))
          return
        default:
          return
      }
    }

    // Un fallo al cargar el modulo del worker no llega por onmessage: si no se
    // escucha aca, la UI se queda en "corriendo 0%" para siempre sin decir por que.
    w.onerror = (e) => {
      setState((s) => ({
        ...s,
        running: false,
        error: { code: 'WORKER_LOAD', message: e.message || 'No se pudo cargar el simulador.' },
      }))
    }

    setReady(true)
    return () => {
      setReady(false)
      w.onmessage = null
      w.onerror = null
      w.terminate()
      workerRef.current = null
    }
  }, [])

  const send = useCallback((msg: ToWorker) => {
    workerRef.current?.postMessage(msg)
  }, [])

  const runSweep = useCallback(
    (variants: RunVariant[]) => {
      if (!workerRef.current) return
      const runId = crypto.randomUUID()
      runIdRef.current = runId
      setState({ running: true, pct: 0, results: [], error: null })
      send({ type: 'sweep', runId, variants })
    },
    [send],
  )

  const cancel = useCallback(() => {
    const runId = runIdRef.current
    if (runId) send({ type: 'cancel', runId })
  }, [send])

  const reset = useCallback(() => {
    runIdRef.current = null
    setState(IDLE)
  }, [])

  return { ...state, ready, runSweep, cancel, reset }
}
