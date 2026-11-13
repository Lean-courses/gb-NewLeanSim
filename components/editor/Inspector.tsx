'use client'

/**
 * Inspector del bloque seleccionado.
 *
 * Para una estacion es literalmente el DATA BOX de un VSM: tiempo de ciclo,
 * changeover, disponibilidad, scrap y dotacion. No hay ningun campo arbitrario,
 * y esa es toda la disciplina: cada parametro es un casillero que un
 * practicante Lean ya sabe leer, asi que cargar un proceso de cliente no
 * requiere traducir nada.
 */

import { useModel } from '@/store/modelStore'
import { NODE_META } from './nodeMeta'
import { Advanced, Choice, Field, NumberInput, PercentInput, Section, TextInput } from './fields'
import type { ProcessParams, SourceParams, VarLevel } from '@/lib/sim/types/model'

const UNIT: Record<string, string> = { sec: 's', min: 'min', hour: 'h' }

const VAR_OPTIONS = (locale: 'es' | 'en'): Array<{ value: VarLevel; label: string }> =>
  locale === 'es'
    ? [
        { value: 'none', label: 'Ninguna' },
        { value: 'low', label: 'Baja' },
        { value: 'high', label: 'Alta' },
      ]
    : [
        { value: 'none', label: 'None' },
        { value: 'low', label: 'Low' },
        { value: 'high', label: 'High' },
      ]

export function Inspector({ locale }: { locale: 'es' | 'en' }) {
  const model = useModel((s) => s.model)
  const selectedId = useModel((s) => s.selectedId)
  const update = useModel((s) => s.updateNode)
  const remove = useModel((s) => s.removeNode)
  const es = locale === 'es'

  const node = model?.nodes.find((n) => n.id === selectedId) ?? null

  if (!model || !node) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center">
        <p className="text-[12px] leading-relaxed text-ink-faint">
          {es
            ? 'Selecciona un bloque para ver y editar sus datos.'
            : 'Select a block to see and edit its data.'}
        </p>
      </div>
    )
  }

  const unit = UNIT[model.line.timeUnit] ?? ''
  const meta = NODE_META[node.type]
  const Glyph = meta.glyph
  const setParams = (params: Record<string, unknown>) => update(node.id, { params })

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <span style={{ color: meta.accent }}>
          <Glyph className="h-[15px] w-[15px]" />
        </span>
        <span className="text-[11px] font-medium uppercase tracking-wide text-ink-faint">
          {meta.label[locale]}
        </span>
        <button
          type="button"
          onClick={() => remove(node.id)}
          className="ml-auto rounded px-1.5 py-0.5 text-[11px] text-ink-faint transition-colors hover:text-bad"
        >
          {es ? 'Eliminar' : 'Delete'}
        </button>
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto p-4">
        <Field label={es ? 'Nombre' : 'Name'}>
          <TextInput value={node.label} onChange={(v) => update(node.id, { label: v })} />
        </Field>

        {node.type === 'process' && (
          <ProcessFields
            params={node.params}
            unit={unit}
            locale={locale}
            onChange={setParams}
            operatorPools={model.nodes.filter((n) => n.type === 'operators').map((n) => ({ id: n.id, label: n.label }))}
          />
        )}

        {node.type === 'source' && (
          <SourceFields params={node.params} unit={unit} locale={locale} onChange={setParams} />
        )}

        {node.type === 'buffer' && (
          <Section title={es ? 'Inventario' : 'Buffer'}>
            <Field
              label={es ? 'Capacidad' : 'Capacity'}
              hint={
                es
                  ? 'Vacio = ilimitada. Una capacidad finita es lo que hace que el bloqueo se propague aguas arriba, como en una planta real.'
                  : 'Empty = unlimited. Finite capacity is what makes blocking propagate upstream, as in a real plant.'
              }
            >
              <NumberInput
                value={node.params.capacity ?? 0}
                min={0}
                onChange={(v) => setParams({ capacity: v <= 0 ? null : v })}
                suffix={es ? 'u' : 'u'}
              />
            </Field>
            <Field label={es ? 'Inventario inicial' : 'Initial inventory'}>
              <NumberInput value={node.params.initial} min={0} onChange={(v) => setParams({ initial: v })} />
            </Field>
          </Section>
        )}

        {node.type === 'inspection' && (
          <Section title={es ? 'Control de calidad' : 'Quality check'}>
            <Field
              label={es ? 'Rendimiento (pasa)' : 'Yield (pass)'}
              hint={es ? 'Porcentaje que pasa el control.' : 'Share that passes the check.'}
            >
              <PercentInput value={node.params.yield} onChange={(v) => setParams({ yield: v })} />
            </Field>
            <Field label={es ? 'Tiempo de inspeccion' : 'Inspection time'}>
              <NumberInput value={node.params.inspectTime} onChange={(v) => setParams({ inspectTime: v })} suffix={unit} />
            </Field>
            <Field label={es ? 'Si falla' : 'On failure'}>
              <Choice
                value={node.params.onFail}
                options={[
                  { value: 'scrap' as const, label: es ? 'Descartar' : 'Scrap' },
                  { value: 'rework' as const, label: es ? 'Retrabajar' : 'Rework' },
                ]}
                onChange={(v) => setParams({ onFail: v })}
              />
            </Field>
            {node.params.onFail === 'rework' && (
              <>
                <Field
                  label={es ? 'Vuelve a' : 'Rework target'}
                  hint={
                    es
                      ? 'Ojo: un bucle de retrabajo con tope de WIP puede trabar la linea. Si pasa, te mostramos que espera cada bloque.'
                      : 'Careful: a rework loop under a WIP cap can deadlock the line. If it does, we show what each block is waiting for.'
                  }
                >
                  <select
                    value={node.params.reworkTarget ?? ''}
                    onChange={(e) => setParams({ reworkTarget: e.target.value || null })}
                    className="w-full rounded-lg border border-border bg-surface-2 px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-accent"
                  >
                    <option value="">{es ? '- elegir -' : '- choose -'}</option>
                    {model.nodes
                      .filter((n) => n.type === 'process' || n.type === 'buffer')
                      .map((n) => (
                        <option key={n.id} value={n.id}>
                          {n.label}
                        </option>
                      ))}
                  </select>
                </Field>
                <Field label={es ? 'Maximo de retrabajos' : 'Max reworks'}>
                  <NumberInput value={node.params.maxRework} min={0} onChange={(v) => setParams({ maxRework: v })} />
                </Field>
              </>
            )}
          </Section>
        )}

        {node.type === 'operators' && (
          <Section title={es ? 'Dotacion' : 'Staffing'}>
            <Field
              label={es ? 'Operarios' : 'Operators'}
              hint={
                es
                  ? 'Recurso compartido: las estaciones que lo usan compiten por el. Es como se demuestra que la restriccion es la gente y no la maquina.'
                  : 'Shared resource: stations using it compete for it. This is how you show the constraint is people, not machines.'
              }
            >
              <NumberInput value={node.params.count} min={1} onChange={(v) => setParams({ count: v })} />
            </Field>
          </Section>
        )}
      </div>
    </div>
  )
}

