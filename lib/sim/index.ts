/**
 * API publica del motor. Todo lo demas de lib/sim es interno.
 *
 * Este archivo no importa nada del browser ni del DOM, a proposito: es lo que
 * permite correr exactamente el mismo codigo dentro de un Web Worker en la app
 * y dentro de Node en los tests contra resultados analiticos.
 */

export { simulate, type SimulateOptions, type SimulateOutput } from './run'
export { capacityCheck, type CapacityReport, type StationCapacity } from './validate/capacityCheck'
export { validate, hasErrors, type ValidationIssue, type Severity } from './validate/validate'
export { SimError } from './core/engine'
export { mtbfFromAvailability } from './core/compile'

export {
  SCHEMA_VERSION,
  CV_OF,
  MS_PER_UNIT,
  type SimModel,
  type SimNode,
  type SimEdge,
  type NodeType,
  type LineSettings,
  type FlowControl,
  type RunConfig,
  type TraceLevel,
  type TimeUnit,
  type VarLevel,
  type ProcessParams,
  type SourceParams,
  type BufferParams,
  type InspectionParams,
  type OperatorParams,
} from './types/model'

export {
  StationState,
  StopReason,
  STATE_NAMES,
  type RunResult,
  type Kpis,
  type NodeStats,
  type StateBreakdown,
  type Histogram,
  type Series,
  type WaitReason,
  type StopReasonId,
} from './types/results'

export { TraceKind, NO_ENTITY, type TraceChunk, type TraceKindId } from './types/trace'

export {
  serialLine,
  defaultLine,
  defaultProcessParams,
  defaultSourceParams,
  defaultRunConfig,
  type StationSpec,
} from './presets/builders'
