import {
  DEFAULT_EDGE_DATA,
  SHAPE_WRAP,
  type BlockDef,
  type Direction,
  type DiagramDoc,
  type EdgeData,
  type FlowEdge,
  type FlowNode,
  type LineStyle,
  type MarkerKind,
  type ShapeKind,
} from '../types'
import { composeLabel, escapeMermaidLabel, toMermaidId } from '../blocks/registry'
import { CLASS_ORDER, semanticClass } from './classes'
import { composeEdgeLabel, parseEdgeLabel } from './edgeLabels'

/* ================================================================== *
 * 序列化：画布 -> Mermaid
 * ================================================================== */

export interface SerializeOptions {
  /** 是否输出颜色相关的 classDef / style / linkStyle */
  includeStyles?: boolean
}

const NEUTRAL_FILL = new Set(['transparent', 'none', ''])

function cssColor(v: string | undefined): string {
  if (!v) return 'none'
  return NEUTRAL_FILL.has(v.toLowerCase()) ? 'none' : v
}

function nodeOverrides(node: FlowNode, block: BlockDef): boolean {
  const d = node.data
  return (
    cssColor(d.fill) !== cssColor(block.fill) ||
    cssColor(d.stroke) !== cssColor(block.stroke) ||
    (d.textColor || '') !== (block.textColor || '')
  )
}

/**
 * 分组成员关系。优先使用显式的 data.groupId（拖拽时自动维护），
 * 对于没有 groupId 的历史数据退回到几何包含判断。
 */
export function groupMembers(nodes: FlowNode[]): Map<string, string[]> {
  const groups = nodes.filter((n) => n.data.isSubgraph)
  const plain = nodes.filter((n) => !n.data.isSubgraph)
  const groupIds = new Set(groups.map((g) => g.id))
  const result = new Map<string, string[]>()
  for (const g of groups) result.set(g.id, [])

  const unassigned: FlowNode[] = []
  for (const n of plain) {
    const gid = n.data.groupId
    if (gid && groupIds.has(gid)) {
      result.get(gid)!.push(n.id)
    } else {
      unassigned.push(n)
    }
  }

  const sorted = [...groups].sort(
    (a, b) => a.data.width * a.data.height - b.data.width * b.data.height,
  )
  for (const n of unassigned) {
    const cx = n.position.x + n.data.width / 2
    const cy = n.position.y + n.data.height / 2
    for (const g of sorted) {
      const inside =
        cx >= g.position.x &&
        cx <= g.position.x + g.data.width &&
        cy >= g.position.y &&
        cy <= g.position.y + g.data.height
      if (inside) {
        result.get(g.id)!.push(n.id)
        break
      }
    }
  }
  return result
}

export function nodeToMermaidLine(
  node: FlowNode,
  block: BlockDef,
  mid: string,
  opts: { includeStyles: boolean; className?: string; override?: boolean },
): string {
  const label = escapeMermaidLabel(composeLabel(node.data, block))
  const wrap = block.mermaidWrap ?? SHAPE_WRAP[node.data.shape]
  const shapeText = `${mid}${wrap.open}"${label}"${wrap.close}`

  let line: string
  if (block.mermaidTemplate && block.mermaidTemplate.trim()) {
    line = block.mermaidTemplate.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, key: string) => {
      switch (key) {
        case 'id':
          return mid
        case 'label':
          return label
        case 'rawlabel':
          return composeLabel(node.data, block)
        case 'open':
          return wrap.open
        case 'close':
          return wrap.close
        case 'shape':
          return shapeText
        default:
          return node.data.values?.[key] ?? ''
      }
    })
    if (!line.includes(mid)) line = `${mid}${line}`
  } else {
    line = shapeText
  }

  if (opts.includeStyles && opts.className && !opts.override) line += `:::${opts.className}`
  return line
}

