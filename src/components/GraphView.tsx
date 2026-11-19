import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type NodeChange,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useStore } from '../store'
import { getRfInstance, setRfInstance } from '../lib/rf'
import { bfsHops, deriveGraphModel, graphSignature } from '../lib/graphModel'
import { DEFAULT_SEED, defaultRootId, layoutGraph } from '../lib/graphLayout'
import { DOT_ANCHOR_Y, GraphDotNode, NODE_H, NODE_W, dotSize, type GraphDotNodeModel } from './GraphDotNode'
import { GraphEdgeView, type GraphEdgeModel } from './GraphEdgeView'

const nodeTypes = { dot: GraphDotNode }
const edgeTypes = { graph: GraphEdgeView }

/** 超过这个规模，点会开始糊在一起——提示一下，但不拦着 */
const BUSY_NODES = 250

/**
 * 换焦点后延迟一点再重排。
 * 立即重排的话，单击的瞬间节点就挪到光标外，真实的双击永远打不中；
 * 延迟窗口内收到第二下 click（detail=2）就当作双击，撤销这次重排。
 */
const FOCUS_DELAY_MS = 280

type Point = { x: number; y: number }

/** 布局算的是"圆点中心"，React Flow 的 position 是框的左上角 */
function toNodePosition(center: Point): Point {
  return { x: center.x - NODE_W / 2, y: center.y - DOT_ANCHOR_Y }
}

/** 反算：拖动后的框左上角 → 圆点中心 */
function toAnchor(position: Point): Point {
  return { x: position.x + NODE_W / 2, y: position.y + DOT_ANCHOR_Y }
}

type Depth = 1 | 2 | 'all'

