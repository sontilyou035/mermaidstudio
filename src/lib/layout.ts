import dagre from '@dagrejs/dagre'
import type { Direction, FlowEdge, FlowNode } from '../types'

export interface LayoutOptions {
  direction?: Direction
  nodeSep?: number
  rankSep?: number
  /** dagre 排不出来时（图形畸形）退化成简单堆叠，回调用来提示用户 */
  onFallback?: () => void
}

const GROUP_PAD_X = 36
const GROUP_PAD_TOP = 54
const GROUP_PAD_BOTTOM = 30
const MIN_GROUP_W = 240
const MIN_GROUP_H = 140

interface Size {
  w: number
  h: number
}

interface Pos {
  x: number
  y: number
}

function nodeSize(n: FlowNode): Size {
  return { w: Math.max(1, n.data.width || 160), h: Math.max(1, n.data.height || 60) }
}

/**
 * 兜底排版：按顺序竖向堆叠。
 * dagre 对「多条平行边 + 跨级平行边」这类畸形图会抛异常（3.1.1 已知问题），
 * 这时候宁可按顺序摞起来，也不能让整张图导入失败。
 */
function fallbackPack(items: FlowNode[], sizes: Map<string, Size>, gap: number): Map<string, Pos> {
  const out = new Map<string, Pos>()
  let y = 0
  for (const it of items) {
    const s = sizes.get(it.id) ?? nodeSize(it)
    out.set(it.id, { x: 0, y })
    y += s.h + gap
  }
  return out
}

/**
 * 单层 dagre 布局：把 items 当成节点，返回每个 item 左上角坐标（相对本次布局的原点）。
 * 分组在上一层里也是普通节点，只是尺寸提前算好传进来。
 */
function pack(
  items: FlowNode[],
  sizes: Map<string, Size>,
  edges: FlowEdge[],
  direction: Direction,
  nodeSep: number,
  rankSep: number,
  onFallback?: () => void,
): Map<string, Pos> {
  const out = new Map<string, Pos>()
  if (!items.length) return out
  if (items.length === 1) {
    out.set(items[0].id, { x: 0, y: 0 })
    return out
  }
  const ids = new Set(items.map((i) => i.id))
  const g = new dagre.graphlib.Graph({ multigraph: true })
  g.setGraph({ rankdir: direction, nodesep: nodeSep, ranksep: rankSep, marginx: 0, marginy: 0 })
  g.setDefaultEdgeLabel(() => ({}))
  for (const it of items) {
    const s = sizes.get(it.id) ?? nodeSize(it)
    g.setNode(it.id, { width: s.w, height: s.h })
  }

  // 同一对节点之间的多条边只喂给 dagre 一条（权重记条数）：
  // 排版只关心「谁连谁、连得多密」，平行边喂多了 dagre 3 会算出退化交点直接抛错。
  const weights = new Map<string, number>()
  for (const e of edges) {
    if (!ids.has(e.source) || !ids.has(e.target)) continue
    const key = `${e.source}\u0000${e.target}`
    weights.set(key, (weights.get(key) ?? 0) + 1)
  }
  let n = 0
  for (const [key, weight] of weights) {
    const [v, w] = key.split('\u0000')
    g.setEdge(v, w, { weight }, `e${n++}`)
  }

  try {
    dagre.layout(g)
  } catch {
    onFallback?.()
    return fallbackPack(items, sizes, rankSep)
  }
  for (const it of items) {
    const p = g.node(it.id) as { x: number; y: number } | undefined
    const s = sizes.get(it.id) ?? nodeSize(it)
    if (p) out.set(it.id, { x: p.x - s.w / 2, y: p.y - s.h / 2 })
  }
  return out
}

/**
 * 自动排版（支持多级分组）：
 *   1. 先把分组树算清楚：每个分组「直接包含」的节点和子分组；
 *   2. 自底向上：子分组先排好、拿到尺寸，父分组再把它当超级节点排一次；
 *   3. 自顶向下：把相对坐标平移到画布坐标，分组盒子始终包住自己的成员；
 *   4. 最后按「分组在前（垫底）、节点从上到下」重排数组，避免分组盖住节点。
 */
