'use client'

/**
 * Canvas de edicion.
 *
 * React Flow es la fuente de verdad del gesto (arrastre, conexion, seleccion);
 * el modelo es la fuente de verdad de los datos. Se sincronizan en un solo
 * sentido: React Flow emite eventos y el store los aplica. Mantener dos estados
 * editables en paralelo es como se terminan perdiendo cambios.
 */

import { useCallback, useEffect, useMemo, useRef } from 'react'
import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeChange,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useModel } from '@/store/modelStore'
import { BlockNode, type BlockNodeData } from './BlockNode'
import type { NodeType } from '@/lib/sim/types/model'

const nodeTypes = { block: BlockNode }

const UNIT_LABEL: Record<string, string> = { sec: 's', min: 'min', hour: 'h' }

function CanvasInner() {
  const model = useModel((s) => s.model)
  const issues = useModel((s) => s.issues)
  const selectedId = useModel((s) => s.selectedId)
  const select = useModel((s) => s.select)
  const moveNode = useModel((s) => s.moveNode)
  const addEdge = useModel((s) => s.addEdge)
  const removeEdge = useModel((s) => s.removeEdge)
  const removeNode = useModel((s) => s.removeNode)
  const addNode = useModel((s) => s.addNode)
  const wrapper = useRef<HTMLDivElement>(null)
  const { screenToFlowPosition, fitView } = useReactFlow()

  // Reencuadrar cuando aparece un bloque nuevo. Sin esto, agregar desde la
  // paleta deja el bloque fuera de la vista y parece que no paso nada.
  const nodeCount = model?.nodes.length ?? 0
  const prevCount = useRef(nodeCount)
  useEffect(() => {
    if (nodeCount > prevCount.current) {
      void fitView({ padding: 0.25, maxZoom: 1.1, duration: 250 })
    }
    prevCount.current = nodeCount
  }, [nodeCount, fitView])

  /**
   * Reencuadrar cuando CAMBIA EL TAMANO del lienzo.
   *
   * Un timeout tras abrir el panel no alcanza: fitView mide el contenedor en
   * el momento en que se lo llama, y si el layout todavia no se asento mide la
   * altura vieja y deja el modelo fuera de la vista. Un ResizeObserver dispara
   * cuando el tamano ya es el definitivo, y de paso cubre el redimensionado de
   * la ventana sin codigo extra.
   */
  useEffect(() => {
    const el = wrapper.current
    if (!el) return
    let t: ReturnType<typeof setTimeout> | null = null
    let first = true
    const ro = new ResizeObserver(() => {
      if (first) {
        // El primer disparo es el montaje; de eso ya se encarga fitView del
        // propio ReactFlow.
        first = false
        return
      }
      if (t) clearTimeout(t)
      t = setTimeout(() => void fitView({ padding: 0.25, maxZoom: 1.1, duration: 200 }), 80)
    })
    ro.observe(el)
    return () => {
      if (t) clearTimeout(t)
      ro.disconnect()
    }
  }, [fitView])

  const errorIds = useMemo(
    () => new Set(issues.filter((i) => i.severity === 'error').flatMap((i) => i.nodeIds ?? [])),
    [issues],
  )
  const warnIds = useMemo(
    () => new Set(issues.filter((i) => i.severity === 'warning').flatMap((i) => i.nodeIds ?? [])),
    [issues],
  )

  const nodes: Node[] = useMemo(() => {
    if (!model) return []
    const unit = UNIT_LABEL[model.line.timeUnit] ?? ''
    return model.nodes.map((n) => ({
      id: n.id,
      type: 'block',
      position: n.pos,
      selected: n.id === selectedId,
      data: {
        node: n,
        unit,
        hasError: errorIds.has(n.id),
        hasWarning: warnIds.has(n.id),
      } satisfies BlockNodeData,
    }))
  }, [model, selectedId, errorIds, warnIds])

  const edges: Edge[] = useMemo(() => {
    if (!model) return []
    return model.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      animated: false,
      style: {
        stroke: e.params?.kind === 'rework' ? 'var(--color-state-setup)' : 'var(--color-border-strong)',
        strokeWidth: 2,
        strokeDasharray: e.params?.kind === 'rework' ? '5 4' : undefined,
      },
    }))
  }, [model])

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      for (const c of changes) {
        if (c.type === 'position' && c.position) moveNode(c.id, c.position.x, c.position.y)
        if (c.type === 'remove') removeNode(c.id)
        if (c.type === 'select' && c.selected) select(c.id)
      }
    },
    [moveNode, removeNode, select],
  )

  const onConnect = useCallback(
    (c: Connection) => {
      if (c.source && c.target) addEdge(c.source, c.target)
    },
    [addEdge],
  )

  const onDrop = useCallback(
    (ev: React.DragEvent) => {
      ev.preventDefault()
      const type = ev.dataTransfer.getData('application/newleansim-block') as NodeType
      if (!type) return
      const pos = screenToFlowPosition({ x: ev.clientX, y: ev.clientY })
      addNode(type, Math.round(pos.x), Math.round(pos.y))
    },
    [addNode, screenToFlowPosition],
  )

  return (
    <div ref={wrapper} className="h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onConnect={onConnect}
        onEdgesDelete={(es) => es.forEach((e) => removeEdge(e.id))}
        onPaneClick={() => select(null)}
        onDrop={onDrop}
        onDragOver={(e) => {
          e.preventDefault()
          e.dataTransfer.dropEffect = 'move'
        }}
        fitView
        fitViewOptions={{ padding: 0.25, maxZoom: 1.1 }}
        proOptions={{ hideAttribution: true }}
        colorMode="dark"
        defaultEdgeOptions={{ type: 'smoothstep' }}
        connectionLineStyle={{ stroke: 'var(--color-accent)', strokeWidth: 2 }}
      >
        <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="var(--color-border)" />
        <Controls showInteractive={false} className="!border-border !bg-surface" />
      </ReactFlow>
    </div>
  )
}

export function Canvas() {
  return (
    <ReactFlowProvider>
      <CanvasInner />
    </ReactFlowProvider>
  )
}
