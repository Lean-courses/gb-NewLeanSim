/**
 * Las 4 plantillas Lean.
 *
 * Van compiladas en el repo y no en una base de datos: tienen que funcionar en
 * cualquier maquina, siempre, sin infraestructura. Cada una trae escenarios
 * preconfigurados y el numero que hay que mirar, asi que dar la clase no
 * requiere armar nada.
 *
 * Los valores de `expect` de cada escenario NO son adorno: son los resultados
 * analiticos del caso, y los tests los verifican contra el motor. Si alguno
 * deja de dar, el bug es conceptual.
 */

import {
  SCHEMA_VERSION,
  type LineSettings,
  type RunConfig,
  type SimModel,
} from '../types/model'
import {
  defaultLine,
  defaultProcessParams,
  defaultRunConfig,
  defaultSourceParams,
  serialLine,
} from './builders'

export type Locale = 'es' | 'en'

export interface Bilingual {
  es: string
  en: string
}

/** Cambio puntual sobre un modelo, para definir un escenario. */
export interface ModelPatch {
  line?: Partial<LineSettings>
  run?: Partial<RunConfig>
  /** Parametros a pisar, por id de nodo. Sirve para cualquier tipo de bloque. */
  nodes?: Record<string, Record<string, unknown>>
}

export interface Scenario {
  id: string
  label: Bilingual
  patch: ModelPatch
  /** Que tiene que pasar. Lo verifican los tests de aceptacion. */
  expect?: {
    throughputPerHour?: [number, number]
    leadTimeMs?: [number, number]
    wipMax?: [number, number]
  }
}

export interface LeanTemplate {
  id: string
  name: Bilingual
  /** Una linea: de que va la demo. */
  summary: Bilingual
  /** El punto. Lo que el participante se tiene que llevar. */
  insight: Bilingual
  /** Que mirar mientras corre. */
  watch: Bilingual
  model: SimModel
  scenarios: Scenario[]
}

export function applyPatch(model: SimModel, patch: ModelPatch): SimModel {
  const next: SimModel = {
    ...model,
    line: { ...model.line, ...patch.line },
    defaults: { ...model.defaults, ...patch.run },
    nodes: model.nodes.map((n) => {
      const over = patch.nodes?.[n.id]
      if (!over) return n
      return { ...n, params: { ...n.params, ...over } } as typeof n
    }),
  }
  return next
}

const MIN = 60_000

// ---------------------------------------------------------------------------
// 1. Lote vs one-piece flow
// ---------------------------------------------------------------------------

function batchVsFlow(): LeanTemplate {
  const model = serialLine(
    [
      { label: 'Est.1', cycleTime: 1 },
      { label: 'Est.2', cycleTime: 1 },
      { label: 'Est.3', cycleTime: 1 },
    ],
    {
      name: 'Lote vs one-piece flow',
      line: { flowControl: 'push', transferBatch: 10, timeUnit: 'min' },
      // 10 ordenes puestas sobre la linea en t=0: el encuadre clasico del
      // ejercicio. Intervalo cero con tope de 10 unidades.
      source: { mode: 'interval', interval: 0, maxUnits: 10, variability: 'none' },
      run: { maxCompletions: 10, warmup: 0 },
    },
  )

  return {
    id: 'batch-vs-flow',
    name: { es: 'Lote vs one-piece flow', en: 'Batch vs one-piece flow' },
    summary: {
      es: '10 unidades, 3 estaciones de 1 minuto. Lo unico que cambia es cuantas unidades viajan juntas.',
      en: '10 units, 3 one-minute stations. The only thing that changes is how many units travel together.',
    },
    insight: {
      es: 'Las mismas 10 unidades, las mismas 3 estaciones, ni un recurso nuevo: el lead time por unidad cae de 30 a 7,5 minutos y la ultima sale a los 12 en vez de a los 30. Lo unico que cambio es que las piezas dejaron de esperar a sus companeras de lote. Ojo con el throughput de la tabla: sube porque este es un lote cerrado de 10 ordenes, y el lote tambien desperdicia capacidad mientras la Est.2 y la Est.3 esperan de brazos cruzados a que se llene. En una linea alimentada de forma continua el throughput NO cambia - lo fija la estacion mas lenta - y todo el beneficio del flujo pieza a pieza se ve en el lead time y en el WIP.',
      en: 'Same 10 units, same 3 stations, not one extra resource: lead time per unit falls from 30 to 7.5 minutes and the last one exits at 12 instead of 30. The only change is that parts stopped waiting for their batch-mates. Mind the throughput column: it rises because this is a closed batch of 10 orders, and batching also wastes capacity while Stations 2 and 3 sit idle waiting for it to fill. On a continuously fed line throughput does NOT change - the slowest station sets it - and the whole benefit of one-piece flow shows up in lead time and WIP.',
    },
    watch: {
      es: 'Mira cuando sale la PRIMERA unidad. Con lote de 10 no sale nada hasta el minuto 30.',
      en: 'Watch when the FIRST unit comes out. With a batch of 10, nothing exits until minute 30.',
    },
    model,
    scenarios: [
      {
        id: 'batch-10',
        label: { es: 'Lote de 10', en: 'Batch of 10' },
        patch: { line: { transferBatch: 10 } },
        expect: { leadTimeMs: [30 * MIN, 30 * MIN] },
      },
      {
        id: 'one-piece',
        label: { es: 'Pieza a pieza', en: 'One piece flow' },
        patch: { line: { transferBatch: 1 } },
        expect: { leadTimeMs: [7.5 * MIN, 7.5 * MIN] },
      },
    ],
  }
}

