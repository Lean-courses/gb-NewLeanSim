'use client'

/**
 * Carga del modelo desde el almacenamiento local.
 *
 * Vive en el cliente porque los modelos viven en el navegador. `nuevo` crea uno
 * en el acto y lo guarda, asi que al recargar la pagina sigue ahi y la URL ya
 * apunta a algo real.
 */

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Route } from 'next'
import { modelStore } from '@/lib/storage/ModelStore'
import { emptyModel, templateById } from '@/lib/sim/presets/templates'
import type { SimModel } from '@/lib/sim/types/model'
import { EditorShell } from './EditorShell'

export function EditorLoader({
  id,
  locale,
  fromTemplate,
}: {
  id: string
  locale: 'es' | 'en'
  fromTemplate?: string
}) {
  const router = useRouter()
  const [model, setModel] = useState<SimModel | null>(null)
  const [missing, setMissing] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      if (id === 'new') {
        const base = fromTemplate ? templateById(fromTemplate) : undefined
        const m: SimModel = base
          ? {
              ...structuredClone(base.model),
              id: crypto.randomUUID(),
              name: base.name[locale],
            }
          : emptyModel(locale === 'es' ? 'Proceso nuevo' : 'New process')
        await modelStore.save(m)
        if (!cancelled) router.replace(`/m/${m.id}` as Route)
        return
      }
      const found = await modelStore.get(id)
      if (cancelled) return
      if (found) setModel(found)
      else setMissing(true)
    })()
    return () => {
      cancelled = true
    }
  }, [id, locale, fromTemplate, router])

  if (missing) {
    return (
      <div className="mx-auto max-w-md px-5 py-20 text-center">
        <p className="text-sm text-ink-muted">
          {locale === 'es'
            ? 'No encontramos ese modelo en este navegador. Si lo armaste en otra maquina, importa el archivo JSON desde la biblioteca.'
            : 'We could not find that model in this browser. If you built it on another machine, import its JSON file from the library.'}
        </p>
      </div>
    )
  }

  if (!model) {
    return (
      <div className="flex h-[calc(100dvh-3.5rem)] items-center justify-center">
        <span className="text-[12px] text-ink-faint">{locale === 'es' ? 'Abriendo…' : 'Opening…'}</span>
      </div>
    )
  }

  return <EditorShell initial={model} locale={locale} />
}
