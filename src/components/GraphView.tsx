import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useStore } from '../store'
import { getRfInstance, setRfInstance } from '../lib/rf'
import { bfsHops, deriveGraphModel } from '../lib/graphModel'
import { graphSignature, layoutGraph } from '../lib/graphLayout'
import { GraphDotNode, type GraphDotNodeModel } from './GraphDotNode'
import { GraphEdgeView, type GraphEdgeModel } from './GraphEdgeView'

const nodeTypes = { dot: GraphDotNode }
const edgeTypes = { graph: GraphEdgeView }

/** 超过这个规模，点会开始糊在一起——提示一下，但不拦着 */
const BUSY_NODES = 250

type Depth = 1 | 2 | 'all'

function GraphViewInner() {
  const doc = useStore((s) => s.doc)
  const selectOnly = useStore((s) => s.selectOnly)
  const clearSelection = useStore((s) => s.clearSelection)
  const updateSettings = useStore((s) => s.updateSettings)
  const { fitView } = useReactFlow()

  const [focusId, setFocusId] = useState<string | null>(null)
  const [depth, setDepth] = useState<Depth>(1)
  const [onlyOpen, setOnlyOpen] = useState(false)
  const [expanded, setExpanded] = useState<string[]>([])
  const [seed, setSeed] = useState(20261113)
  const expandedKey = expanded.join(',')

  const model = useMemo(() => deriveGraphModel(doc), [doc.nodes, doc.edges])
  const signature = useMemo(() => graphSignature(model), [model])

  // 布局只在"结构"变化或点「重排」时重算：
  // 拖动画布节点不触发；**聚焦也不触发**——点一下就把节点挪到光标外，双击就没法用了
  const positions = useMemo(
    () =>
      layoutGraph(model, {
        seed,
        // 展开成卡片的点要占更大的位置，否则会压住邻居
        radiusOf: (id) => (expanded.includes(id) ? 130 : 64),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [signature, seed, expandedKey],
  )
  const hops = useMemo(
    () => (focusId ? bfsHops(model, focusId) : new Map<string, number>()),
    [model, focusId],
  )

  const toggleExpand = useCallback((id: string) => {
    setExpanded((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }, [])

  const nodes = useMemo<GraphDotNodeModel[]>(
    () =>
      model.nodes.map((n) => {
        const hop = hops.get(n.id)
        const isFocus = n.id === focusId
        const isDim =
          focusId !== null && !isFocus && (hop === undefined || (depth !== 'all' && hop > depth))
        return {
          id: n.id,
          type: 'dot',
          position: positions.get(n.id) ?? { x: 0, y: 0 },
          draggable: false,
          connectable: false,
          data: {
            label: n.label,
            fieldCount: n.fieldCount,
            columns: n.columns,
            groupIndex: n.groupIndex,
            hop: hop ?? null,
            isFocus,
            isNear: !isDim,
            isDim,
            expanded: expanded.includes(n.id),
            onToggleExpand: toggleExpand,
          },
        }
      }),
    [model, hops, focusId, depth, positions, expanded, toggleExpand],
  )

  const dimIds = useMemo(
    () => new Set(nodes.filter((n) => n.data.isDim).map((n) => n.id)),
    [nodes],
  )

  const edges = useMemo<GraphEdgeModel[]>(
    () =>
      model.edges
        .filter((e) => !onlyOpen || e.dashed)
        .map((e) => ({
          id: e.id,
          source: e.source,
          target: e.target,
          type: 'graph',
          data: {
            dashed: e.dashed,
            warn: e.warn,
            arrow: e.arrow,
            label: e.label,
            dim: dimIds.has(e.source) || dimIds.has(e.target),
          },
        })),
    [model, onlyOpen, dimIds],
  )

  // 重排后把整张图重新装进视口；聚焦只压暗，不动视口
  useEffect(() => {
    fitView({ padding: 0.3, duration: 260, maxZoom: 1.15 })
  }, [seed, expandedKey, fitView])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === '1') setDepth(1)
      else if (e.key === '2') setDepth(2)
      else if (e.key === '0') setDepth('all')
      else if (e.key === 'Escape') {
        setFocusId(null)
        clearSelection()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [clearSelection])

  /** 双击回流程图并定位这张表：图谱卸载、画布挂载之后才能 fitView */
  const jumpToFlow = useCallback(
    (id: string) => {
      updateSettings({ viewMode: 'flow' })
      let tries = 0
      const tick = () => {
        if (getRfInstance()) {
          selectOnly([id], true)
          return
        }
        if (tries++ > 20) return
        requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    },
    [updateSettings, selectOnly],
  )

  const isEmpty = model.nodes.length === 0

  return (
    <div className="ms-canvas ms-canvas--graph" data-ms-view="graph">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onInit={(inst) => setRfInstance(inst)}
        onNodeClick={(e, n) => {
          // 双击的第二下 click 带 detail=2：用它回到流程图并定位（比 onNodeDoubleClick 稳）
          if (e.detail >= 2) {
            jumpToFlow(n.id)
            return
          }
          setFocusId(n.id)
          selectOnly([n.id])
        }}
        onNodeDoubleClick={(_e, n) => jumpToFlow(n.id)}
        onPaneClick={() => {
          setFocusId(null)
          clearSelection()
        }}
        nodesDraggable={false}
        nodesConnectable={false}
        edgesFocusable={false}
        elementsSelectable={false}
        minZoom={0.1}
        maxZoom={2.5}
        fitView
        fitViewOptions={{ padding: 0.3, maxZoom: 1.15 }}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1.4} color="var(--grid-dot)" />
        <Controls showInteractive={false} />
      </ReactFlow>

      <div className="ms-graph-hud">
        <span className="ms-graph-hud__label">跳数</span>
        <div className="ms-seg" role="group" aria-label="跳数">
          {([1, 2] as const).map((d) => (
            <button
              key={d}
              className={`ms-seg__btn${depth === d ? ' is-active' : ''}`}
              data-depth={d}
              onClick={() => setDepth(d)}
              title={`只看 ${d} 跳以内`}
            >
              {d}
            </button>
          ))}
          <button
            className={`ms-seg__btn${depth === 'all' ? ' is-active' : ''}`}
            data-depth="all"
            onClick={() => setDepth('all')}
            title="全部显示"
          >
            全部
          </button>
        </div>
        <label className="ms-graph-hud__check" title="只留虚线（待确认项）">
          <input type="checkbox" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} />
          只看待确认
        </label>
        <button className="ms-btn ms-btn--sm" onClick={() => setSeed(Date.now() % 100000)} title="重新排一次">
          重排
        </button>
      </div>

      {isEmpty ? (
        <div className="ms-empty">
          <div className="ms-empty__title">这张图还没有可看的表</div>
          <div className="ms-empty__hint">
            关系图谱只画有实体意义的节点：
            <br />
            分组框、隐藏元素和不带连线的纯文本不会出现在这里。
          </div>
        </div>
      ) : null}

      {model.nodes.length > BUSY_NODES ? (
        <div className="ms-graph-busy">这张图有 {model.nodes.length} 个节点，建议先聚焦到 1~2 跳再看。</div>
      ) : null}
    </div>
  )
}

export function GraphView() {
  return (
    <ReactFlowProvider>
      <GraphViewInner />
    </ReactFlowProvider>
  )
}
