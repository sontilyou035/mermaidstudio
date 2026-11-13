import type { DiagramDoc, FlowNode, ScenarioChange, ScenarioEvent, Timeline } from '../types'

/* ---------------- 导入格式（原始 JSON） ---------------- *
 *
 * 支持两种原始形态（可混用）：
 *   1) delta（推荐）：每个事件只列出变化
 *      { name, startMs, durationMs, changes: [{ table, field, value }] }
 *   2) 快照：每个事件给出整表的值，导入时逐字段 diff 成变更
 *      { name, startMs, durationMs, tables: [{ table, values: { field: value } }] }
 *      （也接受 changes 里用 { table, values: {...} } 的简写）
 *
 * 表名 -> 画布数据表节点：先按节点标题（label）匹配；
 * 对不上的表，若某个空闲数据表节点的字段集合覆盖该表在剧本里用到的字段，则兜底绑定（唯一候选才绑定）。
 * 仍匹配不上的表原样保留在剧本里，由审阅面板人工绑定。
 */

export interface ImportReport {
  ok: boolean
  error?: string
  eventCount: number
  changeCount: number
  matchedTables: string[]
  unmatchedTables: string[]
}

type RawChange = { table?: string; field?: string; value?: unknown; values?: Record<string, unknown> }
type RawEvent = {
  name?: string
  startMs?: number
  durationMs?: number
  changes?: RawChange[]
  tables?: Array<{ table?: string; values?: Record<string, unknown> }>
}
type RawFile = { kind?: string; version?: number; totalMs?: number; events?: RawEvent[] }

const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v))

/** 节点字段列表（columns 里的「字段」部分，去重保序） */
export function nodeFields(n: FlowNode): string[] {
  const out: string[] = []
  for (const line of String(n.data.values?.columns ?? '').split('\n')) {
    const name = line.split(':')[0].trim()
    if (name && !out.includes(name)) out.push(name)
  }
  return out
}

/** 把原始 JSON 解析成剧本（含表匹配 + 快照 diff） */
export function parseScenario(
  doc: DiagramDoc,
  tableNodesList: FlowNode[],
  raw: unknown,
): { timeline: Timeline | null; report: ImportReport } {
  const fail = (error: string): { timeline: null; report: ImportReport } => ({
    timeline: null,
    report: { ok: false, error, eventCount: 0, changeCount: 0, matchedTables: [], unmatchedTables: [] },
  })
  if (!raw || typeof raw !== 'object') return fail('不是合法的 JSON 对象')
  const file = raw as RawFile
  if (!Array.isArray(file.events) || file.events.length === 0) return fail('缺少 events 数组')

  const events: ScenarioEvent[] = []
  const lastValues = new Map<string, Map<string, string>>()
  const tableFields = new Map<string, Set<string>>()
  let cursor = 0
  let changeCount = 0

  file.events.forEach((re, idx) => {
    const rawChanges: RawChange[] = []
    if (Array.isArray(re.changes)) rawChanges.push(...re.changes)
    if (Array.isArray(re.tables)) for (const t of re.tables) rawChanges.push({ table: t.table, values: t.values })
    const startMs = Number.isFinite(Number(re.startMs)) ? Math.max(0, Math.round(Number(re.startMs))) : cursor
    const durationMs = Number.isFinite(Number(re.durationMs)) ? Math.max(0, Math.round(Number(re.durationMs))) : 800
    cursor = startMs + durationMs

    const changes: ScenarioChange[] = []
    for (const rc of rawChanges) {
      const table = str(rc.table).trim()
      if (!table) continue
      const fields = tableFields.get(table) ?? new Set<string>()
      if (rc.values && typeof rc.values === 'object') {
        const prev = lastValues.get(table) ?? new Map<string, string>()
        for (const [field, value] of Object.entries(rc.values)) {
          const v = str(value)
          if (prev.get(field) === v) continue
          prev.set(field, v)
          fields.add(field)
          changes.push({ table, field, value: v })
        }
        lastValues.set(table, prev)
      } else if (rc.field) {
        const field = str(rc.field)
        const v = str(rc.value)
        const prev = lastValues.get(table) ?? new Map<string, string>()
        prev.set(field, v)
        lastValues.set(table, prev)
        fields.add(field)
        changes.push({ table, field, value: v })
      }
      tableFields.set(table, fields)
    }
    changeCount += changes.length
    events.push({ id: `ev_${idx}_${Math.random().toString(36).slice(2, 7)}`, name: str(re.name).trim() || `事件 ${idx + 1}`, startMs, durationMs, nodeIds: [], changes })
  })

  // 表匹配
  const tables = [...tableFields.keys()]
  const bindings = new Map<string, string>()
  const used = new Set<string>()
  const lower = (s: string) => s.trim().toLowerCase()
  for (const table of tables) {
    const node = tableNodesList.find((n) => !used.has(n.id) && lower(n.data.label) === lower(table))
    if (node) {
      bindings.set(table, node.id)
      used.add(node.id)
    }
  }
  for (const table of tables) {
    if (bindings.has(table)) continue
    const need = tableFields.get(table) ?? new Set<string>()
    const candidates = tableNodesList.filter((n) => {
      if (used.has(n.id)) return false
      const have = new Set(nodeFields(n).map((f) => f.toLowerCase()))
      return need.size > 0 && [...need].every((f) => have.has(f.toLowerCase()))
    })
    if (candidates.length === 1) {
      bindings.set(table, candidates[0].id)
      used.add(candidates[0].id)
    }
  }
  for (const ev of events) {
    for (const c of ev.changes) {
      const nodeId = bindings.get(c.table)
      if (nodeId) c.nodeId = nodeId
    }
    ev.nodeIds = [...new Set(ev.changes.map((c) => c.nodeId).filter(Boolean))] as string[]
  }

  const matchedTables = [...bindings.keys()]
  const unmatchedTables = tables.filter((t) => !bindings.has(t))
  const totalMs = Math.max(1000, Number(file.totalMs) || events.reduce((m, e) => Math.max(m, e.startMs + e.durationMs), 0))
  const timeline: Timeline = {
    version: 1,
    totalMs,
    events,
    coreTables: matchedTables.map((t) => bindings.get(t)!).filter(Boolean),
    removedEventIds: [],
  }
  return {
    timeline,
    report: { ok: true, eventCount: events.length, changeCount, matchedTables, unmatchedTables },
  }
}

