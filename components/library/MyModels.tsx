'use client'

/**
 * Modelos guardados en este navegador.
 *
 * Con el aviso de respaldo bien visible: un modelo de cliente con datos
 * relevados es un entregable, y limpiar el cache del navegador lo borra. No es
 * hipotetico, asi que la app lleva la cuenta y lo recuerda en vez de confiar en
 * la disciplina de nadie.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import type { Route } from 'next'
import {
  BACKUP_REMINDER_DAYS,
  daysSinceExport,
  downloadJson,
  markExported,
  modelStore,
  type ModelSummary,
} from '@/lib/storage/ModelStore'
import type { SimModel } from '@/lib/sim/types/model'

export function MyModels({ locale }: { locale: 'es' | 'en' }) {
  const es = locale === 'es'
  const [models, setModels] = useState<ModelSummary[] | null>(null)
  const [staleDays, setStaleDays] = useState<number | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const refresh = useCallback(() => {
    void modelStore.list().then(setModels)
    setStaleDays(daysSinceExport())
  }, [])

  useEffect(refresh, [refresh])

  const exportAll = useCallback(async () => {
    const all = await modelStore.exportAll()
    downloadJson(`newleansim-biblioteca-${new Date().toISOString().slice(0, 10)}.json`, all)
    markExported()
    refresh()
  }, [refresh])

  const onImport = useCallback(
    async (file: File) => {
      const text = await file.text()
      try {
        const parsed: unknown = JSON.parse(text)
        const list: SimModel[] = Array.isArray(parsed) ? parsed : [parsed as SimModel]
        await modelStore.importMany(list)
        refresh()
      } catch {
        alert(es ? 'Ese archivo no es un modelo valido.' : 'That file is not a valid model.')
      }
    },
    [es, refresh],
  )

  const needsBackup =
    models !== null && models.length > 0 && (staleDays === null || staleDays > BACKUP_REMINDER_DAYS)

  return (
    <section className="mt-14">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold tracking-tight">{es ? 'Mis modelos' : 'My models'}</h2>
        <div className="ml-auto flex items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void onImport(f)
              e.target.value = ''
            }}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="rounded-full border border-border px-3 py-1.5 text-[12px] text-ink-muted transition-colors hover:border-border-strong hover:text-ink"
          >
            {es ? 'Importar' : 'Import'}
          </button>
          {models && models.length > 0 && (
            <button
              type="button"
              onClick={() => void exportAll()}
              className="rounded-full border border-border px-3 py-1.5 text-[12px] text-ink-muted transition-colors hover:border-border-strong hover:text-ink"
            >
              {es ? 'Respaldar todo' : 'Back up all'}
            </button>
          )}
          <Link
            href={"/m/new" as Route}
            className="rounded-full bg-accent-strong px-4 py-1.5 text-[12px] font-semibold text-[#06211f] transition-colors hover:bg-accent"
          >
            {es ? 'Nuevo modelo' : 'New model'}
          </Link>
        </div>
      </div>

      {needsBackup && (
        <p className="mt-3 rounded-card border border-warn/35 bg-warn/10 px-4 py-2.5 text-[12px] leading-relaxed text-ink-muted">
          {es
            ? 'Tus modelos viven en este navegador. Si se limpia el cache, se pierden. Descarga un respaldo antes de usarlos frente a un cliente.'
            : 'Your models live in this browser. Clearing its cache deletes them. Download a backup before using them with a client.'}
        </p>
      )}

      {models && models.length === 0 && (
        <div className="mt-4 rounded-card border border-dashed border-border bg-surface/40 px-5 py-10 text-center">
          <p className="text-sm text-ink-faint">
            {es ? 'Todavia no guardaste ningun modelo.' : 'You have not saved any models yet.'}
          </p>
        </div>
      )}

      {models && models.length > 0 && (
        <ul className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {models.map((m) => (
            <li key={m.id}>
              <Link
                href={`/m/${m.id}` as Route}
                className="flex items-center gap-3 rounded-card border border-border bg-surface px-4 py-3.5 transition-colors hover:border-border-strong hover:bg-surface-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-medium">{m.name}</p>
                  <p className="tnum mt-0.5 text-[11px] text-ink-faint">
                    {m.nodeCount} {es ? 'bloques' : 'blocks'} ·{' '}
                    {new Date(m.updatedAt).toLocaleDateString(es ? 'es-AR' : 'en-GB')}
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
