'use client'

/**
 * Estado del modelo en edicion.
 *
 * El estado VISUAL (posiciones, seleccion, viewport) vive separado de los
 * parametros de simulacion a proposito: arrastrar un nodo no tiene que marcar
 * el modelo como "cambiado" a efectos de volver a correr, y un diff de
 * parametros tiene que ser un diff real.
 */

import { create } from 'zustand'
import type {
  LineSettings,
  NodeType,
  RunConfig,
  SimEdge,
  SimModel,
  SimNode,
} from '@/lib/sim/types/model'
import {
  defaultProcessParams,
  defaultSourceParams,
} from '@/lib/sim/presets/builders'
import { validate, type ValidationIssue } from '@/lib/sim/validate/validate'

interface ModelState {
  model: SimModel | null
  selectedId: string | null
  /** Sube en cada cambio que afecta la simulacion, no en los movimientos. */
  revision: number
  issues: ValidationIssue[]
  dirty: boolean

  load(model: SimModel): void
  setName(name: string): void
  setLine(patch: Partial<LineSettings>): void
  setRun(patch: Partial<RunConfig>): void
  select(id: string | null): void
  moveNode(id: string, x: number, y: number): void
  updateNode(id: string, patch: { label?: string; params?: Record<string, unknown> }): void
  addNode(type: NodeType, x: number, y: number): string
  /** Agrega en un hueco libre: para el clic en la paleta, donde no hay coordenada. */
  addNodeAuto(type: NodeType): string
  removeNode(id: string): void
  addEdge(source: string, target: string): void
  removeEdge(id: string): void
  markSaved(): void
}

function nextId(model: SimModel, type: NodeType): string {
  // Prefijo por tipo y padding a dos digitos: el motor ordena los nodos por id
  // para asignar indices, asi que sin padding "p10" quedaria antes que "p2".
  // No cambia ningun resultado, pero alinea los indices con el orden visual y
  // hace mucho mas legible un diagnostico.
  const prefix: Record<NodeType, string> = {
    source: 'a_src',
    process: 'p',
    buffer: 'b',
    inspection: 'q',
    sink: 'z_sink',
    operators: 'o',
  }
  const base = prefix[type]
  if (type === 'source' || type === 'sink') {
    let n = 1
    while (model.nodes.some((x) => x.id === `${base}${n === 1 ? '' : n}`)) n++
    return `${base}${n === 1 ? '' : n}`
  }
  let n = 1
  while (model.nodes.some((x) => x.id === `${base}${String(n).padStart(2, '0')}`)) n++
  return `${base}${String(n).padStart(2, '0')}`
}

function newNode(id: string, type: NodeType, x: number, y: number, index: number): SimNode {
  const pos = { x, y }
  switch (type) {
    case 'source':
      return { id, type, label: 'Entrada', pos, params: defaultSourceParams({ mode: 'unlimited' }) }
    case 'process':
      return {
        id,
        type,
        label: `Estacion ${index}`,
        pos,
        params: defaultProcessParams({ cycleTime: 10 }),
      }
    case 'buffer':
      return { id, type, label: `Inventario ${index}`, pos, params: { capacity: null, initial: 0 } }
    case 'inspection':
      return {
        id,
        type,
        label: `Inspeccion ${index}`,
        pos,
        params: {
          yield: 0.95,
          inspectTime: 2,
          variability: 'none',
          onFail: 'scrap',
          reworkTarget: null,
          maxRework: 1,
        },
      }
    case 'sink':
      return { id, type, label: 'Salida', pos, params: {} }
    case 'operators':
      return { id, type, label: `Operarios ${index}`, pos, params: { count: 1 } }
  }
}

export const useModel = create<ModelState>((set, get) => {
  /** Toda mutacion que afecta la simulacion pasa por aca: revalida y marca sucio. */
  const commit = (model: SimModel, bumpRevision = true): void => {
    set((s) => ({
      model,
      revision: bumpRevision ? s.revision + 1 : s.revision,
      issues: validate(model),
      dirty: true,
    }))
  }

  return {
    model: null,
    selectedId: null,
    revision: 0,
    issues: [],
    dirty: false,

    load(model) {
      set({ model, selectedId: null, revision: 0, issues: validate(model), dirty: false })
    },

    setName(name) {
      const m = get().model
      if (!m) return
      commit({ ...m, name }, false)
    },

    setLine(patch) {
      const m = get().model
      if (!m) return
      commit({ ...m, line: { ...m.line, ...patch } })
    },

    setRun(patch) {
      const m = get().model
      if (!m) return
      commit({ ...m, defaults: { ...m.defaults, ...patch } })
    },

    select(id) {
      set({ selectedId: id })
    },

    moveNode(id, x, y) {
      const m = get().model
      if (!m) return
      // Mover un nodo NO sube la revision: es estado visual, no simulacion.
      commit(
        { ...m, nodes: m.nodes.map((n) => (n.id === id ? { ...n, pos: { x, y } } : n)) },
        false,
      )
    },

    updateNode(id, patch) {
      const m = get().model
      if (!m) return
      commit({
        ...m,
        nodes: m.nodes.map((n) => {
          if (n.id !== id) return n
          return {
            ...n,
            label: patch.label ?? n.label,
            params: patch.params ? { ...n.params, ...patch.params } : n.params,
          } as SimNode
        }),
      })
    },

    addNodeAuto(type) {
      const m = get().model
      if (!m) return ''
      // Se busca un hueco en vez de tirar el bloque al azar: dos nodos
      // superpuestos obligan a separarlos a mano antes de poder trabajar, y
      // eso rompe el objetivo de empezar a modelar en menos de un minuto.
      const W = 190
      const H = 110
      const collides = (x: number, y: number): boolean =>
        m.nodes.some((n) => Math.abs(n.pos.x - x) < W && Math.abs(n.pos.y - y) < H)
      let x = 120
      let y = 120
      if (m.nodes.length > 0) {
        const right = m.nodes.reduce((a, n) => (n.pos.x > a.pos.x ? n : a))
        x = right.pos.x + 200
        y = right.pos.y
      }
      let guard = 0
      while (collides(x, y) && guard++ < 50) y += H
      return get().addNode(type, Math.round(x), Math.round(y))
    },

    addNode(type, x, y) {
      const m = get().model
      if (!m) return ''
      const id = nextId(m, type)
      const index = m.nodes.filter((n) => n.type === type).length + 1
      commit({ ...m, nodes: [...m.nodes, newNode(id, type, x, y, index)] })
      set({ selectedId: id })
      return id
    },

    removeNode(id) {
      const m = get().model
      if (!m) return
      commit({
        ...m,
        nodes: m.nodes.filter((n) => n.id !== id),
        edges: m.edges.filter((e) => e.source !== id && e.target !== id),
      })
      if (get().selectedId === id) set({ selectedId: null })
    },

    addEdge(source, target) {
      const m = get().model
      if (!m || source === target) return
      if (m.edges.some((e) => e.source === source && e.target === target)) return
      let n = 1
      while (m.edges.some((e) => e.id === `e${String(n).padStart(2, '0')}`)) n++
      const edge: SimEdge = { id: `e${String(n).padStart(2, '0')}`, source, target }
      commit({ ...m, edges: [...m.edges, edge] })
    },

    removeEdge(id) {
      const m = get().model
      if (!m) return
      commit({ ...m, edges: m.edges.filter((e) => e.id !== id) })
    },

    markSaved() {
      set({ dirty: false })
    },
  }
})
