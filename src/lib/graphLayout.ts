import { bfsHops, type GraphModel } from './graphModel.ts'

/**
 * 关系图谱的布局：纯函数，给定模型返回每个节点的坐标。
 * 不碰文档、不碰 React Flow —— 坐标只属于视图。
 *
 * 算法：BFS 跳数环做初值 → 力导向松弛（斥力 + 连边弹簧 + 碰撞 + 环约束 + 弱重力），
 * 根（度数最高的表）钉在原点。固定随机种子，同一份模型每次排出完全相同的图。
 *
 * 注意：布局**不随焦点变化**。聚焦只压暗，不动坐标——否则单击之后节点会从
 * 光标下面挪走，"看一张表"就变成了"猜它刚才在哪"。
 */

export interface Point {
  x: number
  y: number
}

export interface LayoutOptions {
  /** 相邻节点的目标间距（也是环间距基数） */
  spacing?: number
  /** 节点占位半径（碰撞用） */
  radius?: number
  /** 逐个节点的占位半径：展开成表卡片的点要占更大的位置，否则会压住邻居 */
  radiusOf?: (id: string) => number
  iterations?: number
  seed?: number
}

/** 点的占位半径 */
export const DOT_RADIUS = 64
/** 展开成表卡片时的占位半径（卡片约 230×120，取半对角线） */
export const CARD_RADIUS = 130
/** 固定种子：同一份图每次摆出来一样 */
export const DEFAULT_SEED = 20261113

const DEFAULTS: Required<Omit<LayoutOptions, 'radiusOf'>> = {
  spacing: 160,
  radius: DOT_RADIUS,
  iterations: 320,
  seed: DEFAULT_SEED,
}

/** 没有焦点时选一个根：度数最高，同分取模型里靠前的 */
function pickRoot(model: GraphModel): string | null {
  let bestId: string | null = null
  let bestDegree = -1
  for (const n of model.nodes) {
    const degree = model.neighbors.get(n.id)?.length ?? 0
    if (degree > bestDegree) {
      bestDegree = degree
      bestId = n.id
    }
  }
  return bestId
}

/** 线性同余：只要种子固定，抖动就是确定的 */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x100000000
  }
}

