/** Contrato de mensajes entre la UI y el Web Worker. */

import type { RunConfig, SimModel } from './model'
import type { RunResult } from './results'
import type { SensitivityReport } from '../diagnose/sensitivity'
import type { ValidationIssue } from '../validate/validate'

export interface RunVariant {
  id: string
  label: string
  /** Modelo ya parcheado: el worker no conoce el concepto de escenario. */
  model: SimModel
  config: RunConfig
  /**
   * Corre tambien la auto-sensibilidad (N corridas extra, una por estacion).
   * Es lo que convierte "la Est.3 parece el cuello de botella" en "acelerar la
   * Est.3 un 10% te da 9% mas de salida".
   */
  withSensitivity?: boolean
}

export type ToWorker =
  | { type: 'run'; runId: string; model: SimModel; config: RunConfig; withTrace?: boolean }
  | { type: 'sweep'; runId: string; variants: RunVariant[] }
  | { type: 'validate'; runId: string; model: SimModel }
  | { type: 'cancel'; runId: string }

export type FromWorker =
  | { type: 'validated'; runId: string; issues: ValidationIssue[] }
  | { type: 'progress'; runId: string; variantId?: string; pct: number; simTimeMs: number; completions: number }
  | {
      type: 'variantDone'
      runId: string
      variantId: string
      label: string
      result: RunResult
      sensitivity?: SensitivityReport
    }
  | {
      type: 'done'
      runId: string
      results: Array<{
        variantId: string
        label: string
        result: RunResult
        sensitivity?: SensitivityReport
      }>
    }
  | { type: 'cancelled'; runId: string }
  | { type: 'error'; runId: string; code: string; message: string; nodeId?: string }