export function edgeToken(data: EdgeData): string {
  const start = data.startMarker
  const end = data.endMarker
  const startCh = start === 'arrow' ? '<' : start === 'circle' ? 'o' : start === 'cross' ? 'x' : ''
  if (data.lineStyle === 'dashed') {
    const s = start === 'arrow' ? '<' : ''
    return `${s}-.-${end === 'arrow' ? '>' : ''}`
  }
  if (data.lineStyle === 'thick') {
    const s = start === 'arrow' ? '<' : ''
    return `${s}==${end === 'arrow' ? '>' : '='}`
  }
  const endCh = end === 'arrow' ? '>' : end === 'circle' ? 'o' : end === 'cross' ? 'x' : '-'
  return `${startCh}--${endCh}`
}

export function toMermaid(doc: DiagramDoc, blocks: BlockDef[], opts: SerializeOptions = {}): string {
  const includeStyles = opts.includeStyles !== false
  const blockMap = new Map(blocks.map((b) => [b.id, b]))
  const fallback = blocks[0]

  // 1. 生成唯一 Mermaid id
  const idMap = new Map<string, string>()
  const used = new Set<string>()
  for (const n of doc.nodes) {
    let mid = toMermaidId(n.id)
    let k = 2
    while (used.has(mid)) mid = `${toMermaidId(n.id)}_${k++}`
    used.add(mid)
    idMap.set(n.id, mid)
  }

  const members = groupMembers(doc.nodes)
  const childOf = new Map<string, string>()
  for (const [gid, ids] of members) for (const id of ids) childOf.set(id, gid)

  const lines: string[] = [`flowchart ${doc.direction}`]
  const classDefs = new Map<string, string>()
  const classNameByStyle = new Map<string, string>()
  const styleLines: string[] = []
  const extraLines = new Set<string>()

  const emitNode = (node: FlowNode, indent: string) => {
    const block = blockMap.get(node.data.blockId) ?? fallback
    const mid = idMap.get(node.id)!
    let className: string | undefined
    if (includeStyles) {
      // 1) 固定的语义类（role / action / process / table / job / mq / external）
      const semantic = semanticClass(block.className)
      if (semantic) {
        className = semantic.name
        classDefs.set(className, semantic.style)
      } else {
        // 2) 块的 classDef，或按节点颜色生成；样式相同的块复用同一个 classDef
        const style = block.classDef?.trim()
          ? block.classDef.trim()
          : `fill:${cssColor(node.data.fill)},stroke:${cssColor(node.data.stroke)},color:${node.data.textColor}`
        className = classNameByStyle.get(style)
        if (!className) {
          className = `blk_${toMermaidId(block.id)}`
          classNameByStyle.set(style, className)
          classDefs.set(className, style)
        }
      }
      if (block.extraLines?.length) block.extraLines.forEach((l) => l.trim() && extraLines.add(l.trim()))
    }
    const override = includeStyles && nodeOverrides(node, block)
    lines.push(indent + nodeToMermaidLine(node, block, mid, { includeStyles, className, override }))
    if (override) {
      styleLines.push(
        `style ${mid} fill:${cssColor(node.data.fill)},stroke:${cssColor(node.data.stroke)},color:${node.data.textColor}`,
      )
    }
  }

  // 2. 先输出分组（subgraph），组内节点缩进；嵌套分组按父子关系递归缩进
  const emitted = new Set<string>()
  const subGroups = doc.nodes.filter((n) => n.data.isSubgraph)
  const subGroupIds = new Set(subGroups.map((g) => g.id))
  const childrenOfGroup = new Map<string, FlowNode[]>()
  const topGroups: FlowNode[] = []
  for (const g of subGroups) childrenOfGroup.set(g.id, [])
  for (const g of subGroups) {
    const parent = g.data.groupId && subGroupIds.has(g.data.groupId) ? g.data.groupId : null
    if (parent) childrenOfGroup.get(parent)!.push(g)
    else topGroups.push(g)
  }

  const emitGroup = (g: FlowNode, indent: string) => {
    const block = blockMap.get(g.data.blockId) ?? fallback
    const gid = (g.data.values?.id || '').trim() || toMermaidId(g.id)
    const label = escapeMermaidLabel(composeLabel(g.data, block))
    lines.push(`${indent}subgraph ${toMermaidId(gid)}["${label}"]`)
    for (const childId of members.get(g.id) ?? []) {
      const child = doc.nodes.find((n) => n.id === childId)
      if (child) {
        emitNode(child, indent + '  ')
        emitted.add(childId)
      }
    }
    for (const sub of childrenOfGroup.get(g.id) ?? []) emitGroup(sub, indent + '  ')
    lines.push(`${indent}end`)
  }

  for (const g of topGroups) emitGroup(g, '')

  // 3. 其余节点
  for (const node of doc.nodes) {
    if (node.data.isSubgraph || emitted.has(node.id)) continue
    emitNode(node, '  ')
  }

  // 4. 边
  const linkStyles: string[] = []
  doc.edges.forEach((edge, index) => {
    const src = idMap.get(edge.source)
    const dst = idMap.get(edge.target)
    if (!src || !dst) return
    const data = { ...DEFAULT_EDGE_DATA, ...edge.data } as EdgeData
    const token = edgeToken(data)
    const label = composeEdgeLabel(data.type, data.note, data.label).trim()
    const mermaidLabel = label ? escapeMermaidLabel(label) : ''
    lines.push(
      `  ${src} ${token}${mermaidLabel ? `|${mermaidLabel}|` : ''} ${dst}`,
    )
    if (includeStyles) {
      const parts: string[] = []
      if (data.stroke && data.stroke.toLowerCase() !== DEFAULT_EDGE_DATA.stroke.toLowerCase()) {
        parts.push(`stroke:${data.stroke}`)
      }
      if (data.strokeWidth && data.strokeWidth !== DEFAULT_EDGE_DATA.strokeWidth) {
        parts.push(`stroke-width:${data.strokeWidth}px`)
      }
      if (parts.length) linkStyles.push(`linkStyle ${index} ${parts.join(',')}`)
    }
  })

  if (classDefs.size) {
    const ordered = [...classDefs.entries()].sort((a, b) => {
      const ia = CLASS_ORDER.indexOf(a[0])
      const ib = CLASS_ORDER.indexOf(b[0])
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib)
    })
    for (const [name, style] of ordered) lines.push(`classDef ${name} ${style}`)
  }
  lines.push(...styleLines)
  lines.push(...linkStyles)
  if (extraLines.size) lines.push(...extraLines)

  return lines.join('\n')
}

