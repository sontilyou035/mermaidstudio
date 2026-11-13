import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  SelectionMode,
  useReactFlow,
  type OnConnect,
  type OnNodeDrag,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { BlockNode } from './BlockNode'
import { FlowEdgeView } from './FlowEdgeView'
import { SelectionActions } from './SelectionActions'
import { useStore } from '../store'
import { setRfInstance } from '../lib/rf'
import type { FlowEdge, FlowNode } from '../types'

/** d3 传下来的原生事件，触摸事件没有 altKey */
function isAltPressed(event: unknown): boolean {
  return typeof event === 'object' && event !== null && 'altKey' in event && Boolean((event as MouseEvent).altKey)
}

const nodeTypes = { block: BlockNode }
const edgeTypes = { ms: FlowEdgeView }

function CanvasInner() {
  const nodes = useStore((s) => s.doc.nodes)
  const edges = useStore((s) => s.doc.edges)
  const settings = useStore((s) => s.settings)
  const onNodesChange = useStore((s) => s.onNodesChange)
  const onEdgesChange = useStore((s) => s.onEdgesChange)
  const onConnect = useStore((s) => s.onConnect)
  const onReconnect = useStore((s) => s.onReconnect)
  const addNodeFromBlock = useStore((s) => s.addNodeFromBlock)
  const pushHistory = useStore((s) => s.pushHistory)
  const afterDragStop = useStore((s) => s.afterDragStop)
  const placeGroupMembers = useStore((s) => s.placeGroupMembers)
  const beginAltDragCopy = useStore((s) => s.beginAltDragCopy)
  const finishAltDragCopy = useStore((s) => s.finishAltDragCopy)
  const clearSelection = useStore((s) => s.clearSelection)
  const playing = useStore((s) => s.player.playing)

  const { screenToFlowPosition } = useReactFlow()
  const dragRef = useRef<{
    id: string
    x: number
    y: number
    members: Array<{ id: string; x: number; y: number }>
  } | null>(null)
  /** 按住 ⌥/Alt 拖拽复制时的临时状态 */
  const altDragRef = useRef<{ x: number; y: number; moved: boolean } | null>(null)
  const [connecting, setConnecting] = useState(false)

  // 画布固定为「左键框选」：平移走中键/右键或按住空格
  const boxSelect = true

  // 按住空格才显示「抓手」：默认是普通箭头（Figma / FigJam 的手感）
  useEffect(() => {
    const typing = (el: EventTarget | null) => {
      const t = el as HTMLElement | null
      return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
    }
    const down = (e: KeyboardEvent) => {
      if (e.code !== 'Space' && e.key !== ' ') return
      if (typing(e.target)) return
      document.body.classList.add('ms-space-pan')
    }
    const up = (e: KeyboardEvent) => {
      if (e.code !== 'Space' && e.key !== ' ') return
      document.body.classList.remove('ms-space-pan')
    }
    const blur = () => document.body.classList.remove('ms-space-pan')
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur)
      document.body.classList.remove('ms-space-pan')
    }
  }, [])

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault()
      const blockId = event.dataTransfer.getData('application/mermaid-block')
      if (!blockId) return
      const position = screenToFlowPosition({ x: event.clientX, y: event.clientY })
      const node = addNodeFromBlock(blockId, { x: position.x - 80, y: position.y - 28 })
      if (node) afterDragStop()
    },
    [addNodeFromBlock, afterDragStop, screenToFlowPosition],
  )

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
  }, [])

  const handleConnect = useCallback<OnConnect>((connection) => onConnect(connection), [onConnect])

  const handleDragStart: OnNodeDrag<FlowNode> = (event, node) => {
    pushHistory()
    // ⌥ / Alt 拖拽 = 拖出一个副本（原件留在原地，连线也不动）
    if (isAltPressed(event)) {
      const selected = nodes.filter((n) => n.selected).map((n) => n.id)
      const targets = selected.includes(node.id) ? selected : [node.id]
      beginAltDragCopy(targets)
      altDragRef.current = { x: node.position.x, y: node.position.y, moved: false }
      dragRef.current = null
      return
    }
    altDragRef.current = null
    if (node.data.isSubgraph) {
      // 记录组内节点的起始位置，拖动时按总位移设置，避免逐帧累积误差
      const members = nodes
        .filter((n) => n.data.groupId === node.id)
        .map((n) => ({ id: n.id, x: n.position.x, y: n.position.y }))
      dragRef.current = { id: node.id, x: node.position.x, y: node.position.y, members }
    } else {
      dragRef.current = null
    }
  }

  const handleDrag: OnNodeDrag<FlowNode> = (_e, node) => {
    const alt = altDragRef.current
    if (alt) {
      // 复制模式下原件留在原地，这里只判断「有没有真的拖动过」
      if (Math.abs(node.position.x - alt.x) > 2 || Math.abs(node.position.y - alt.y) > 2) alt.moved = true
      return
    }
    const ref = dragRef.current
    if (!ref || ref.id !== node.id) return
    const dx = node.position.x - ref.x
    const dy = node.position.y - ref.y
    if (!dx && !dy) return
    placeGroupMembers(ref.members.map((m) => ({ id: m.id, x: m.x + dx, y: m.y + dy })))
  }

  const handleDragStop: OnNodeDrag<FlowNode> = () => {
    const alt = altDragRef.current
    altDragRef.current = null
    dragRef.current = null
    if (alt) finishAltDragCopy(alt.moved)
    afterDragStop()
  }

  // 选中连线时把两端节点抬到普通节点之上：连线常被节点压住，看不见是从哪出来的
  const edgeEndpoints = useMemo(() => {
    const ids = new Set<string>()
    for (const e of edges) if (e.selected) {
      ids.add(e.source)
      ids.add(e.target)
    }
    return ids
  }, [edges])
  const renderNodes = useMemo(
    () =>
      edgeEndpoints.size
        ? nodes.map((n) => (edgeEndpoints.has(n.id) ? { ...n, zIndex: Math.max(n.zIndex ?? 0, 5) } : n))
        : nodes,
    [nodes, edgeEndpoints],
  )

  const isEmpty = nodes.length === 0

  return (
    <div className={`ms-canvas${connecting ? ' is-connecting' : ''}`}>
      <ReactFlow
        nodes={renderNodes}
        edges={edges as FlowEdge[]}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onInit={(inst) => setRfInstance(inst)}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={handleConnect}
        onReconnect={(oldEdge, connection) => onReconnect(oldEdge as FlowEdge, connection)}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onNodeDragStart={handleDragStart}
        onNodeDrag={handleDrag}
        onNodeDragStop={handleDragStop}
        onPaneClick={clearSelection}
        onConnectStart={() => setConnecting(true)}
        onConnectEnd={() => setConnecting(false)}
        connectionMode={ConnectionMode.Loose}
        connectionRadius={32}
        deleteKeyCode={playing ? null : ['Delete', 'Backspace']}
        /* 剧本回放期间锁定画布编辑（拖拽 / 连线 / 重连） */
        nodesDraggable={!playing}
        nodesConnectable={!playing}
        edgesReconnectable={!playing}
        multiSelectionKeyCode={['Meta', 'Control', 'Shift']}
        /* 框选：左键拖出选框；开启时平移改成中键/右键拖动或按住空格 */
        selectionOnDrag={boxSelect}
        panOnDrag={boxSelect ? [1, 2] : true}
        selectionMode={SelectionMode.Partial}
        panActivationKeyCode="Space"
        selectionKeyCode="Shift"
        snapToGrid={settings.snapToGrid}
        snapGrid={[16, 16]}
        minZoom={0.15}
        maxZoom={2.5}
        fitView
        fitViewOptions={{ padding: 0.25, maxZoom: 1.2 }}
        proOptions={{ hideAttribution: true }}
        defaultEdgeOptions={{ type: 'ms' }}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1.4} color="var(--grid-dot)" />
        <Controls showInteractive={false} />
      </ReactFlow>

      {isEmpty ? (
        <div className="ms-empty">
          <div className="ms-empty__title">画布是空的</div>
          <div className="ms-empty__hint">
            从左侧「节点块」拖拽节点到这里，
            <br />
            拖动节点边缘的小圆点即可连线。
          </div>
        </div>
      ) : null}

      <SelectionActions />
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