export function layoutGraph(model: GraphModel, opts: LayoutOptions = {}): Map<string, Point> {
  const { spacing, radius, iterations, seed } = { ...DEFAULTS, ...opts }
  const radiusAt = (id: string) => (opts.radiusOf ? opts.radiusOf(id) : radius)
  const out = new Map<string, Point>()
  const count = model.nodes.length
  if (!count) return out

  const root = pickRoot(model)
  if (!root) return out

  const hops = bfsHops(model, root)
  let maxHop = 0
  for (const h of hops.values()) maxHop = Math.max(maxHop, h)

  /** 环序：可达的按跳数，不可达的（孤立分量）一起放到最外圈 */
  const ring = new Map<string, number>()
  for (const n of model.nodes) ring.set(n.id, hops.get(n.id) ?? maxHop + 1)

  // 同一环上均分角度：先按模型顺序分组，保证角度分配也是确定的
  const byRing = new Map<number, string[]>()
  for (const n of model.nodes) {
    const r = ring.get(n.id)!
    if (!byRing.has(r)) byRing.set(r, [])
    byRing.get(r)!.push(n.id)
  }

  const rand = seededRandom(seed)
  const xs = new Float64Array(count)
  const ys = new Float64Array(count)

  /** 每一圈的半径：跳数越远越大，节点越多越大 */
  const radii = model.nodes.map((n) => radiusAt(n.id))

  /**
   * 环半径是累加的：外环必须比内环"再多出两个半径"，否则展开的大卡片会压住内环的邻居。
   * 同时保证环之间至少比 spacing 更开——跳数要看得出来。
   */
  const rings = [...byRing.keys()].sort((a, b) => a - b)
  const widestOfRing = new Map<number, number>()
  for (const r of rings) {
    widestOfRing.set(r, Math.max(...byRing.get(r)!.map((id) => radiusAt(id))))
  }
  const ringRadiusOf = new Map<number, number>()
  let acc = 0
  let prevWidest = 0
  for (const r of rings) {
    const widest = widestOfRing.get(r)!
    if (r === 0) {
      acc = 0
    } else {
      const idCount = byRing.get(r)!.length
      acc = Math.max(
        acc + prevWidest + widest + spacing * 0.55,
        (idCount * 2 * widest) / (2 * Math.PI) + widest + spacing * 0.4,
      )
    }
    ringRadiusOf.set(r, acc)
    prevWidest = widest
  }

  const index = new Map<string, number>()
  model.nodes.forEach((n, i) => {
    index.set(n.id, i)
    const r = ring.get(n.id)!
    if (r === 0) {
      xs[i] = 0
      ys[i] = 0
      return
    }
    const ringNodes = byRing.get(r)!
    const slot = ringNodes.indexOf(n.id)
    const angle = (2 * Math.PI * slot) / ringNodes.length + (rand() - 0.5) * 0.25
    const ringRadius = ringRadiusOf.get(r)!
    xs[i] = ringRadius * Math.cos(angle)
    ys[i] = ringRadius * Math.sin(angle)
  })

  const k = spacing
  const rootIndex = index.get(root)!
  const pinned = new Set<number>([rootIndex])
  const idxEdges = model.edges.map((e) => [index.get(e.source)!, index.get(e.target)!] as const)

  for (let iter = 0; iter < iterations; iter++) {
    const alpha = 1 - iter / iterations
    const fx = new Float64Array(count)
    const fy = new Float64Array(count)

    // 斥力（O(n²)：120 节点每轮 7,200 对，可忽略）
    for (let i = 0; i < count; i++) {
      for (let j = i + 1; j < count; j++) {
        let dx = xs[i] - xs[j]
        let dy = ys[i] - ys[j]
        let d = Math.hypot(dx, dy)
        if (d < 0.01) {
          // 完全重合时用确定性的方向岔开
          dx = i < j ? 0.01 : -0.01
          dy = 0.01
          d = Math.hypot(dx, dy)
        }
        const force = ((k * k) / d) * 0.35
        const ux = dx / d
        const uy = dy / d
        fx[i] += ux * force
        fy[i] += uy * force
        fx[j] -= ux * force
        fy[j] -= uy * force

        // 碰撞：比"两个半径之和"更近就硬推开（展开的卡片半径更大）
        const minD = radii[i] + radii[j]
        if (d < minD) {
          const push = ((minD - d) / minD) * k * 1.5
          fx[i] += ux * push
          fy[i] += uy * push
          fx[j] -= ux * push
          fy[j] -= uy * push
        }
      }
    }

    // 连边弹簧：目标长度按"跨几跳"定，跨的环越多拉得越长
    for (const [i, j] of idxEdges) {
      const hopGap = Math.abs(ring.get(model.nodes[i].id)! - ring.get(model.nodes[j].id)!)
      // 弹簧目标也要吃掉卡片尺寸：展开成卡片的点不能把邻居拉进自己身子里
      const target = Math.max(
        k * Math.max(1, Math.min(3, hopGap)) * 0.95,
        radii[i] + radii[j] + k * 0.2,
      )
      const dx = xs[j] - xs[i]
      const dy = ys[j] - ys[i]
      const d = Math.max(0.01, Math.hypot(dx, dy))
      // 线性弹簧：比 Fruchterman-Reingold 的 d²/k 温和，不会把展开的卡片硬拽到邻居身上
      const force = (d - target) * 0.5
      const ux = dx / d
      const uy = dy / d
      fx[i] += ux * force
      fy[i] += uy * force
      fx[j] -= ux * force
      fy[j] -= uy * force
    }

    // 弱重力：把图收拢在原点附近，孤立分量不至于飘走。
    // 注意系数不能乘 k——乘了之后重力会随间距/间距基数的平方增长，把半个图钉死在半径上。
    for (let i = 0; i < count; i++) {
      fx[i] -= xs[i] * 0.05
      fy[i] -= ys[i] * 0.05
    }

    // 环约束：把节点拉回它那一跳的半径上。
    // 没有这条，弹簧会把 2 跳的节点拽回 1 跳附近，"越远越远"就没了。
    for (let i = 0; i < count; i++) {
      const targetR = ringRadiusOf.get(ring.get(model.nodes[i].id)!) ?? 0
      if (!targetR) continue
      const d = Math.hypot(xs[i], ys[i])
      if (d < 0.01) continue
      const force = (targetR - d) * 1.2
      fx[i] += (xs[i] / d) * force
      fy[i] += (ys[i] / d) * force
    }

    const maxStep = k * 0.6
    for (let i = 0; i < count; i++) {
      if (pinned.has(i)) continue
      const step = Math.hypot(fx[i], fy[i])
      const scale = step > maxStep ? maxStep / step : 1
      xs[i] += fx[i] * scale * 0.08 * alpha
      ys[i] += fy[i] * scale * 0.08 * alpha
    }
  }

  // 焦点严格回到原点（力导向里它被钉住，这里消掉浮点漂移）
  xs[rootIndex] = 0
  ys[rootIndex] = 0

  model.nodes.forEach((n, i) => {
    out.set(n.id, { x: round(xs[i]), y: round(ys[i]) })
  })
  return out
}

function round(v: number): number {
  return Math.round(v * 100) / 100
}