/* ================================================================== *
 * 解析：Mermaid -> 中间结构（由 store 转成画布节点）
 * ================================================================== */

export interface ParsedNode {
  id: string
  label: string
  shape: ShapeKind
  subgraphId?: string
  className?: string
  style?: Record<string, string>
}

export interface ParsedEdge {
  source: string
  target: string
  label?: string
  type?: string
  note?: string
  lineStyle: LineStyle
  startMarker: MarkerKind
  endMarker: MarkerKind
  index: number
  style?: Record<string, string>
}

export interface ParsedDiagram {
  direction: Direction
  nodes: ParsedNode[]
  edges: ParsedEdge[]
  classDefs: Record<string, string>
  warnings: string[]
}

/** 把导出时做的转义还原回来 */
export function unescapeMermaidLabel(text: string): string {
  return String(text)
    .replace(/&quot;/g, '"')
    .replace(/#quot;/g, '"')
    .replace(/<br\s*\/?>/gi, '\n')
}

/** [开头, 结尾, 形状]，顺序即匹配优先级（更具体的在前） */
const SHAPE_SYNTAX: Array<[string, string, ShapeKind]> = [
  ['(((', ')))', 'doublecircle'],
  ['[[', ']]', 'subroutine'],
  ['([', '])', 'stadium'],
  ['[(', ')]', 'cylinder'],
  ['((', '))', 'circle'],
  ['{{', '}}', 'hexagon'],
  ['[/', '/]', 'parallelogram'],
  ['[/', '\\]', 'trapezoid'],
  ['[\\', '\\]', 'parallelogram-alt'],
  ['[\\', '/]', 'trapezoid-alt'],
  ['>', ']', 'asymmetric'],
  ['[', ']', 'rect'],
  ['(', ')', 'round'],
  ['{', '}', 'diamond'],
]

interface NodeToken {
  id: string
  label: string | null
  shape: ShapeKind
  className?: string
  rest: string
}

/**
 * 在「括号之后」的文本里找出真正的收尾括号。
 *
 * 不能直接 lastIndexOf：`A[开始] --> B[处理]` 会把整行最后那个 `]` 当作 A 的收尾，
 * 于是 B 被吞进 A 的标签里，整条边消失。这里从第一个候选开始试，
 * 只要收尾括号后面跟着的是边、class、分组连接符或行尾，就认定它是真正的收尾。
 * 都试不出来（标签里本身带括号）再退回旧行为，保证不回归。
 */
function findCloseIndex(afterOpen: string, close: string): number {
  const last = afterOpen.lastIndexOf(close)
  if (last < 0) return -1
  let from = 0
  for (;;) {
    const idx = afterOpen.indexOf(close, from)
    if (idx < 0) return last
    const tail = afterOpen.slice(idx + close.length).trimStart()
    if (tail === '' || tail.startsWith(':::') || tail.startsWith('&') || EDGE_HEAD_RE.test(tail)) return idx
    from = idx + 1
  }
}

function takeNodeToken(input: string): NodeToken | null {
  const s = input.trimStart()
  const idMatch = s.match(/^([A-Za-z0-9_][A-Za-z0-9_.\-]*)/)
  if (!idMatch) return null
  const id = idMatch[1]
  let rest = s.slice(id.length)
  let label: string | null = null
  let shape: ShapeKind = 'rect'

  const trimmed = rest.trimStart()
  for (const [open, close, kind] of SHAPE_SYNTAX) {
    if (!trimmed.startsWith(open)) continue
    const afterOpen = trimmed.slice(open.length)
    const closeIdx = findCloseIndex(afterOpen, close)
    if (closeIdx < 0) continue
    const inner = afterOpen.slice(0, closeIdx).trim()
    rest = afterOpen.slice(closeIdx + close.length)
    shape = kind
    label = unescapeMermaidLabel(inner.replace(/^"(.*)"$/s, '$1').replace(/^'(.*)'$/s, '$1'))
    break
  }

  // 可选的 :::class
  const classMatch = rest.match(/^\s*:::([\w-]+)/)
  let className: string | undefined
  if (classMatch) {
    className = classMatch[1]
    rest = rest.slice(classMatch[0].length)
  }
  return { id, label, shape, className, rest }
}

const EDGE_HEAD_RE =
  /^\s*(<==>|<-->|<--|-->|---|-\.-\.->|-\.->|-\.-|==>|===|--o|--x|o--o|x--x|o--|x--)\s*(?:\|([^|]*)\|\s*)?/

/** 边标签清洗：`|"文本"|` 的外层引号去掉，`<br/>` 折成空格（画布上的标签是单行） */
export function cleanEdgeLabel(label?: string): string {
  let text = String(label ?? '').trim()
  if (text.length >= 2) {
    const first = text[0]
    const last = text[text.length - 1]
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) text = text.slice(1, -1).trim()
  }
  return text.replace(/<br\s*\/?>/gi, ' ').replace(/\s+/g, ' ').trim()
}

