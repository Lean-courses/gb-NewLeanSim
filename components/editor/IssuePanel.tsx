'use client'

/**
 * Problemas del modelo.
 *
 * Los errores bloquean la corrida; los avisos no. La diferencia importa: un
 * modelo que se traba bajo pull puede ser EXACTAMENTE lo que se quiere mostrar
 * en una clase, asi que eso es aviso y no error. Cada problema lleva al nodo
 * que lo causa de un clic.
 */

import { useModel } from '@/store/modelStore'

export function IssuePanel({ locale }: { locale: 'es' | 'en' }) {
  const issues = useModel((s) => s.issues)
  const select = useModel((s) => s.select)
  const es = locale === 'es'

  if (issues.length === 0) {
    return (
      <p className="px-4 py-3 text-[11px] text-ink-faint">
        {es ? 'El modelo esta listo para correr.' : 'The model is ready to run.'}
      </p>
    )
  }

  const errors = issues.filter((i) => i.severity === 'error')
  const warnings = issues.filter((i) => i.severity === 'warning')

  return (
    <ul className="max-h-40 overflow-y-auto">
      {[...errors, ...warnings].map((i, idx) => (
        <li key={`${i.code}-${idx}`}>
          <button
            type="button"
            onClick={() => i.nodeIds?.[0] && select(i.nodeIds[0])}
            disabled={!i.nodeIds?.[0]}
            className="flex w-full items-start gap-2.5 px-4 py-2 text-left transition-colors hover:bg-surface-2 disabled:cursor-default"
          >
            <span
              className={[
                'mt-[3px] h-2 w-2 shrink-0 rounded-full',
                i.severity === 'error' ? 'bg-bad' : 'bg-warn',
              ].join(' ')}
              aria-label={i.severity === 'error' ? (es ? 'error' : 'error') : es ? 'aviso' : 'warning'}
            />
            <span className="text-[11px] leading-relaxed text-ink-muted">{i.message}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}
