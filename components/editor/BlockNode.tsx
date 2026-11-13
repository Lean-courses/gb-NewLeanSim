'use client'

/**
 * Nodo del canvas.
 *
 * Minimalista pero no vacio: nombre, glifo de tipo y EL dato que define al
 * bloque (el tiempo de ciclo en una estacion). Asi se lee una linea entera sin
 * abrir un solo inspector, que es como se mira un modelo en una reunion.
 */

import { Handle, Position, type NodeProps } from '@xyflow/react'
import { NODE_META, nodeSummary } from './nodeMeta'
import type { SimNode } from '@/lib/sim/types/model'

export interface BlockNodeData extends Record<string, unknown> {
  node: SimNode
  unit: string
  hasError: boolean
  hasWarning: boolean
}

export function BlockNode({ data, selected }: NodeProps) {
  const { node, unit, hasError, hasWarning } = data as BlockNodeData
  const meta = NODE_META[node.type]
  const Glyph = meta.glyph
  const summary = nodeSummary(node, unit)
  const isSource = node.type === 'source'
  const isSink = node.type === 'sink'
  const isResource = node.type === 'operators'

  return (
    <div
      className={[
        'relative min-w-[132px] rounded-node border bg-surface-2 px-3 py-2.5 transition-colors',
        selected ? 'border-accent shadow-[0_0_0_1px_var(--color-accent)]' : 'border-border',
        hasError ? 'border-bad' : '',
      ].join(' ')}
      style={{ borderLeftColor: meta.accent, borderLeftWidth: 3 }}
    >
      {!isSource && !isResource && (
        <Handle
          type="target"
          position={Position.Left}
          className="!h-2.5 !w-2.5 !border-2 !border-bg !bg-ink-faint"
        />
      )}
      <div className="flex items-center gap-2">
        <Glyph className="h-[14px] w-[14px] shrink-0" />
        <span className="truncate text-[12px] font-medium leading-tight text-ink">{node.label}</span>
      </div>
      {summary && (
        <div className="tnum mt-1 text-[11px] text-ink-muted">{summary}</div>
      )}
      {(hasError || hasWarning) && (
        <span
          className={[
            'absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold',
            hasError ? 'bg-bad text-white' : 'bg-warn text-[#1a1200]',
          ].join(' ')}
          aria-label={hasError ? 'error' : 'aviso'}
        >
          !
        </span>
      )}
      {!isSink && !isResource && (
        <Handle
          type="source"
          position={Position.Right}
          className="!h-2.5 !w-2.5 !border-2 !border-bg !bg-ink-faint"
        />
      )}
    </div>
  )
}