export function edgeTokenToData(
  token: string,
  label?: string,
): Pick<ParsedEdge, 'lineStyle' | 'startMarker' | 'endMarker' | 'label' | 'type' | 'note'> {
  const lineStyle: LineStyle = token.includes('=') ? 'thick' : token.includes('.') ? 'dashed' : 'solid'
  const startMarker: MarkerKind = token.startsWith('<') ? 'arrow' : token.startsWith('o') ? 'circle' : token.startsWith('x') ? 'cross' : 'none'
  const last = token[token.length - 1]
  const endMarker: MarkerKind = last === '>' ? 'arrow' : last === 'o' ? 'circle' : last === 'x' ? 'cross' : 'none'
  const raw = cleanEdgeLabel(label)
  const { type, note } = parseEdgeLabel(raw)
  return { lineStyle, startMarker, endMarker, label: raw || undefined, type, note }
}

function parseProps(raw: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const part of raw.split(',')) {
    const [k, ...v] = part.split(':')
    if (!k || !v.length) continue
    out[k.trim()] = v.join(':').trim()
  }
  return out
}

export function parseMermaid(code: string): ParsedDiagram {
  const warnings: string[] = []
  const nodes = new Map<string, ParsedNode>()
  const edges: ParsedEdge[] = []
  const classDefs: Record<string, string> = {}
  const classOf: Record<string, string> = {}
  const nodeStyles: Record<string, Record<string, string>> = {}
  const edgeStyles: Record<number, Record<string, string>> = {}
  let direction: Direction = 'TB'
  let headerSeen = false
  const stack: string[] = []
  let subCounter = 0

  const upsert = (t: NodeToken): ParsedNode => {
    const existing = nodes.get(t.id)
    const currentGroup = stack[stack.length - 1]
    if (existing) {
      if (t.label != null) existing.label = t.label
      if (t.className) existing.className = t.className
      if (t.shape !== 'rect') existing.shape = t.shape
      // 节点可能先出现在边上、后面才被写进 subgraph 里
      if (currentGroup && !existing.subgraphId) existing.subgraphId = currentGroup
      return existing
    }
    const node: ParsedNode = {
      id: t.id,
      label: t.label ?? t.id,
      shape: t.shape,
      className: t.className,
      subgraphId: currentGroup,
    }
    nodes.set(t.id, node)
    return node
  }

  const recordEdge = (from: string, to: string, token: string, label?: string) => {
    const data = edgeTokenToData(token, label)
    edges.push({ source: from, target: to, index: edges.length, ...data })
  }

  /** 解析一串用 `&` 并列的节点：`A & B` → [A, B]（Mermaid 的 `A & B --> C` 写法） */
  const parseNodeGroup = (input: string): { ids: string[]; rest: string } | null => {
    let rest = input.trim()
    const ids: string[] = []
    let guard = 0
    while (guard++ < 50) {
      const t = takeNodeToken(rest)
      if (!t) break
      upsert(t)
      ids.push(t.id)
      rest = t.rest.trim()
      const amp = rest.match(/^&\s*/)
      if (!amp) break
      rest = rest.slice(amp[0].length)
    }
    return ids.length ? { ids, rest } : null
  }

  const parseChain = (line: string) => {
    const head = parseNodeGroup(line.trim())
    if (!head) {
      warnings.push(`无法解析：${line}`)
      return
    }
    let prev = head.ids
    let rest = head.rest
    let guard = 0
    while (rest.length > 0 && guard++ < 50) {
      const m = rest.match(EDGE_HEAD_RE)
      if (!m) {
        const n = parseNodeGroup(rest)
        if (n) {
          prev = n.ids
          rest = n.rest
          continue
        }
        warnings.push(`忽略片段：${rest}`)
        break
      }
      const token = m[1]
      const label = m[2]
      rest = rest.slice(m[0].length)
      const next = parseNodeGroup(rest)
      if (!next) {
        warnings.push(`连线缺少目标节点：${line}`)
        break
      }
      // `A & B --> C` 展开成 A→C、B→C；`A --> B & C` 展开成 A→B、A→C
      for (const from of prev) for (const to of next.ids) recordEdge(from, to, token, label)
      prev = next.ids
      rest = next.rest
    }
  }

  const lines = code.split(/\r?\n/)
  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue
    if (line.startsWith('%%')) continue
    if (!headerSeen && /^(flowchart|graph)\b/i.test(line)) {
      headerSeen = true
      const dir = line.match(/\b(TB|TD|BT|LR|RL)\b/i)?.[1]?.toUpperCase()
      if (dir) direction = (dir === 'TD' ? 'TB' : dir) as Direction
      continue
    }
    if (/^subgraph\b/i.test(line)) {
      const body = line.replace(/^subgraph\s+/i, '').trim()
      const token = body.match(/^([A-Za-z0-9_][A-Za-z0-9_.\-]*)/) ? takeNodeToken(body) : null
      let sgId: string
      let sgLabel: string
      if (token && token.rest.trim() === '') {
        // subgraph id  /  subgraph id["label"]
        sgId = token.id
        sgLabel = token.label ?? token.id
      } else {
        // subgraph "纯标签"
        sgId = `subgraph_${++subCounter}`
        sgLabel = body.replace(/^"(.*)"$/, '$1')
      }
      nodes.set(sgId, { id: sgId, label: sgLabel, shape: 'group', subgraphId: stack[stack.length - 1] })
      stack.push(sgId)
      continue
    }
    if (/^end\b/i.test(line)) {
      stack.pop()
      continue
    }
    if (/^(direction|classDef|class|style|linkStyle|click|accTitle|accDescr|link)\b/i.test(line)) {
      const m = line.match(/^(\w+)\s+([\s\S]*)$/)
      const kw = m?.[1]
      const body = m?.[2] ?? ''
      if (/^classDef$/i.test(kw ?? '')) {
        const cm = body.match(/^([\w-]+)\s+([\s\S]+)$/)
        if (cm) classDefs[cm[1]] = cm[2].trim()
      } else if (/^class$/i.test(kw ?? '')) {
        const cm = body.match(/^([\w\s,-]+?)\s+([\w-]+)$/)
        if (cm) {
          for (const id of cm[1].split(',').map((s) => s.trim()).filter(Boolean)) classOf[id] = cm[2]
        }
      } else if (/^style$/i.test(kw ?? '')) {
        const sm = body.match(/^([\w.-]+)\s+([\s\S]+)$/)
        if (sm) nodeStyles[sm[1]] = parseProps(sm[2])
      } else if (/^linkStyle$/i.test(kw ?? '')) {
        const lm = body.match(/^(\d+)\s+([\s\S]+)$/)
        if (lm) edgeStyles[Number(lm[1])] = parseProps(lm[2])
      }
      continue
    }
    if (/^(flowchart|graph)\b/i.test(line)) continue
    parseChain(line)
  }

  for (const node of nodes.values()) {
    const cls = node.className ?? classOf[node.id]
    if (cls && classDefs[cls]) node.style = parseProps(classDefs[cls])
    if (nodeStyles[node.id]) node.style = { ...(node.style ?? {}), ...nodeStyles[node.id] }
  }
  for (const e of edges) if (edgeStyles[e.index]) e.style = edgeStyles[e.index]

  return { direction, nodes: [...nodes.values()], edges, classDefs, warnings }
}