// ---------------------------------------------------------------------------
// 2. Push vs pull
// ---------------------------------------------------------------------------

function pushVsPull(): LeanTemplate {
  const model = serialLine(
    [
      { label: 'Est.1', cycleTime: 10 },
      { label: 'Est.2', cycleTime: 15 },
      { label: 'Est.3', cycleTime: 10 },
    ],
    {
      name: 'Push vs pull',
      line: { flowControl: 'push', transferBatch: 1, timeUnit: 'sec' },
      // Se libera una unidad cada 8 s contra un cuello de botella de 15 s: se
      // le mete a la linea casi el doble de lo que puede salir.
      source: { mode: 'interval', interval: 8, variability: 'none' },
      run: { horizon: 40_000, warmup: 0 },
    },
  )

  return {
    id: 'push-vs-pull',
    name: { es: 'Push vs pull (CONWIP)', en: 'Push vs pull (CONWIP)' },
    summary: {
      es: 'Una linea con un cuello de botella de 15 s alimentada cada 8 s. Primero sin control, despues con un tope de WIP.',
      en: 'A line with a 15 s bottleneck fed every 8 s. First uncontrolled, then with a WIP cap.',
    },
    insight: {
      es: 'Meter mas trabajo al sistema no aumenta la salida: solo el inventario y el lead time. El tope de WIP no baja el throughput, baja el caos.',
      en: 'Pushing more work into the system does not increase output, only inventory and lead time. The WIP cap does not reduce throughput, it reduces chaos.',
    },
    watch: {
      es: 'Mira la pila delante de la Est.2 crecer sin techo. Despues activa el tope de WIP y mirala quedarse plana, con el mismo throughput.',
      en: 'Watch the pile in front of Station 2 grow without bound. Then turn on the WIP cap and watch it flatten, at the same throughput.',
    },
    model,
    scenarios: [
      {
        id: 'push',
        label: { es: 'Push (sin control)', en: 'Push (uncontrolled)' },
        patch: { line: { flowControl: 'push' } },
        expect: { throughputPerHour: [230, 245], wipMax: [1_000, 1e9] },
      },
      {
        id: 'conwip',
        label: { es: 'Pull - tope de WIP 6', en: 'Pull - WIP cap 6' },
        patch: {
          line: { flowControl: 'conwip', wipLimit: 6 },
          run: { warmup: 2_000 },
        },
        expect: { throughputPerHour: [230, 245], wipMax: [1, 6] },
      },
    ],
  }
}

// ---------------------------------------------------------------------------
// 3. Cuello de botella / TOC
// ---------------------------------------------------------------------------

function bottleneck(): LeanTemplate {
  const model = serialLine(
    [
      { label: 'Est.1', cycleTime: 8 },
      { label: 'Est.2', cycleTime: 8 },
      { label: 'Est.3', cycleTime: 20 },
      { label: 'Est.4', cycleTime: 8 },
    ],
    {
      name: 'Cuello de botella',
      line: { flowControl: 'conwip', wipLimit: 12, transferBatch: 1, timeUnit: 'sec' },
      source: { mode: 'unlimited' },
      run: { maxCompletions: 20_000, warmup: 1_000 },
    },
  )

  return {
    id: 'bottleneck',
    name: { es: 'Cuello de botella (TOC)', en: 'Bottleneck (TOC)' },
    summary: {
      es: 'Linea de 8 / 8 / 20 / 8 segundos. Tres corridas: base, mejorar una estacion rapida, mejorar la restriccion.',
      en: 'An 8 / 8 / 20 / 8 second line. Three runs: baseline, improve a fast station, improve the constraint.',
    },
    insight: {
      es: 'Una hora ganada en un no cuello de botella es un espejismo. Solo la restriccion mueve el throughput de la linea.',
      en: 'An hour saved at a non-bottleneck is a mirage. Only the constraint moves the line throughput.',
    },
    watch: {
      es: 'Mejora la Est.1 a la mitad y mira el throughput: no se mueve. Despues mejora la Est.3 y mira como se duplica.',
      en: 'Halve Station 1 and watch throughput: it does not move. Then improve Station 3 and watch it double.',
    },
    model,
    scenarios: [
      {
        id: 'baseline',
        label: { es: 'Linea base', en: 'Baseline' },
        patch: {},
        expect: { throughputPerHour: [179, 181] },
      },
      {
        id: 'improve-non-bottleneck',
        label: { es: 'Est.1 de 8 s a 4 s', en: 'Station 1 from 8 s to 4 s' },
        patch: { nodes: { p01: { cycleTime: 4 } } },
        expect: { throughputPerHour: [179, 181] },
      },
      {
        id: 'improve-bottleneck',
        label: { es: 'Est.3 de 20 s a 10 s', en: 'Station 3 from 20 s to 10 s' },
        patch: { nodes: { p03: { cycleTime: 10 } } },
        expect: { throughputPerHour: [355, 365] },
      },
    ],
  }
}

