'use client'

/**
 * Paleta de bloques. Se arrastran al canvas o se agregan con un clic.
 *
 * Seis bloques y ni uno mas. Cada tipo que se agrega a la paleta es una
 * decision que el usuario tiene que tomar antes de empezar a modelar, y el
 * objetivo es que empiece a modelar en menos de un minuto.
 */

import { NODE_META } from './nodeMeta'
import { useModel } from '@/store/modelStore'
import type { NodeType } from '@/lib/sim/types/model'

const ORDER: NodeType[] = ['source', 'process', 'buffer', 'inspection', 'operators', 'sink']

export function Palette({ locale }: { locale: 'es' | 'en' }) {
  const addNodeAuto = useModel((s) => s.addNodeAuto)

  return (
    <div className="flex flex-col gap-1.5 p-3">
      <h2 className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
        {locale === 'es' ? 'Bloques' : 'Blocks'}
      </h2>
      {ORDER.map((type) => {
        const meta = NODE_META[type]
        const Glyph = meta.glyph
        return (
          <button
            key={type}
            type="button"
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData('application/newleansim-block', type)
              e.dataTransfer.effectAllowed = 'move'
            }}
            onClick={() => addNodeAuto(type)}
            className="flex cursor-grab items-center gap-2.5 rounded-lg border border-transparent px-2.5 py-2 text-left transition-colors hover:border-border hover:bg-surface-2 active:cursor-grabbing"
            style={{ color: meta.accent }}
          >
            <Glyph className="h-[15px] w-[15px] shrink-0" />
            <span className="text-[12px] text-ink">{meta.label[locale]}</span>
          </button>
        )
      })}
      <p className="mt-2 px-1.5 text-[10px] leading-relaxed text-ink-faint">
        {locale === 'es'
          ? 'Arrastralos al lienzo o hace clic. Unilos tirando de los puntos del costado.'
          : 'Drag onto the canvas or click. Connect them by dragging the side dots.'}
      </p>
    </div>
  )
}
