import { useEffect, useMemo, useRef, useState } from 'react'
import {
  EdgeLabelRenderer,
  getBezierPath,
  getSimpleBezierPath,
  getSmoothStepPath,
  getStraightPath,
  useReactFlow,
  type EdgeProps,
} from '@xyflow/react'
import type { EdgeData, FlowEdge, MarkerKind } from '../types'
import { DEFAULT_EDGE_DATA } from '../types'
import { useStore } from '../store'
import { normalizeEdgeType, parseEdgeLabel } from '../lib/edgeLabels'

function markerNode(kind: MarkerKind, color: string) {
  switch (kind) {
    case 'arrow':
      return <path d="M0,0.5 L10,5 L0,9.5 z" fill={color} />
    case 'circle':
      return <circle cx="5" cy="5" r="4" fill={color} />
    case 'cross':
      return (
        <path
          d="M1.2,1.2 L8.8,8.8 M8.8,1.2 L1.2,8.8"
          stroke={color}
          strokeWidth="2.4"
          strokeLinecap="round"
          fill="none"
        />
      )
    default:
      return null
  }
}

function refFor(kind: MarkerKind): { refX: number; refY: number } {
  if (kind === 'arrow') return { refX: 10, refY: 5 }
  return { refX: 5, refY: 5 }
}

interface Pt {
  x: number
  y: number
}

const round1 = (n: number) => Math.round(n * 10) / 10

/** 有手动拐点时，用「折线 + 圆角」画，不再走曲线预设 */
function polylinePath(points: Pt[], radius = 16): string {
  if (points.length < 2) return ''
  let d = `M ${round1(points[0].x)},${round1(points[0].y)}`
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1]
    const cur = points[i]
    const next = points[i + 1]
    const inLen = Math.hypot(cur.x - prev.x, cur.y - prev.y) || 1
    const outLen = Math.hypot(next.x - cur.x, next.y - cur.y) || 1
    const r = Math.min(radius, inLen / 2, outLen / 2)
    const a = { x: cur.x + ((prev.x - cur.x) / inLen) * r, y: cur.y + ((prev.y - cur.y) / inLen) * r }
    const b = { x: cur.x + ((next.x - cur.x) / outLen) * r, y: cur.y + ((next.y - cur.y) / outLen) * r }
    d += ` L ${round1(a.x)},${round1(a.y)} Q ${round1(cur.x)},${round1(cur.y)} ${round1(b.x)},${round1(b.y)}`
  }
  const last = points[points.length - 1]
  d += ` L ${round1(last.x)},${round1(last.y)}`
  return d
}

const isVerticalSide = (p?: string) => p === 'top' || p === 'bottom'

interface RouteHandle {
  /** 插到 waypoints 的第几个位置 */
  insertAt: number
  /** 「＋」所在的画布坐标（离线一小段，避免和标签/线本身重叠） */
  at: Pt
}

interface Route {
  points: Pt[]
  handles: RouteHandle[]
}

/** 取一段（最多两小节）里最长小节的中点，再垂直偏移一点 */
function offsetHandle(leg: Pt[], offset = 16): Pt {
  let best = { from: leg[0], to: leg[1], len: 0 }
  for (let i = 1; i < leg.length; i++) {
    const len = Math.hypot(leg[i].x - leg[i - 1].x, leg[i].y - leg[i - 1].y)
    if (len > best.len) best = { from: leg[i - 1], to: leg[i], len }
  }
  const dx = best.to.x - best.from.x
  const dy = best.to.y - best.from.y
  const len = Math.hypot(dx, dy) || 1
  const mid = { x: (best.from.x + best.to.x) / 2, y: (best.from.y + best.to.y) / 2 }
  return { x: mid.x + (-dy / len) * offset, y: mid.y + (dx / len) * offset }
}

/**
 * 把「端点 + 手动拐点」变成画布路径点，并给每一段算一个「＋」位置：
 *   - orthogonal=true（默认）：只留横竖段，从源端口出发先顺端口朝向、最后垂直插进目标端口，
 *     节点被拖动后会自动重排成直角，不会出现斜线；
 *   - orthogonal=false（显式选了「直线」）：保持两点直连。
 */
