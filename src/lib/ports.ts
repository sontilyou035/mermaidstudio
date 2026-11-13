import {
  DEFAULT_EDGE_DATA,
  type BlockDef,
  type Direction,
  type FlowEdge,
  type FlowNode,
  type Port,
  type PortPosition,
} from '../types'

export const PORT_POSITION_LABELS: Record<PortPosition, string> = {
  top: '上',
  right: '右',
  bottom: '下',
  left: '左',
}

/**
 * 骨架方向 → 默认的「出 / 入」侧。
 *
 * 原则是「上进下出、左进右出」：连线从头和尾**顺着**骨架方向走，
 * 而不是从上方出来、再钻回下方——
 *   TB（瀑布式）：下出 上入      BT：上出 下入
 *   LR（泳道式）：右出 左入      RL：左出 右入
 */
export function defaultPortSides(direction: Direction): { out: PortPosition; in: PortPosition } {
  switch (direction) {
    case 'BT':
      return { out: 'top', in: 'bottom' }
    case 'LR':
      return { out: 'right', in: 'left' }
    case 'RL':
      return { out: 'left', in: 'right' }
    case 'TB':
    default:
      return { out: 'bottom', in: 'top' }
  }
}

/** 端口不够用时的退让顺序（先同侧，再同轴，最后随便） */
const PICK_ORDER: Record<PortPosition, PortPosition[]> = {
  bottom: ['bottom', 'right', 'left', 'top'],
  top: ['top', 'right', 'left', 'bottom'],
  right: ['right', 'bottom', 'top', 'left'],
  left: ['left', 'bottom', 'top', 'right'],
}

/**
 * 在节点自己的端口里挑一个最接近 wanted 的。
 * 自定义块的端口 id / 数量都可能和内置块不同（比如「注释」只有左右两个口），
 * 所以这里只按 position 找，并允许退让；实在没有就返回 null（连线不画）。
 */
export function pickPortId(ports: Port[], wanted: PortPosition, role: 'source' | 'target'): string | null {
  if (!ports.length) return null
  const order = PICK_ORDER[wanted]
  const usable = ports.filter((p) => p.kind === 'both' || p.kind === role)
  const pool = usable.length ? usable : ports
  const ranked = [...pool].sort((a, b) => order.indexOf(a.position) - order.indexOf(b.position))
  return ranked[0]?.id ?? null
}

/** nodeId → 该节点可用端口（走 blockId 查块定义） */
export function portGetter(nodes: FlowNode[], blocks: BlockDef[]): (nodeId: string) => Port[] {
  const nodeById = new Map(nodes.map((n) => [n.id, n]))
  const blockById = new Map(blocks.map((b) => [b.id, b]))
  return (nodeId: string) => {
    const node = nodeById.get(nodeId)
    const block = node ? blockById.get(node.data.blockId) : undefined
    return block?.ports ?? []
  }
}

/**
 * 这条边是否该跟着骨架方向自动找端口：
 *   auto   → 是（导入 / 新建 / 切换骨架方向）
 *   manual → 否（用户拖过端点或在检查器里指定过）
 * 老数据没有 handleMode：两端都记着实心端口就算人工指定，否则算自动。
 */
export function usesAutoHandles(edge: FlowEdge): boolean {
  const mode = edge.data?.handleMode
  if (mode === 'manual') return false
  if (mode === 'auto') return true
  return !(edge.sourceHandle && edge.targetHandle)
}

/** 按方向给一条边算出端口，不关心它原来是 auto 还是 manual */
export function defaultHandlesFor(
  edge: FlowEdge,
  direction: Direction,
  portsOf: (nodeId: string) => Port[],
): { sourceHandle: string | null; targetHandle: string | null } {
  const { out, in: inSide } = defaultPortSides(direction)
  return {
    sourceHandle: pickPortId(portsOf(edge.source), out, 'source'),
    targetHandle: pickPortId(portsOf(edge.target), inSide, 'target'),
  }
}

/** 只改「端口归属」标记，不动其它数据 */
export function withHandleMode(edge: FlowEdge, mode: 'auto' | 'manual'): FlowEdge {
  return { ...edge, data: { ...(edge.data ?? DEFAULT_EDGE_DATA), handleMode: mode } }
}

/** 强制按方向重算一条边（用户点「恢复自动」时用） */
export function forceDefaultHandles(
  edge: FlowEdge,
  direction: Direction,
  portsOf: (nodeId: string) => Port[],
): FlowEdge {
  return { ...withHandleMode(edge, 'auto'), ...defaultHandlesFor(edge, direction, portsOf) }
}

/**
 * 批量套用默认端口；auto 的边会重算，manual 的边原样保留。
 * 没有变化的边保持同一个对象引用，避免无意义的 re-render。
 */
export function applyDefaultHandles(
  edges: FlowEdge[],
  direction: Direction,
  portsOf: (nodeId: string) => Port[],
): FlowEdge[] {
  let touched = false
  const next = edges.map((edge) => {
    if (!usesAutoHandles(edge)) {
      // 老数据里「两端都指定过」的边补上标记，之后就不会被反复判定
      if (!edge.data?.handleMode) {
        touched = true
        return withHandleMode(edge, 'manual')
      }
      return edge
    }
    const fixed = forceDefaultHandles(edge, direction, portsOf)
    const unchanged =
      fixed.sourceHandle === (edge.sourceHandle ?? null) &&
      fixed.targetHandle === (edge.targetHandle ?? null) &&
      edge.data?.handleMode === 'auto'
    if (unchanged) return edge
    touched = true
    return fixed
  })
  return touched ? next : edges
}