export function autoLayout(nodes: FlowNode[], edges: FlowEdge[], opts: LayoutOptions = {}): FlowNode[] {
  if (!nodes.length) return nodes
  const direction = opts.direction ?? 'TB'
  const nodeSep = opts.nodeSep ?? 60
  const rankSep = opts.rankSep ?? 90
  // 分组内外的排版方向保持一致：TB 的图里，组内也是从上往下
  const innerDirection = direction

  const byId = new Map(nodes.map((n) => [n.id, n]))
  const groupIds = new Set(nodes.filter((n) => n.data.isSubgraph).map((n) => n.id))

  /** 节点的直接父分组（防自引用、防已删除的分组） */
  const parentOf = (n: FlowNode): string | null =>
    n.data.groupId && n.data.groupId !== n.id && groupIds.has(n.data.groupId) ? n.data.groupId : null

  // 分组树：gid -> 直接子元素（节点或子分组）
  const childrenOf = new Map<string, FlowNode[]>()
  for (const gid of groupIds) childrenOf.set(gid, [])
  const roots: FlowNode[] = []
  for (const n of nodes) {
    const gid = parentOf(n)
    if (gid) childrenOf.get(gid)!.push(n)
    else roots.push(n)
  }

  /** 把任意后代映射到它在某个分组下的「直接子元素」 */
  const directChild = (groupId: string, nodeId: string): string | null => {
    let cur = byId.get(nodeId)
    const seen = new Set<string>()
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id)
      const gid = parentOf(cur)
      if (gid === groupId) return cur.id
      if (!gid) return null
      cur = byId.get(gid)
    }
    return null
  }

  /** 把任意节点映射到它最顶层的祖先（顶层分组或独立节点） */
  const rootOf = (nodeId: string): string | null => {
    let cur = byId.get(nodeId)
    const seen = new Set<string>()
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id)
      const gid = parentOf(cur)
      if (!gid) return cur.id
      cur = byId.get(gid)
    }
    return null
  }

  // 每个分组的内部相对坐标与尺寸（自底向上）
  const innerPos = new Map<string, Map<string, Pos>>()
  const groupSize = new Map<string, Size>()
  const visiting = new Set<string>()

  const layoutGroup = (g: FlowNode): Size => {
    const cached = groupSize.get(g.id)
    if (cached) return cached
    if (visiting.has(g.id)) return { w: MIN_GROUP_W, h: MIN_GROUP_H } // 环形归属，兜底
    visiting.add(g.id)

    const children = childrenOf.get(g.id) ?? []
    const sizes = new Map<string, Size>()
    for (const c of children) sizes.set(c.id, c.data.isSubgraph ? layoutGroup(c) : nodeSize(c))

    // 只保留「跨直接子元素」的边，并把端点换成这一层的节点/子分组 id：
    // 子元素内部的边走不到这一层，直接子元素之间的边才是这一层要排的
    const innerEdges: FlowEdge[] = []
    for (const e of edges) {
      const s = directChild(g.id, e.source)
      const t = directChild(g.id, e.target)
      if (s && t && s !== t) innerEdges.push({ ...e, source: s, target: t })
    }
    const packed = pack(children, sizes, innerEdges, innerDirection, nodeSep, 70, opts.onFallback)

    let minX = 0
    let minY = 0
    let maxX = 0
    let maxY = 0
    let first = true
    for (const c of children) {
      const p = packed.get(c.id) ?? { x: 0, y: 0 }
      const s = sizes.get(c.id) ?? nodeSize(c)
      minX = first ? p.x : Math.min(minX, p.x)
      minY = first ? p.y : Math.min(minY, p.y)
      maxX = first ? p.x + s.w : Math.max(maxX, p.x + s.w)
      maxY = first ? p.y + s.h : Math.max(maxY, p.y + s.h)
      first = false
    }

    const dx = GROUP_PAD_X - minX
    const dy = GROUP_PAD_TOP - minY
    const rel = new Map<string, Pos>()
    for (const c of children) {
      const p = packed.get(c.id) ?? { x: 0, y: 0 }
      rel.set(c.id, { x: p.x + dx, y: p.y + dy })
    }
    innerPos.set(g.id, rel)

    const size: Size = first
      ? { w: MIN_GROUP_W, h: MIN_GROUP_H }
      : {
          w: Math.max(MIN_GROUP_W, Math.round(maxX - minX + GROUP_PAD_X * 2)),
          h: Math.max(MIN_GROUP_H, Math.round(maxY - minY + GROUP_PAD_TOP + GROUP_PAD_BOTTOM)),
        }
    groupSize.set(g.id, size)
    visiting.delete(g.id)
    return size
  }

  // 顶层布局
  const rootSizes = new Map<string, Size>()
  for (const r of roots) rootSizes.set(r.id, r.data.isSubgraph ? layoutGroup(r) : nodeSize(r))
  const rootEdges: FlowEdge[] = []
  for (const e of edges) {
    const s = rootOf(e.source)
    const t = rootOf(e.target)
    if (s && t && s !== t) rootEdges.push({ ...e, source: s, target: t })
  }
  const rootPacked = pack(roots, rootSizes, rootEdges, direction, nodeSep + 30, rankSep + 40, opts.onFallback)

  const pos = new Map<string, Pos>()
  const place = (id: string, at: Pos) => {
    const n = byId.get(id)
    if (!n) return
    pos.set(id, at)
    if (!n.data.isSubgraph) return
    for (const [cid, rel] of innerPos.get(id) ?? []) place(cid, { x: at.x + rel.x, y: at.y + rel.y })
  }
  for (const r of roots) place(r.id, rootPacked.get(r.id) ?? { x: 0, y: 0 })

  const next = nodes.map((n) => {
    const p = pos.get(n.id) ?? n.position
    if (!n.data.isSubgraph) return { ...n, position: p }
    const s = groupSize.get(n.id) ?? nodeSize(n)
    return {
      ...n,
      position: p,
      // 分组的尺寸既有数据也要有 style：画布用的是 style，只改 data 会让盒子尺寸对不上
      data: { ...n.data, width: s.w, height: s.h },
      style: { ...(n.style ?? {}), width: s.w, height: s.h },
    }
  })

  return orderTopDown(next)
}