function routePoints(pts: Pt[], sourceVertical: boolean, targetVertical: boolean, orthogonal: boolean): Route {
  const clean = pts.filter((p, i) => i === 0 || Math.abs(p.x - pts[i - 1].x) > 0.01 || Math.abs(p.y - pts[i - 1].y) > 0.01)
  if (clean.length < 2) return { points: clean, handles: [] }
  const points: Pt[] = [clean[0]]
  const handles: RouteHandle[] = []
  let lastAxis: 'h' | 'v' = sourceVertical ? 'v' : 'h'
  for (let i = 0; i < clean.length - 1; i++) {
    const a = points[points.length - 1]
    const b = clean[i + 1]
    const dx = Math.abs(b.x - a.x)
    const dy = Math.abs(b.y - a.y)
    let leg: Pt[] = [a, b]
    if (orthogonal && dx >= 0.5 && dy >= 0.5) {
      const isLast = i === clean.length - 2
      const firstAxis: 'h' | 'v' =
        i === 0 ? (sourceVertical ? 'v' : 'h') : isLast ? (targetVertical ? 'h' : 'v') : lastAxis === 'v' ? 'h' : 'v'
      leg = [a, firstAxis === 'v' ? { x: a.x, y: b.y } : { x: b.x, y: a.y }, b]
      lastAxis = firstAxis === 'v' ? 'h' : 'v'
    } else if (dy >= 0.5 && dx < 0.5) {
      lastAxis = 'v'
    } else if (dx >= 0.5 && dy < 0.5) {
      lastAxis = 'h'
    }
    for (const p of leg.slice(1)) points.push(p)
    const mid = offsetHandle(leg)
    if (Math.hypot(b.x - a.x, b.y - a.y) >= 26) handles.push({ insertAt: i, at: mid })
  }
  return { points, handles }
}

/** 折线上的中点（按长度取 50%），用来放标签 */
function polylineMid(points: Pt[]): Pt {
  const segs = points.slice(1).map((p, i) => Math.hypot(p.x - points[i].x, p.y - points[i].y))
  const total = segs.reduce((a, b) => a + b, 0)
  let walk = total / 2
  for (let i = 0; i < segs.length; i++) {
    if (walk <= segs[i]) {
      const t = segs[i] ? walk / segs[i] : 0
      return {
        x: points[i].x + (points[i + 1].x - points[i].x) * t,
        y: points[i].y + (points[i + 1].y - points[i].y) * t,
      }
    }
    walk -= segs[i]
  }
  return points[points.length - 1]
}

