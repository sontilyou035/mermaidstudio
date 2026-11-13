import type { EdgeData } from '../types'

/**
 * 连线标签规范：`类型` 或 `类型: 说明`。
 * 类型只能是下面十种之一，方便 AI / 人按固定词汇读图。
 */
export const EDGE_TYPES = ['操作', '下一步', '同步', 'MQ', '定时', '写', '读', '配置', '关联', '调用外部', '外部调用'] as const

export type EdgeLabelType = (typeof EDGE_TYPES)[number]

/** 对外只暴露这十种（'外部调用' 是历史别名，导入时归一化到 '调用外部'） */
export const CANONICAL_EDGE_TYPES: EdgeLabelType[] = [
  '操作',
  '下一步',
  '同步',
  'MQ',
  '定时',
  '写',
  '读',
  '配置',
  '关联',
  '调用外部',
]

export interface EdgeTypeInfo {
  name: string
  meaning: string
  typical: string
}

export const EDGE_TYPE_INFO: Record<string, EdgeTypeInfo> = {
  操作: { name: '操作', meaning: '角色触发', typical: 'r_ → a_ / p_' },
  下一步: { name: '下一步', meaning: '流程先后，不涉及调用方式', typical: '任意' },
  同步: { name: '同步', meaning: '同步调用（HTTP/RPC/本地方法）', typical: 'p_ → p_' },
  MQ: { name: 'MQ', meaning: '异步消息', typical: 'p_ → m_ → p_' },
  定时: { name: '定时', meaning: '由定时任务触发', typical: 'j_ → p_' },
  写: { name: '写', meaning: '写表', typical: 'p_/a_ → t_' },
  读: { name: '读', meaning: '读表', typical: 'p_ → t_' },
  配置: { name: '配置', meaning: '配置数据影响行为', typical: 'r_/p_ → p_' },
  关联: { name: '关联', meaning: '表之间的外键或业务键', typical: 't_ → t_（说明里写字段）' },
  调用外部: { name: '调用外部', meaning: '调用外部系统', typical: 'p_ → x_' },
}

/** 历史别名 / 常见写法归一化 */
const TYPE_ALIAS: Record<string, EdgeLabelType> = {
  外部调用: '调用外部',
  调用: '调用外部',
  外部: '调用外部',
  sync: '同步',
  async: 'MQ',
  mq: 'MQ',
  read: '读',
  write: '写',
  next: '下一步',
  action: '操作',
  cron: '定时',
  config: '配置',
  relation: '关联',
}

export function normalizeEdgeType(raw: string | undefined | null): EdgeLabelType | '' {
  const t = String(raw ?? '').trim()
  if (!t) return ''
  if ((CANONICAL_EDGE_TYPES as string[]).includes(t)) return t as EdgeLabelType
  return TYPE_ALIAS[t] ?? TYPE_ALIAS[t.toLowerCase()] ?? ''
}

/** 组装 `类型` / `类型: 说明` */
export function composeEdgeLabel(type: string | undefined, note: string | undefined, fallback = ''): string {
  const t = String(type ?? '').trim()
  const n = String(note ?? '').trim()
  if (!t) return fallback.trim()
  return n ? `${t}: ${n}` : t
}

/** 解析已有标签：命中的类型拆出来，其余算说明 */
export function parseEdgeLabel(label: string | undefined): { type: EdgeLabelType | ''; note: string } {
  const text = String(label ?? '').trim()
  if (!text) return { type: '', note: '' }
  const [head, ...rest] = text.split(/[:：]/)
  const type = normalizeEdgeType(head)
  if (!type) return { type: '', note: text }
  return { type, note: rest.join(':').trim() }
}

/** 标签是否符合规范（类型必须是十种之一） */
export function isEdgeLabelConforming(label: string | undefined): boolean {
  const { type } = parseEdgeLabel(label)
  return type !== ''
}

/**
 * 按「起点 / 终点 的 ID 前缀」推荐类型。
 * 规则取自约定表；有歧义的地方（p_ → t_ 既可能是读也可能是写）默认给「写」。
 */
export function suggestEdgeType(sourcePrefix: string, targetPrefix: string): EdgeLabelType {
  const s = sourcePrefix.replace(/_+$/, '')
  const t = targetPrefix.replace(/_+$/, '')

  if (t === 'm' || s === 'm') return 'MQ'
  if (t === 'x') return '调用外部'
  if (s === 'j') return '定时'
  if (t === 't') {
    if (s === 't') return '关联'
    if (s === 'a') return '写'
    if (s === 'p' || s === 'svc' || s === 'api') return '写'
    return '下一步'
  }
  if (s === 't') return '下一步'
  if (s === 'r') return '操作'
  if (s === 'a') return '下一步'
  if ((s === 'p' || s === 'svc' || s === 'api') && (t === 'p' || t === 'svc' || t === 'x')) return '同步'
  return '下一步'
}

/** 给一条边推荐标签 */
export function suggestEdgeLabel(sourcePrefix: string, targetPrefix: string, note?: string): { type: EdgeLabelType; label: string } {
  const type = suggestEdgeType(sourcePrefix, targetPrefix)
  return { type, label: composeEdgeLabel(type, note) }
}

export interface EdgeLabelIssue {
  edgeId: string
  label: string
  suggestion: EdgeLabelType
}

/** 检查整张图里不合规的连线标签 */
export function findEdgeLabelIssues(
  edges: Array<{ id: string; source: string; target: string; data?: EdgeData }>,
  prefixOf: (nodeId: string) => string,
): EdgeLabelIssue[] {
  const issues: EdgeLabelIssue[] = []
  for (const e of edges) {
    const label = String(e.data?.label ?? '')
    if (isEdgeLabelConforming(label)) continue
    issues.push({
      edgeId: e.id,
      label: label.trim(),
      suggestion: suggestEdgeType(prefixOf(e.source), prefixOf(e.target)),
    })
  }
  return issues
}