/** 未绑定表 -> 人工绑定到某个表节点：该表所有变更补上 nodeId，并加入核心表 */
export function bindTable(timeline: Timeline, table: string, nodeId: string): Timeline {
  const events = timeline.events.map((ev) => {
    const changes = ev.changes.map((c) => (c.table === table ? { ...c, nodeId } : c))
    const nodeIds = [...new Set(changes.map((c) => c.nodeId).filter(Boolean))] as string[]
    return { ...ev, changes, nodeIds }
  })
  const coreTables = timeline.coreTables.includes(nodeId) ? timeline.coreTables : [...timeline.coreTables, nodeId]
  return { ...timeline, events, coreTables }
}

/** 剧本里出现过的所有表名及统计（审阅面板用） */
export function tableUsage(timeline: Timeline) {
  const map = new Map<string, { table: string; nodeId?: string; changes: number; events: number }>()
  for (const ev of timeline.events) {
    if (timeline.removedEventIds.includes(ev.id)) continue
    for (const c of ev.changes) {
      const entry = map.get(c.table) ?? { table: c.table, nodeId: c.nodeId, changes: 0, events: 0 }
      entry.changes += 1
      if (!entry.nodeId && c.nodeId) entry.nodeId = c.nodeId
      map.set(c.table, entry)
    }
    const seen = new Set<string>()
    for (const c of ev.changes) {
      if (seen.has(c.table)) continue
      seen.add(c.table)
      const entry = map.get(c.table)
      if (entry) entry.events += 1
    }
  }
  return [...map.values()]
}

/** 裁剪后的剧本：去掉删除的事件、去掉非核心表的变更；空事件不导出 */
export function prunedTimeline(timeline: Timeline): Timeline {
  const core = new Set(timeline.coreTables)
  const removed = new Set(timeline.removedEventIds)
  const events = timeline.events
    .filter((ev) => !removed.has(ev.id))
    .map((ev) => ({ ...ev, changes: ev.changes.filter((c) => c.nodeId && core.has(c.nodeId)) }))
    .filter((ev) => ev.changes.length > 0)
  return { ...timeline, events }
}

/** 导出核心表剧本 JSON（只含保留的变更，可直接再导入回放） */
export function scenarioExportJson(timeline: Timeline, doc: DiagramDoc): string {
  const pruned = prunedTimeline(timeline)
  return JSON.stringify(
    {
      kind: 'mermaid-studio-scenario',
      version: 1,
      document: doc.name,
      totalMs: pruned.totalMs,
      events: pruned.events.map((ev) => ({
        name: ev.name,
        startMs: ev.startMs,
        durationMs: ev.durationMs,
        changes: ev.changes.map((c) => ({ table: c.table, field: c.field, value: c.value })),
      })),
    },
    null,
    2,
  )
}