function ProcessFields({
  params,
  unit,
  locale,
  onChange,
  operatorPools,
}: {
  params: ProcessParams
  unit: string
  locale: 'es' | 'en'
  onChange: (p: Record<string, unknown>) => void
  operatorPools: Array<{ id: string; label: string }>
}) {
  const es = locale === 'es'
  return (
    <>
      <Section title={es ? 'Data box' : 'Data box'}>
        <Field label={es ? 'Tiempo de ciclo (C/T)' : 'Cycle time (C/T)'}>
          <NumberInput value={params.cycleTime} min={0} step={0.5} suffix={unit} onChange={(v) => onChange({ cycleTime: v })} />
        </Field>

        <Field
          label={es ? 'Variabilidad' : 'Variability'}
          hint={
            es
              ? 'No se pide un desvio: se elige el nivel y el motor usa la media que ya cargaste.'
              : 'No standard deviation asked: pick a level and the engine uses the mean you already entered.'
          }
        >
          <Choice value={params.variability} options={VAR_OPTIONS(locale)} onChange={(v) => onChange({ variability: v })} />
        </Field>

        <Field label={es ? 'Cambio de formato (C/O)' : 'Changeover (C/O)'}>
          <NumberInput value={params.changeoverTime} min={0} step={0.5} suffix={unit} onChange={(v) => onChange({ changeoverTime: v })} />
        </Field>

        <Field
          label={es ? 'Disponibilidad' : 'Availability'}
          hint={
            es
              ? 'El "A" del OEE. No hace falta el MTBF: se deriva de la disponibilidad y la duracion media de parada.'
              : 'The "A" in OEE. No MTBF needed: it is derived from availability and mean repair time.'
          }
        >
          <PercentInput value={params.availability} onChange={(v) => onChange({ availability: v })} />
        </Field>

        {params.availability < 1 && (
          <Field label={es ? 'Duracion media de parada' : 'Mean time to repair'}>
            <NumberInput value={params.mttr} min={0} step={0.5} suffix={unit} onChange={(v) => onChange({ mttr: v })} />
          </Field>
        )}

        <Field label={es ? 'Scrap' : 'Scrap'}>
          <PercentInput value={params.scrapRate} onChange={(v) => onChange({ scrapRate: v })} />
        </Field>

        {operatorPools.length > 0 && (
          <>
            <Field label={es ? 'Operarios que ocupa' : 'Operators required'}>
              <NumberInput value={params.operators} min={0} onChange={(v) => onChange({ operators: v })} />
            </Field>
            {params.operators > 0 && (
              <Field label={es ? 'Del pool' : 'From pool'}>
                <select
                  value={params.operatorPool ?? ''}
                  onChange={(e) => onChange({ operatorPool: e.target.value || null })}
                  className="w-full rounded-lg border border-border bg-surface-2 px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-accent"
                >
                  <option value="">{es ? '- ninguno -' : '- none -'}</option>
                  {operatorPools.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </Field>
            )}
          </>
        )}
      </Section>

      <Advanced title={es ? 'Avanzado' : 'Advanced'}>
        <Field label={es ? 'Maquinas en paralelo' : 'Parallel machines'}>
          <NumberInput value={params.servers} min={1} onChange={(v) => onChange({ servers: v })} />
        </Field>
        <Field
          label={es ? 'Lote de proceso' : 'Process batch'}
          hint={
            es
              ? 'Unidades que se trabajan juntas. Distinto del lote de transferencia, que esta en la barra de arriba.'
              : 'Units worked together. Different from the transfer batch, which is in the top bar.'
          }
        >
          <NumberInput value={params.processBatch} min={1} onChange={(v) => onChange({ processBatch: v })} />
        </Field>
        <Field label={es ? 'Modo de lote' : 'Batch mode'}>
          <Choice
            value={params.batchMode}
            options={[
              { value: 'sequential' as const, label: es ? 'Linea' : 'Line' },
              { value: 'simultaneous' as const, label: es ? 'Horno' : 'Oven' },
            ]}
            onChange={(v) => onChange({ batchMode: v })}
          />
        </Field>
        <Field label={es ? 'Capacidad de la cola' : 'Queue capacity'} hint={es ? 'Vacio = ilimitada.' : 'Empty = unlimited.'}>
          <NumberInput
            value={params.queueCapacity ?? 0}
            min={0}
            onChange={(v) => onChange({ queueCapacity: v <= 0 ? null : v })}
          />
        </Field>
      </Advanced>
    </>
  )
}

function SourceFields({
  params,
  unit,
  locale,
  onChange,
}: {
  params: SourceParams
  unit: string
  locale: 'es' | 'en'
  onChange: (p: Record<string, unknown>) => void
}) {
  const es = locale === 'es'
  return (
    <Section title={es ? 'Demanda' : 'Demand'}>
      <Field
        label={es ? 'Modo' : 'Mode'}
        hint={
          es
            ? 'Ilimitada = la materia prima siempre esta y la restriccion la fija la linea. A intervalo = la demanda manda, y si supera la capacidad el WIP crece.'
            : 'Unlimited = raw material always available, the line sets the constraint. Interval = demand rules, and if it exceeds capacity WIP grows.'
        }
      >
        <Choice
          value={params.mode}
          options={[
            { value: 'unlimited' as const, label: es ? 'Ilimitada' : 'Unlimited' },
            { value: 'interval' as const, label: es ? 'A intervalo' : 'Interval' },
          ]}
          onChange={(v) => onChange({ mode: v })}
        />
      </Field>
      {params.mode !== 'unlimited' && (
        <>
          <Field label={es ? 'Intervalo entre llegadas' : 'Interarrival time'}>
            <NumberInput value={params.interval} min={0} step={0.5} suffix={unit} onChange={(v) => onChange({ interval: v })} />
          </Field>
          <Field label={es ? 'Variabilidad de la demanda' : 'Demand variability'}>
            <Choice value={params.variability} options={VAR_OPTIONS(locale)} onChange={(v) => onChange({ variability: v })} />
          </Field>
        </>
      )}
      <Field
        label={es ? 'Tope de unidades' : 'Unit cap'}
        hint={es ? 'Vacio = sin tope.' : 'Empty = no cap.'}
      >
        <NumberInput
          value={params.maxUnits ?? 0}
          min={0}
          onChange={(v) => onChange({ maxUnits: v <= 0 ? null : v })}
        />
      </Field>
    </Section>
  )
}