// ---------------------------------------------------------------------------
// 4. Impacto de la variabilidad
// ---------------------------------------------------------------------------

function variability(): LeanTemplate {
  const model = serialLine([{ label: 'Est.1', cycleTime: 10, variability: 'none' }], {
    name: 'Impacto de la variabilidad',
    line: { flowControl: 'push', transferBatch: 1, timeUnit: 'sec' },
    // Carga al 90% de la capacidad de la estacion. La variabilidad se mueve
    // por escenario, tanto en la demanda como en el proceso: la ecuacion de
    // Kingman tiene los DOS terminos (Ca^2 + Cs^2) / 2, y dejar las llegadas
    // siempre Poisson haria que incluso una estacion perfectamente
    // deterministica tenga cola, lo que confunde el punto de la demo.
    source: { mode: 'interval', interval: 10 / 0.9, variability: 'none' },
    run: { maxCompletions: 200_000, warmup: 5_000 },
  })

  return {
    id: 'variability',
    name: { es: 'Impacto de la variabilidad', en: 'The cost of variability' },
    summary: {
      es: 'Una estacion al 90% de carga. Mismo tiempo de ciclo promedio y misma capacidad en las tres corridas: lo unico que cambia es la dispersion.',
      en: 'A single station at 90% load. Same average cycle time and capacity in all three runs: the only thing that changes is the spread.',
    },
    insight: {
      es: 'La cola explota sin que cambie ni la capacidad ni el tiempo de ciclo promedio. Es la ecuacion de Kingman, y es la razon por la que Lean persigue la estandarizacion antes que la velocidad.',
      en: 'The queue explodes with no change in capacity or average cycle time. That is Kingman’s equation, and it is why Lean chases standardisation before speed.',
    },
    watch: {
      es: 'El tiempo de ciclo promedio es identico en las tres corridas. Mira solo la cola. Y fijate que la variabilidad de la DEMANDA cuesta tanto como la del proceso.',
      en: 'The average cycle time is identical in all three runs. Watch only the queue. And notice that DEMAND variability costs as much as process variability.',
    },
    model,
    scenarios: [
      {
        id: 'no-variability',
        label: { es: 'Sin variabilidad', en: 'No variability' },
        patch: { nodes: { a_source: { variability: 'none' }, p01: { variability: 'none' } } },
      },
      {
        id: 'process-variability',
        label: { es: 'Solo en el proceso', en: 'Process only' },
        patch: { nodes: { a_source: { variability: 'none' }, p01: { variability: 'high' } } },
      },
      {
        id: 'high-variability',
        label: { es: 'En la demanda y en el proceso', en: 'Demand and process' },
        patch: { nodes: { a_source: { variability: 'high' }, p01: { variability: 'high' } } },
      },
    ],
  }
}

export const TEMPLATES: LeanTemplate[] = [batchVsFlow(), pushVsPull(), bottleneck(), variability()]

export function templateById(id: string): LeanTemplate | undefined {
  return TEMPLATES.find((t) => t.id === id)
}

/** Modelo nuevo y vacio, para empezar de cero. */
export function emptyModel(name: string): SimModel {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: crypto.randomUUID(),
    name,
    line: defaultLine({ flowControl: 'push', transferBatch: 1, timeUnit: 'sec' }),
    nodes: [
      {
        id: 'a_source',
        type: 'source',
        label: 'Entrada',
        pos: { x: 0, y: 0 },
        params: defaultSourceParams({ mode: 'unlimited' }),
      },
      {
        id: 'p01',
        type: 'process',
        label: 'Estacion 1',
        pos: { x: 220, y: 0 },
        params: defaultProcessParams({ cycleTime: 10 }),
      },
      {
        id: 'z_sink',
        type: 'sink',
        label: 'Salida',
        pos: { x: 440, y: 0 },
        params: {},
      },
    ],
    edges: [
      { id: 'e01', source: 'a_source', target: 'p01' },
      { id: 'e02', source: 'p01', target: 'z_sink' },
    ],
    defaults: defaultRunConfig({ maxCompletions: 5_000, warmup: 500 }),
  }
}