const SORT_EPS = 2

/**
 * 画布数组顺序同时决定两件事：图层列表的先后、以及谁盖住谁。
 * 这里的约定：
 *   - 分组排在前面（先渲染 = 垫在成员下面），外层分组在里层分组之前；
 *   - 其余节点从上到下、再从左到右，和视图的阅读顺序一致。
 */
export function orderTopDown(nodes: FlowNode[]): FlowNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const depthOf = (n: FlowNode): number => {
    let depth = 0
    let cur: FlowNode | undefined = n
    const seen = new Set<string>()
    while (cur?.data.groupId && !seen.has(cur.id)) {
      seen.add(cur.id)
      const parent = byId.get(cur.data.groupId)
      if (!parent) break
      depth++
      cur = parent
    }
    return depth
  }
  const byPosition = (a: FlowNode, b: FlowNode) => {
    if (Math.abs(a.position.y - b.position.y) > SORT_EPS) return a.position.y - b.position.y
    return a.position.x - b.position.x
  }
  const groups = nodes
    .filter((n) => n.data.isSubgraph)
    .sort((a, b) => depthOf(a) - depthOf(b) || byPosition(a, b))
  const plain = nodes.filter((n) => !n.data.isSubgraph).sort(byPosition)
  return [...groups, ...plain]
}

/**
 * 拖拽结束后：根据节点中心点是否落在分组框内，自动维护 data.groupId，
 * 并让分组框贴合其成员（含子分组）。
 */
export function syncGroups(nodes: FlowNode[]): FlowNode[] {
  const groups = nodes.filter((n) => n.data.isSubgraph)
  if (!groups.length) return nodes
  const sorted = [...groups].sort((a, b) => a.data.width * a.data.height - b.data.width * b.data.height)

  let next = nodes.map((n) => {
    if (n.data.isSubgraph) return n
    const cx = n.position.x + n.data.width / 2
    const cy = n.position.y + n.data.height / 2
    const hit = sorted.find(
      (g) =>
        cx >= g.position.x &&
        cx <= g.position.x + g.data.width &&
        cy >= g.position.y &&
        cy <= g.position.y + g.data.height,
    )
    const gid = hit ? hit.id : null
    return (n.data.groupId ?? null) === gid ? n : { ...n, data: { ...n.data, groupId: gid } }
  })

  for (const g of groups) {
    const members = next.filter((n) => n.id !== g.id && n.data.groupId === g.id)
    if (!members.length) continue
    const idx = next.findIndex((n) => n.id === g.id)
    if (idx < 0) continue
    // 只扩大、不缩小：成员被拖出分组框时才撑大，避免拖动结束后框体跳动
    const minX = Math.min(g.position.x, Math.min(...members.map((m) => m.position.x)) - GROUP_PAD_X)
    const minY = Math.min(g.position.y, Math.min(...members.map((m) => m.position.y)) - GROUP_PAD_TOP)
    const maxX = Math.max(g.position.x + g.data.width, Math.max(...members.map((m) => m.position.x + m.data.width)) + GROUP_PAD_X)
    const maxY = Math.max(g.position.y + g.data.height, Math.max(...members.map((m) => m.position.y + m.data.height)) + GROUP_PAD_BOTTOM)
    const width = Math.max(200, Math.round(maxX - minX))
    const height = Math.max(130, Math.round(maxY - minY))
    if (minX === g.position.x && minY === g.position.y && width === g.data.width && height === g.data.height) continue
    next[idx] = {
      ...g,
      position: { x: minX, y: minY },
      data: { ...g.data, width, height },
      style: { ...(g.style ?? {}), width, height },
    }
  }

  return next
}
