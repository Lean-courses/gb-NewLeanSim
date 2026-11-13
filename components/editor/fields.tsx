'use client'

/**
 * Campos del inspector.
 *
 * Reglas que valen para todos: la etiqueta dice QUE es, la ayuda dice POR QUE
 * importa, y la unidad va pegada al campo y no en el texto. Un data box de VSM
 * se lee rapido o no se lee.
 */

import { useId } from 'react'

export function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <span className="block text-[11px] font-medium text-ink-muted">{label}</span>
      <div className="mt-1">{children}</div>
      {hint && <span className="mt-1 block text-[10px] leading-relaxed text-ink-faint">{hint}</span>}
    </label>
  )
}

export function NumberInput({
  value,
  onChange,
  min = 0,
  max,
  step = 1,
  suffix,
}: {
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  step?: number
  suffix?: string
}) {
  return (
    <div className="flex items-center rounded-lg border border-border bg-surface-2 focus-within:border-accent">
      <input
        type="number"
        value={Number.isFinite(value) ? value : ''}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          const v = Number(e.target.value)
          if (Number.isFinite(v)) onChange(v)
        }}
        className="tnum w-full bg-transparent px-2.5 py-1.5 text-[13px] text-ink outline-none"
      />
      {suffix && <span className="pr-2.5 text-[11px] text-ink-faint">{suffix}</span>}
    </div>
  )
}

/** Porcentaje: el usuario escribe 80, el modelo guarda 0,8. */
export function PercentInput({
  value,
  onChange,
}: {
  value: number
  onChange: (v: number) => void
}) {
  return (
    <NumberInput
      value={Math.round(value * 1000) / 10}
      min={0}
      max={100}
      step={1}
      suffix="%"
      onChange={(v) => onChange(Math.min(100, Math.max(0, v)) / 100)}
    />
  )
}

export function Choice<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: Array<{ value: T; label: string }>
  onChange: (v: T) => void
}) {
  const id = useId()
  return (
    <div className="flex rounded-lg border border-border bg-surface-2 p-0.5" role="radiogroup">
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            key={`${id}-${o.value}`}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={[
              'flex-1 rounded-[6px] px-2 py-1 text-[11px] font-medium transition-colors',
              active ? 'bg-surface-3 text-ink' : 'text-ink-faint hover:text-ink-muted',
            ].join(' ')}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

export function TextInput({
  value,
  onChange,
}: {
  value: string
  onChange: (v: string) => void
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-lg border border-border bg-surface-2 px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-accent"
    />
  )
}

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">{title}</h3>
      {children}
    </section>
  )
}

export function Advanced({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <details className="group rounded-lg border border-border bg-surface/50">
      <summary className="cursor-pointer list-none px-3 py-2 text-[11px] font-medium text-ink-muted transition-colors hover:text-ink">
        <span className="mr-1.5 inline-block transition-transform group-open:rotate-90">›</span>
        {title}
      </summary>
      <div className="space-y-3 border-t border-border px-3 py-3">{children}</div>
    </details>
  )
}
