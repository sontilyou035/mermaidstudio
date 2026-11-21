import type { DiagramDoc, FlowNode } from '../types'
// 显式带 .ts：本模块要被 node --experimental-strip-types 直接跑（scripts/unit-graph.mjs），
// Node 的 ESM 解析要求扩展名；tsconfig 已开 allowImportingTsExtensions。

/**
 * 关系图谱的派生模型：只依赖文档，不持有任何坐标或状态。
 * 视图层的任何过滤（聚焦、跳数）都在这个模型之上做，不写回文档。
 */

export interface GraphNode {
  id: string
  label: string
  /** 连线条数（平行边各算一条）：视图用它决定圆点面积 */
  degree: number
  /** 所属分组的调色索引；-1 表示不属于任何分组 */
  groupIndex: number
}

export interface GraphEdge {
  id: string
  source: string
  target: string
  /** 虚线 = 待确认项，沿用流程图与存疑清单的既有约定 */
  dashed: boolean
  /** 悬停时显示的完整标签（类型: 说明） */
  label: string
  /** 是否画箭头：方向照作者画的方向走，不推断外键方向 */
  arrow: boolean
}

export interface GraphModel {
  nodes: GraphNode[]
  edges: GraphEdge[]
  /** 无向邻接：跳数按"连线上的一步"算，不按箭头方向 */
  neighbors: Map<string, string[]>
}

/** 分组容器不是实体，不进图；隐藏状态记在 React Flow 节点上（图层开关用的就是它） */
function isEntity(n: FlowNode): boolean {
  return !n.data.isSubgraph && !n.hidden
}

/**
 * 纯文本节点是注释而不是实体：没有连线时不画。
 * 有连线时画，因为它承担了"这两个节点之间的说明"的角色。
 */
function isAnnotation(n: FlowNode): boolean {
  return n.data.shape === 'text'
}

function nodeLabel(n: FlowNode): string {
  const label = typeof n.data.label === 'string' ? n.data.label.trim() : ''
  return label || n.id
}

export function deriveGraphModel(doc: DiagramDoc): GraphModel {
  const entities = doc.nodes.filter(isEntity)
  const entityIds = new Set(entities.map((n) => n.id))

  const edges: GraphEdge[] = []
  const degree = new Map<string, number>()
  for (const e of doc.edges) {
    if (e.hidden) continue
    if (!entityIds.has(e.source) || !entityIds.has(e.target)) continue
    const label = String(e.data?.label ?? e.label ?? '').trim()
    edges.push({
      id: e.id,
      source: e.source,
      target: e.target,
      dashed: e.data?.lineStyle === 'dashed',
      label,
      arrow: (e.data?.endMarker ?? 'arrow') !== 'none',
    })
    degree.set(e.source, (degree.get(e.source) ?? 0) + 1)
    degree.set(e.target, (degree.get(e.target) ?? 0) + 1)
  }

  const groupOrder = new Map<string, number>()
  for (const n of entities) {
    const gid = n.data.groupId
    if (gid && !groupOrder.has(gid)) groupOrder.set(gid, groupOrder.size)
  }

  const nodes: GraphNode[] = entities
    .filter((n) => !isAnnotation(n) || (degree.get(n.id) ?? 0) > 0)
    .map((n) => ({
      id: n.id,
      label: nodeLabel(n),
      degree: degree.get(n.id) ?? 0,
      groupIndex: n.data.groupId ? (groupOrder.get(n.data.groupId) ?? -1) : -1,
    }))

  const nodeIds = new Set(nodes.map((n) => n.id))
  const keptEdges = edges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target))

  const neighbors = new Map<string, string[]>()
  for (const n of nodes) neighbors.set(n.id, [])
  const seen = new Set<string>()
  for (const e of keptEdges) {
    const key = undirectedKey(e.source, e.target)
    if (seen.has(key)) continue
    seen.add(key)
    neighbors.get(e.source)!.push(e.target)
    neighbors.get(e.target)!.push(e.source)
  }

  return { nodes, edges: keptEdges, neighbors }
}

/** 无向边的稳定键：A→B 与 B→A 视为同一条 */
export function undirectedKey(a: string, b: string): string {
  return a <= b ? `${a}\u0000${b}` : `${b}\u0000${a}`
}

/** 结构签名：只反映"谁连着谁"，用来判断要不要重排（拖动画布位置不该触发重算） */
export function graphSignature(model: GraphModel): string {
  const nodes = model.nodes.map((n) => n.id).sort().join(',')
  const edges = model.edges.map((e) => undirectedKey(e.source, e.target)).sort().join(',')
  return `${model.nodes.length}|${model.edges.length}|${nodes}|${edges}`
}

/** 从某个节点出发的最短跳数（1 跳 = 一条连线）；不可达的节点不在返回表里 */
export function bfsHops(model: GraphModel, fromId: string): Map<string, number> {
  const hops = new Map<string, number>()
  if (!model.neighbors.has(fromId)) return hops
  hops.set(fromId, 0)
  const queue = [fromId]
  for (let i = 0; i < queue.length; i++) {
    const cur = queue[i]
    const next = hops.get(cur)! + 1
    for (const n of model.neighbors.get(cur) ?? []) {
      if (hops.has(n)) continue
      hops.set(n, next)
      queue.push(n)
    }
  }
  return hops
}