export function FlowEdgeView({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
  label,
}: EdgeProps<FlowEdge>) {
  const d: EdgeData = { ...DEFAULT_EDGE_DATA, ...(data ?? {}) }
  const updateEdgeData = useStore((s) => s.updateEdgeData)
  const pushHistory = useStore((s) => s.pushHistory)
  const selectEdge = useStore((s) => s.selectEdge)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(String(label ?? ''))
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) {
      setDraft(String(label ?? ''))
      requestAnimationFrame(() => inputRef.current?.select())
    }
  }, [editing, label])

  // 剧本回放：事件触发的连线闪烁
  const blinkAt = useStore((s) => s.player.blink[id]) ?? 0
  const blinking = blinkAt > 0 && Date.now() - blinkAt < 900
  const color = selected ? 'var(--accent)' : d.stroke || DEFAULT_EDGE_DATA.stroke

  const { screenToFlowPosition } = useReactFlow()
  // 防御：老数据/手改 JSON 里可能有非法拐点，过滤掉免得整条边崩掉
  const waypoints = ((d.waypoints ?? []) as Pt[]).filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y))
  const pathRef = useRef<SVGPathElement>(null)
  const [addPos, setAddPos] = useState<Pt | null>(null)
  const [dragIndex, setDragIndex] = useState<number | null>(null)

  const route = useMemo(() => {
    if (!waypoints.length) return null
    const raw = [{ x: sourceX, y: sourceY }, ...waypoints, { x: targetX, y: targetY }]
    return routePoints(raw, isVerticalSide(sourcePosition), isVerticalSide(targetPosition), d.curve !== 'straight')
  }, [d.curve, d.waypoints, sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition])

  const [path, labelX, labelY] = useMemo(() => {
    if (route) {
      const mid = polylineMid(route.points)
      return [polylinePath(route.points), mid.x, mid.y]
    }
    const params = { sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition }
    switch (d.curve) {
      case 'straight':
        return getStraightPath(params)
      case 'step':
        return getSmoothStepPath({ ...params, borderRadius: 0 })
      case 'smoothstep':
        return getSmoothStepPath({ ...params, borderRadius: 14 })
      case 'simplebezier':
        return getSimpleBezierPath(params)
      default:
        return getBezierPath(params)
    }
  }, [route, d.curve, sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition])

  // 选中且还没有拐点时，在路径中点旁边浮一个「＋」，拖出来就得到第一个拐点
  useEffect(() => {
    if (!selected || waypoints.length) {
      setAddPos(null)
      return
    }
    const el = pathRef.current
    if (!el) return
    const total = el.getTotalLength()
    if (!total) return
    const a = el.getPointAtLength(Math.max(0, total / 2 - 6))
    const b = el.getPointAtLength(Math.min(total, total / 2 + 6))
    const dx = b.x - a.x
    const dy = b.y - a.y
    const len = Math.hypot(dx, dy) || 1
    const nx = -dy / len
    const ny = dx / len
    setAddPos({ x: a.x + dx / 2 + nx * 22, y: a.y + dy / 2 + ny * 22 })
  }, [selected, path, waypoints.length])

  // 拖拐点：按指针位置更新画布坐标（一次拖拽只进一次撤销栈）
  useEffect(() => {
    if (dragIndex === null) return
    const move = (ev: PointerEvent) => {
      const st = useStore.getState()
      const edge = st.doc.edges.find((e) => e.id === id)
      const wps = ((edge?.data?.waypoints as Pt[] | undefined) ?? []).map((w, i) =>
        i === dragIndex ? screenToFlowPosition({ x: ev.clientX, y: ev.clientY }) : w,
      )
      st.updateEdgeData(id, { waypoints: wps })
    }
    const up = () => setDragIndex(null)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up, { once: true })
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  }, [dragIndex, id, screenToFlowPosition])

  const beginWaypointDrag = (index: number) => (ev: React.PointerEvent) => {
    ev.stopPropagation()
    ev.preventDefault()
    pushHistory()
    setDragIndex(index)
  }

  /** 在某一「段」上加拐点：返回的 insertAt 决定它插在 waypoints 的第几位 */
  const addWaypointAt = (insertAt: number, at: Pt) => (ev: React.PointerEvent) => {
    ev.stopPropagation()
    ev.preventDefault()
    pushHistory()
    const next = [...waypoints]
    next.splice(insertAt, 0, at)
    updateEdgeData(id, { waypoints: next })
    setDragIndex(insertAt)
  }

  const removeWaypoint = (index: number) => (ev: React.MouseEvent) => {
    ev.stopPropagation()
    pushHistory()
    updateEdgeData(id, { waypoints: waypoints.filter((_, i) => i !== index) })
  }

  const width = d.lineStyle === 'thick' ? (d.strokeWidth || 2) * 1.7 : d.strokeWidth || 2
  const dash = d.lineStyle === 'dashed' ? '7 6' : undefined
  const startId = `ms-mk-${id}-start`
  const endId = `ms-mk-${id}-end`

  const startEdit = () => {
    setEditing(true)
  }

  const commit = () => {
    setEditing(false)
    const next = draft.trim()
    if (next === String(label ?? '').trim()) return
    pushHistory()
    // 标签规范：类型 或 类型: 说明
    const parsed = parseEdgeLabel(next)
    const currentType = normalizeEdgeType(d.type)
    if (parsed.type) {
      // 直接打「写: order_data」这种完整标签
      updateEdgeData(id, { type: parsed.type, note: parsed.note })
    } else if (currentType) {
      // 已有类型：把输入当成说明
      updateEdgeData(id, { type: currentType, note: next })
    } else {
      updateEdgeData(id, { label: next })
    }
  }

  return (
    <>
      <defs>
        {d.startMarker !== 'none' ? (
          <marker
            id={startId}
            viewBox="0 0 10 10"
            markerWidth={15}
            markerHeight={15}
            markerUnits="userSpaceOnUse"
            orient="auto-start-reverse"
            {...refFor(d.startMarker)}
          >
            {markerNode(d.startMarker, String(color))}
          </marker>
        ) : null}
        {d.endMarker !== 'none' ? (
          <marker
            id={endId}
            viewBox="0 0 10 10"
            markerWidth={15}
            markerHeight={15}
            markerUnits="userSpaceOnUse"
            orient="auto"
            {...refFor(d.endMarker)}
          >
            {markerNode(d.endMarker, String(color))}
          </marker>
        ) : null}
      </defs>

      <path
        ref={pathRef}
        d={path}
        fill="none"
        className={`react-flow__edge-path${d.animated ? ' ms-edge--animated' : ''}${blinking ? ' ms-edge--blink' : ''}`}
        markerStart={d.startMarker !== 'none' ? `url(#${startId})` : undefined}
        markerEnd={d.endMarker !== 'none' ? `url(#${endId})` : undefined}
        style={{
          stroke: color,
          strokeWidth: width,
          strokeDasharray: dash,
          strokeLinecap: 'round',
        }}
      />
      {/* 加宽的透明点击区：单击选连线，双击编辑标签。
          必须显式给个颜色：React Flow 的 .react-flow__edge 用的是
          pointer-events: visibleStroke，stroke:none 的元素收不到点击 */}
      <path
        d={path}
        fill="none"
        stroke="transparent"
        strokeOpacity={0}
        strokeWidth={26}
        className="react-flow__edge-interaction"
        onDoubleClick={(ev) => {
          ev.stopPropagation()
          startEdit()
        }}
        style={{ cursor: 'pointer' }}
      />

      <EdgeLabelRenderer>
        <div
          className={`ms-edge-label-wrap nodrag nopan${editing ? ' is-editing' : ''}`}
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            pointerEvents: 'all',
          }}
          onClick={(ev) => {
            // 标签浮层在连线中点上，点它也要能选中这条连线
            ev.stopPropagation()
            selectEdge(id)
          }}
          onDoubleClick={(ev) => {
            ev.stopPropagation()
            startEdit()
          }}
          title="双击编辑标签"
        >
          {editing ? (
            <input
              ref={inputRef}
              className="ms-edge-label-input"
              value={draft}
              placeholder="连线标签"
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === 'Enter') commit()
                if (e.key === 'Escape') setEditing(false)
              }}
            />
          ) : label ? (
            <span className="ms-edge-label">{label}</span>
          ) : (
            <span className="ms-edge-label ms-edge-label--empty">＋</span>
          )}
        </div>

        {/* 走位手柄放在标签层里、且排在标签之后：即使和标签同坐标也压在上面，能拖能双击删 */}
        {selected
          ? waypoints.map((w, i) => (
              <div
                key={`wp-${i}`}
                className="ms-edge-waypoint nodrag nopan"
                style={{ transform: `translate(-50%, -50%) translate(${w.x}px, ${w.y}px)` }}
                onPointerDown={beginWaypointDrag(i)}
                onDoubleClick={removeWaypoint(i)}
                title="拖动改走向；双击删掉这个拐点"
              />
            ))
          : null}
        {selected && route
          ? route.handles.map((h) => (
              <div
                key={`add-${h.insertAt}`}
                className="ms-edge-waypoint-add nodrag nopan"
                style={{ transform: `translate(-50%, -50%) translate(${h.at.x}px, ${h.at.y}px)` }}
                onPointerDown={addWaypointAt(h.insertAt, h.at)}
                title="拖出来在这一段加一个拐点"
              >
                ＋
              </div>
            ))
          : null}
        {selected && !waypoints.length && addPos ? (
          <div
            className="ms-edge-waypoint-add nodrag nopan"
            style={{ transform: `translate(-50%, -50%) translate(${addPos.x}px, ${addPos.y}px)` }}
            onPointerDown={addWaypointAt(0, addPos)}
            title="拖出来加一个拐点"
          >
            ＋
          </div>
        ) : null}
      </EdgeLabelRenderer>
    </>
  )
}
