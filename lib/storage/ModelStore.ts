/**
 * Persistencia de modelos.
 *
 * Todo pasa por esta interfaz. Hoy hay una sola implementacion (localStorage),
 * pero el dia que haga falta multi-dispositivo o login, SupabaseModelStore es
 * reemplazar este archivo y nada mas: el esquema del modelo ya es compatible
 * con una columna jsonb por diseno (sin Infinity, sin Map, versionado).
 */

import type { SimModel } from '@/lib/sim/types/model'

export interface ModelSummary {
  id: string
  name: string
  description?: string
  updatedAt: number
  nodeCount: number
}

export interface ModelStore {
  list(): Promise<ModelSummary[]>
  get(id: string): Promise<SimModel | null>
  save(model: SimModel): Promise<void>
  remove(id: string): Promise<void>
  /** Biblioteca completa, para respaldar en un archivo. */
  exportAll(): Promise<SimModel[]>
  /** Importa modelos; devuelve cuantos entraron. */
  importMany(models: SimModel[]): Promise<number>
}

const KEY = 'newleansim.models.v1'
const META_KEY = 'newleansim.meta.v1'

interface Stored {
  model: SimModel
  updatedAt: number
}

interface Meta {
  lastExportAt: number
}

export class LocalModelStore implements ModelStore {
  private read(): Record<string, Stored> {
    if (typeof localStorage === 'undefined') return {}
    try {
      const raw = localStorage.getItem(KEY)
      return raw ? (JSON.parse(raw) as Record<string, Stored>) : {}
    } catch {
      // Un JSON corrupto no puede tirar abajo la app entera: se arranca vacio
      // y el usuario conserva igual su copia exportada.
      return {}
    }
  }

  private write(all: Record<string, Stored>): void {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(KEY, JSON.stringify(all))
  }

  async list(): Promise<ModelSummary[]> {
    const all = this.read()
    return Object.values(all)
      .map((s) => ({
        id: s.model.id,
        name: s.model.name,
        description: s.model.description,
        updatedAt: s.updatedAt,
        nodeCount: s.model.nodes.length,
      }))
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }

  async get(id: string): Promise<SimModel | null> {
    return this.read()[id]?.model ?? null
  }

  async save(model: SimModel): Promise<void> {
    const all = this.read()
    all[model.id] = { model, updatedAt: Date.now() }
    this.write(all)
  }

  async remove(id: string): Promise<void> {
    const all = this.read()
    delete all[id]
    this.write(all)
  }

  async exportAll(): Promise<SimModel[]> {
    return Object.values(this.read()).map((s) => s.model)
  }

  async importMany(models: SimModel[]): Promise<number> {
    const all = this.read()
    let n = 0
    for (const m of models) {
      if (!m?.id || !Array.isArray(m.nodes)) continue
      all[m.id] = { model: m, updatedAt: Date.now() }
      n++
    }
    this.write(all)
    return n
  }
}

export const modelStore: ModelStore = new LocalModelStore()

// ---------------------------------------------------------------------------
// Respaldo
// ---------------------------------------------------------------------------

/**
 * Los modelos de cliente son entregables con datos relevados, y viven en el
 * navegador: limpiar el cache los borra. No es hipotetico, asi que la app
 * lleva la cuenta de cuando fue el ultimo respaldo y lo recuerda.
 */
export const BACKUP_REMINDER_DAYS = 7

export function markExported(): void {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(META_KEY, JSON.stringify({ lastExportAt: Date.now() } satisfies Meta))
}

export function daysSinceExport(): number | null {
  if (typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(META_KEY)
    if (!raw) return null
    const meta = JSON.parse(raw) as Meta
    return (Date.now() - meta.lastExportAt) / 86_400_000
  } catch {
    return null
  }
}

export function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/** Nombre de archivo seguro: minusculas, guiones, sin acentos ni raros. */
export function slugify(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'modelo'
}