function GraphViewInner() {
  const doc = useStore((s) => s.doc)
  const selectOnly = useStore((s) => s.selectOnly)
  const clearSelection = useStore((s) => s.clearSelection)
  const updateSettings = useStore((s) => s.updateSettings)
  const { setCenter } = useReactFlow()

  /**
   * 打开图谱时默认就有一个焦点：流程图里选中的表，否则取度数最高的表。
   * 没有焦点时，一张链式的图会被摆成一条横线——那不叫"圆心聚焦"。
   */
  const [initialFocus] = useState<string | null>(() => {
    const initialModel = deriveGraphModel(doc)
    const selected = doc.nodes.find((n) => n.selected)?.id
    if (selected && initialModel.nodes.some((n) => n.id === selected)) return selected
    return defaultRootId(initialModel)
  })

  /** 高亮用的焦点：立即生效 */
  const [focusId, setFocusId] = useState<string | null>(initialFocus)
  /** 布局用的焦点：延迟生效，给双击留出窗口 */
  const [layoutFocus, setLayoutFocus] = useState<string | null>(initialFocus)
  const focusTimer = useRef<number | null>(null)
  const [depth, setDepth] = useState<Depth>(1)
  const [onlyOpen, setOnlyOpen] = useState(false)
  const [seed, setSeed] = useState(DEFAULT_SEED)
  /**
   * 手动拖动过的点：只存在视图里（不写回文档），布局重算时优先用这里的坐标。
   * 这是"拖节点 = 把节点摆在我想看的位置"，不是编辑图结构。
   */
  const [overrides, setOverrides] = useState<Record<string, { x: number; y: number }>>({})

  const model = useMemo(() => deriveGraphModel(doc), [doc.nodes, doc.edges])
  const signature = useMemo(() => graphSignature(model), [model])

  // 布局只在"结构"变化或点「重排」时重算：
  // 拖动画布节点不触发；**聚焦也不触发**——点一下就把节点挪到光标外，双击就没法用了
  const positions = useMemo(
    () =>
      layoutGraph(model, {
        seed,
        // 焦点在圆心：它 0 跳，邻居一圈一圈往外
        rootId: layoutFocus,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [signature, seed, layoutFocus],
  )

  const scheduleLayoutFocus = useCallback((id: string | null) => {
    if (focusTimer.current) {
      clearTimeout(focusTimer.current)
      focusTimer.current = null
    }
    if (id === null) {
      setLayoutFocus(null)
      return
    }
    focusTimer.current = window.setTimeout(() => {
      // 焦点要被钉到圆心，所以在真正重排的那一刻，才让出它自己的手动位置。
      // 提前让出的话，节点会在第一下点击和双击的第二下之间跳走。
      setOverrides((prev) => {
        if (!(id in prev)) return prev
        const next = { ...prev }
        delete next[id]
        return next
      })
      setLayoutFocus(id)
    }, FOCUS_DELAY_MS)
  }, [])

  /** 拖动节点：只更新视图内的坐标，不碰文档、不进撤销栈 */
  const onNodesChange = useCallback((changes: NodeChange[]) => {
    const moves = changes.filter(
      (c): c is Extract<NodeChange, { type: 'position' }> => c.type === 'position' && Boolean(c.position),
    )
    if (!moves.length) return
    setOverrides((prev) => {
      const next = { ...prev }
      for (const m of moves) if (m.position) next[m.id] = toAnchor(m.position)
      return next
    })
  }, [])

  useEffect(
    () => () => {
      if (focusTimer.current) clearTimeout(focusTimer.current)
    },
    [],
  )
  const hops = useMemo(
    () => (focusId ? bfsHops(model, focusId) : new Map<string, number>()),
    [model, focusId],
  )

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
          position: toNodePosition(overrides[n.id] ?? positions.get(n.id) ?? { x: 0, y: 0 }),
          width: NODE_W,
          height: NODE_H,
          // 焦点压在最上层：标签互相重叠时，至少焦点这张读得清
          zIndex: isFocus ? 2 : 1,
          connectable: false,
          data: {
            label: n.label,
            degree: n.degree,
            groupIndex: n.groupIndex,
            hop: hop ?? null,
            isFocus,
            isDim,
          },
        }
      }),
    [model, hops, focusId, depth, positions, overrides],
  )

  const dimIds = useMemo(
    () => new Set(nodes.filter((n) => n.data.isDim).map((n) => n.id)),
    [nodes],
  )

  const degreeOf = useMemo(() => new Map(model.nodes.map((n) => [n.id, n.degree])), [model])

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
            // 圆点大小随度数变，线要缩到各自圆点的边缘
            sourceR: dotSize(degreeOf.get(e.source) ?? 0) / 2,
            targetR: dotSize(degreeOf.get(e.target) ?? 0) / 2,
          },
        })),
    [model, onlyOpen, dimIds, degreeOf],
  )

  // 卸载时把单例清掉：否则"双击回流程图"的第一帧会对着已经卸载的画布 fitView
  useEffect(() => () => setRfInstance(null), [])

  /**
   * 视口：有焦点时把焦点（布局原点）摆到画布正中心，没焦点时把整张图摆中间。
   * 缩放自己算，不用 fitView 之后再 setCenter——fitView 带动画、promise 不等动画结束，
   * 后到的 setCenter 会被它的动画覆盖掉（这就是之前怎么调都偏一截的原因）。
   */
  useEffect(() => {
    const container = document.querySelector<HTMLElement>('.ms-canvas--graph .react-flow')
    const width = container?.clientWidth ?? 900
    const height = container?.clientHeight ?? 600
    let minX = Infinity
    let maxX = -Infinity
    let minY = Infinity
    let maxY = -Infinity
    for (const n of model.nodes) {
      const c = overrides[n.id] ?? positions.get(n.id)
      if (!c) continue
      minX = Math.min(minX, c.x)
      maxX = Math.max(maxX, c.x)
      minY = Math.min(minY, c.y)
      maxY = Math.max(maxY, c.y)
    }
    if (!Number.isFinite(minX)) return
    const PAD = 80
    const zoom = Math.max(
      0.1,
      Math.min(
        1.15,
        (width - PAD * 2) / Math.max(1, maxX - minX + NODE_W),
        (height - PAD * 2) / Math.max(1, maxY - minY + NODE_H),
      ),
    )
    if (layoutFocus) setCenter(0, 0, { zoom, duration: 200 })
    else setCenter((minX + maxX) / 2, (minY + maxY) / 2, { zoom, duration: 200 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutFocus, seed, setCenter])

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
        scheduleLayoutFocus(null)
        clearSelection()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [clearSelection, scheduleLayoutFocus])

  /** 双击回流程图并定位这张表：图谱卸载、画布挂载之后才能 fitView */
  const jumpToFlow = useCallback(
    (id: string) => {
      if (focusTimer.current) {
        clearTimeout(focusTimer.current)
        focusTimer.current = null
      }
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
        onNodesChange={onNodesChange}
        onNodeClick={(e, n) => {
          // 双击的第二下 click 带 detail=2：用它回到流程图并定位（比 onNodeDoubleClick 稳）
          if (e.detail >= 2) {
            jumpToFlow(n.id)
            return
          }
          setFocusId(n.id)
          scheduleLayoutFocus(n.id)
          selectOnly([n.id])
        }}
        onPaneClick={() => {
          setFocusId(null)
          scheduleLayoutFocus(null)
          clearSelection()
        }}
        nodesConnectable={false}
        edgesFocusable={false}
        elementsSelectable={false}
        minZoom={0.1}
        maxZoom={2.5}
        /* 不传 fitView：初始化时的自动 fit 会把下面"把焦点摆到圆心"的 setCenter 覆盖掉 */
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
        <button
          className="ms-btn ms-btn--sm"
          onClick={() => {
            setOverrides({})
            setSeed(Date.now() % 100000)
          }}
          title="重新排一次（清掉手动摆放）"
        >
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
