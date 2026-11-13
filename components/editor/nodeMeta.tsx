'use client'

import type { NodeType, SimNode } from '@/lib/sim/types/model'

/**
 * Identidad visual de cada tipo de bloque.
 *
 * Un glifo propio por tipo, no solo color: en un proyector y a diez metros el
 * color se pierde antes que la forma, y a un daltonico le pasa siempre.
 */
export interface NodeMeta {
  accent: string
  label: { es: string; en: string }
  glyph: (props: { className?: string }) => React.ReactElement
}

const Glyph = {
  source: ({ className }: { className?: string }) => (
    <svg viewBox="0 0 16 16" className={className} aria-hidden="true" fill="none">
      <path d="M2 8h9m0 0-3-3m3 3-3 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="12.5" y="2.5" width="2" height="11" rx="1" fill="currentColor" />
    </svg>
  ),
  process: ({ className }: { className?: string }) => (
    <svg viewBox="0 0 16 16" className={className} aria-hidden="true" fill="none">
      <rect x="2.5" y="3.5" width="11" height="9" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M6 8h4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  ),
  buffer: ({ className }: { className?: string }) => (
    <svg viewBox="0 0 16 16" className={className} aria-hidden="true" fill="none">
      <rect x="2" y="9" width="4" height="4" rx="1" fill="currentColor" />
      <rect x="6.5" y="9" width="4" height="4" rx="1" fill="currentColor" />
      <rect x="4.25" y="4.5" width="4" height="4" rx="1" fill="currentColor" />
    </svg>
  ),
  inspection: ({ className }: { className?: string }) => (
    <svg viewBox="0 0 16 16" className={className} aria-hidden="true" fill="none">
      <circle cx="7" cy="7" r="4" stroke="currentColor" strokeWidth="1.6" />
      <path d="M10 10l3.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  ),
  sink: ({ className }: { className?: string }) => (
    <svg viewBox="0 0 16 16" className={className} aria-hidden="true" fill="none">
      <path d="M5 8h9m0 0-3-3m3 3-3 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="1.5" y="2.5" width="2" height="11" rx="1" fill="currentColor" />
    </svg>
  ),
  operators: ({ className }: { className?: string }) => (
    <svg viewBox="0 0 16 16" className={className} aria-hidden="true" fill="none">
      <circle cx="8" cy="5.5" r="2.5" stroke="currentColor" strokeWidth="1.6" />
      <path d="M3 13.5c0-2.5 2.2-4 5-4s5 1.5 5 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  ),
}

export const NODE_META: Record<NodeType, NodeMeta> = {
  source: { accent: 'var(--color-accent)', label: { es: 'Entrada', en: 'Source' }, glyph: Glyph.source },
  process: { accent: 'var(--color-state-busy)', label: { es: 'Estacion', en: 'Station' }, glyph: Glyph.process },
  buffer: { accent: 'var(--color-state-blocked)', label: { es: 'Inventario', en: 'Buffer' }, glyph: Glyph.buffer },
  inspection: { accent: 'var(--color-state-setup)', label: { es: 'Inspeccion', en: 'Inspection' }, glyph: Glyph.inspection },
  sink: { accent: 'var(--color-ink-faint)', label: { es: 'Salida', en: 'Sink' }, glyph: Glyph.sink },
  operators: { accent: 'var(--color-state-waitop)', label: { es: 'Operarios', en: 'Operators' }, glyph: Glyph.operators },
}

/** Dato que resume el bloque en el canvas, sin abrir el inspector. */
export function nodeSummary(n: SimNode, unit: string): string | null {
  switch (n.type) {
    case 'process':
      return `${n.params.cycleTime} ${unit}`
    case 'inspection':
      return `${Math.round(n.params.yield * 100)}%`
    case 'buffer':
      return n.params.capacity === null ? '∞' : `cap ${n.params.capacity}`
    case 'operators':
      return `${n.params.count}`
    case 'source':
      return n.params.mode === 'unlimited' ? '∞' : `${n.params.interval} ${unit}`
    default:
      return null
  }
}