/** Mermaid 里合法的图类型开头（用来判断一段文本是不是 mermaid） */
const MERMAID_HEAD = /^\s*(flowchart|graph|erDiagram|sequenceDiagram|classDiagram|stateDiagram\w*|gantt|pie|mindmap|timeline|journey|quadrantChart|sankey\w*|xychart\w*|block-beta|block|C4\w+|gitGraph|requirementDiagram|architecture-beta|packet-beta|radar-beta|treemap\w*)/m

/**
 * 从 .md 文件里抽出 Mermaid 代码块；顺便读 frontmatter 的 title。
 * 兼容：围栏写法（```mermaid / ```mmd）、没有围栏的纯 .mmd、带 frontmatter 的 md。
 */
export function extractMermaidFromMarkdown(text: string): { code: string; title?: string } {
  const source = String(text ?? '')
  const fm = source.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/)
  let title: string | undefined
  if (fm) {
    const tm = fm[1].match(/^title:\s*"?(.*?)"?\s*$/m)
    if (tm) title = tm[1].trim().replace(/^"|"$/g, '')
  }
  const fence = source.match(/```(?:mermaid|mmd|mermaid-js)?[ \t]*\r?\n([\s\S]*?)```/i)
  if (fence) return { code: fence[1].trim(), title }

  const body = fm ? source.slice(fm[0].length) : source
  const code = body.trim()
  if (!code) return { code: '', title }
  if (!MERMAID_HEAD.test(code)) {
    throw new Error('这个文件里没找到 Mermaid 代码块（.md 需要 ```mermaid 围栏，或直接导入 .mmd）')
  }
  return { code, title }
}
