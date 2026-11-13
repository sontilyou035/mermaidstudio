import { BUILTIN_BLOCKS } from './builtins'
import { DEFAULT_PORTS, SHAPE_WRAP, type BlockDef, type NodeData, type ShapeKind } from '../types'

export function uid(prefix = 'id'): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-4)}`
}

/** 把任意文本变成合法的 Mermaid 节点 id */
export function toMermaidId(raw: string): string {
  const cleaned = String(raw).replace(/[^A-Za-z0-9_]/g, '_')
  return /^[A-Za-z_]/.test(cleaned) ? cleaned : `n_${cleaned}`
}

export function allBlocks(custom: BlockDef[]): BlockDef[] {
  return [...BUILTIN_BLOCKS, ...custom]
}

export function findBlock(blocks: BlockDef[], id: string): BlockDef {
  return blocks.find((b) => b.id === id) ?? BUILTIN_BLOCKS[0]
}

/**
 * 计算一个节点在画布和 Mermaid 中真正显示的文本。
 * 支持 {{label}} 与 {{字段key}}，\n 变成多行。
 */
export function composeLabel(data: Pick<NodeData, 'label' | 'values'>, block?: BlockDef): string {
  const tpl = block?.labelTemplate?.trim()
  if (!tpl) return data.label
  return tpl.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, key: string) => {
    if (key === 'label') return data.label ?? ''
    return data.values?.[key] ?? ''
  })
}

/** 节点在画布上显示的每一行（去掉空行） */
export function labelLines(text: string): string[] {
  return String(text)
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
}

/** Mermaid 引号内需要转义的字符 */
export function escapeMermaidLabel(text: string): string {
  return String(text)
    .replace(/\\/g, '/')
    .replace(/"/g, '&quot;')
    .replace(/\n+/g, '<br/>')
}

export function nodeShape(data: NodeData, block?: BlockDef): BlockDef['shape'] {
  return data.shape ?? block?.shape ?? 'rect'
}

export function wrapsFor(data: NodeData, block?: BlockDef) {
  if (block?.mermaidWrap) return block.mermaidWrap
  return SHAPE_WRAP[nodeShape(data, block)] ?? SHAPE_WRAP.rect
}

/** 新建自定义块时的默认值（复制一个已有块作为起点） */
export function cloneBlockAsCustom(base: BlockDef, nameSuffix = '副本'): BlockDef {
  return {
    ...base,
    id: uid('blk'),
    name: `${base.name} ${nameSuffix}`,
    builtin: false,
    fields: base.fields.map((f) => ({ ...f })),
    ports: base.ports.length ? base.ports.map((p) => ({ ...p })) : [...DEFAULT_PORTS],
    extraLines: base.extraLines ? [...base.extraLines] : undefined,
    updatedAt: Date.now(),
  }
}

/** 完全空白的新块 */
export function blankBlock(): BlockDef {
  return {
    id: uid('blk'),
    name: '新节点块',
    category: '我的',
    icon: '⭐',
    kind: 'node',
    shape: 'rect',
    fill: '#e2e8f0',
    stroke: '#334155',
    textColor: '#0f172a',
    width: 168,
    height: 56,
    fields: [],
    ports: [...DEFAULT_PORTS],
    builtin: false,
    description: '',
    updatedAt: Date.now(),
  }
}

/**
 * 导入时反向套用 labelTemplate：把导出的多行标签还原成节点的文本 + 字段值。
 * 例：`{{label}}\n{{key}}\n{{json}}` 遇到三行以上标签时，
 * 第一行 → 文本，第二行 → key，剩下的全部 → json。
 */
export function fillFieldsFromLabel(
  label: string,
  block: BlockDef,
): { label: string; values: Record<string, string> } | null {
  const tpl = block.labelTemplate?.trim()
  if (!tpl) return null
  const tplLines = tpl.split('\n').map((l) => l.trim())
  const labelLines = label.split('\n')
  if (tplLines.length < 2) return null
  const values: Record<string, string> = {}
  let mainLabel = ''
  for (let i = 0; i < tplLines.length; i++) {
    const holders = [...tplLines[i].matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map((m) => m[1])
    if (!holders.length) continue
    const isLast = i === tplLines.length - 1
    const raw = (isLast ? labelLines.slice(i).join('\n') : (labelLines[i] ?? '')).trim()
    if (holders.length === 1) {
      const key = holders[0]
      if (key === 'label') mainLabel = raw
      else if (block.fields.some((f) => f.key === key)) values[key] = raw
    } else {
      const parts = raw.split(/\s+/)
      holders.forEach((key, idx) => {
        const v = parts[idx] ?? ''
        if (key === 'label') mainLabel = v
        else if (block.fields.some((f) => f.key === key)) values[key] = v
      })
    }
  }
  if (!Object.keys(values).length && !mainLabel) return null
  return { label: mainLabel || labelLines[0].trim(), values }
}

/* ---------------- 节点 ID 前缀 ---------------- */

/** 按块 id 指定 ID 前缀；没有指定的走 className / 形状 / 兜底 */
export const PREFIX_BY_BLOCK_ID: Record<string, string> = {
  'builtin.start': 's',
  'builtin.doublecircle': 'e',
  'builtin.process': 'p',
  'builtin.decision': 'c',
  'builtin.io': 'io',
  'builtin.manual': 'a',
  'builtin.prep': 'pre',
  'builtin.subroutine': 'sp',
  'builtin.database': 'db',
  'builtin.table': 't',
  'builtin.redis': 'rd',
  'builtin.circle': 'k',
  'builtin.document': 'doc',
  'builtin.delay': 'w',
  'builtin.api': 'api',
  'builtin.service': 'svc',
  'builtin.cron': 'j',
  'builtin.mq': 'm',
  'builtin.note': 'note',
  'builtin.group': 'd',
}

const PREFIX_BY_CLASS: Record<string, string> = {
  role: 'r',
  action: 'a',
  process: 'p',
  table: 't',
  job: 'j',
  mq: 'm',
  external: 'f',
}

/** 前缀对应的兜底词（标签翻译不出英文时用） */
export const FALLBACK_WORD: Record<string, string> = {
  r: 'role', a: 'action', p: 'process', t: 'table', j: 'job', m: 'message', x: 'external',
  d: 'group', rd: 'redis', f: 'subject', s: 'start', e: 'end', c: 'condition', io: 'io',
  pre: 'prepare', sp: 'subprocess', db: 'database', k: 'knot', doc: 'document', w: 'wait',
  api: 'api', svc: 'service', note: 'note', n: 'node',
}

export function blockIdPrefix(block: BlockDef): string {
  if (block.idPrefix) return block.idPrefix
  const mapped = PREFIX_BY_BLOCK_ID[block.id]
  if (mapped) return mapped
  if (block.kind === 'subgraph') return 'd'
  if (block.className && PREFIX_BY_CLASS[block.className]) return PREFIX_BY_CLASS[block.className]
  return 'n'
}

export function blockFallbackWord(block: BlockDef): string {
  return FALLBACK_WORD[blockIdPrefix(block)] ?? 'node'
}

/* ---------------- 表格类节点 ---------------- */

export const TABLE_HEAD_H = 34
export const TABLE_ROW_H = 22

export function tableRows(columns: string | undefined): string[] {
  return String(columns ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
}

export function tableNodeHeight(columns: string | undefined, min = 96): number {
  return Math.max(min, TABLE_HEAD_H + tableRows(columns).length * TABLE_ROW_H + 12)
}

/* ---------------- JSON 结构体节点 ---------------- */

export const JSON_HEAD_H = 34
export const JSON_LINE_H = 16

export function jsonLines(raw: string | undefined): string[] {
  const text = String(raw ?? '').trim()
  if (!text) return []
  return text.split('\n')
}

export function jsonNodeHeight(raw: string | undefined, min = 110, maxLines = 18): number {
  const lines = Math.min(jsonLines(raw).length, maxLines)
  return Math.max(min, JSON_HEAD_H + lines * JSON_LINE_H + 18)
}

/** 按块的渲染方式算节点高度（表格 / JSON 结构体 / 普通节点用块默认高度） */
export function structuralNodeHeight(block: BlockDef, values: Record<string, string> | undefined): number {
  if (block.layout === 'table') return tableNodeHeight(values?.columns, 96)
  if (block.layout === 'json') return jsonNodeHeight(values?.json, 110)
  return block.height
}

/** 校验 + 美化 JSON，失败时返回错误信息 */
export function tryPrettyJson(raw: string): { ok: true; text: string } | { ok: false; error: string } {
  try {
    const parsed = JSON.parse(raw)
    return { ok: true, text: JSON.stringify(parsed, null, 2) }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

export function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function download(filename: string, content: string, mime = 'text/plain;charset=utf-8') {
  downloadBlob(filename, new Blob([content], { type: mime }))
}

export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.onchange = () => resolve(input.files?.[0] ?? null)
    input.click()
  })
}

export function readText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(reader.error)
    reader.readAsText(file)
  })
}

export function safeFileName(name: string, ext: string): string {
  const base = name.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'diagram'
  return `${base}${ext}`
}

/** Mermaid 形状 -> 内置块（导入 .mmd 时用来还原节点外观） */
export const SHAPE_TO_BUILTIN: Record<ShapeKind, string> = {
  rect: 'builtin.process',
  round: 'builtin.service',
  stadium: 'builtin.start',
  subroutine: 'builtin.subroutine',
  cylinder: 'builtin.database',
  circle: 'builtin.circle',
  doublecircle: 'builtin.doublecircle',
  diamond: 'builtin.decision',
  hexagon: 'builtin.prep',
  parallelogram: 'builtin.io',
  'parallelogram-alt': 'builtin.delay',
  trapezoid: 'builtin.manual',
  'trapezoid-alt': 'builtin.manual',
  asymmetric: 'builtin.document',
  text: 'builtin.note',
  group: 'builtin.group',
}

export function blockForShape(shape: ShapeKind, blocks: BlockDef[]): BlockDef {
  const id = SHAPE_TO_BUILTIN[shape] ?? 'builtin.process'
  return blocks.find((b) => b.id === id) ?? blocks[0]
}

/** 通过 classDef 样式在现有块中找一个最匹配的（导入时保留自定义块外观） */
export function blockForStyle(style: Record<string, string> | undefined, blocks: BlockDef[]): BlockDef | null {
  if (!style) return null
  const fill = (style.fill || '').toLowerCase()
  const stroke = (style.stroke || '').toLowerCase()
  if (!fill && !stroke) return null
  return (
    blocks.find((b) => {
      const bf = (b.classDef ?? '').toLowerCase()
      if (bf && fill && bf.includes(fill) && (!stroke || bf.includes(stroke))) return true
      return b.fill.toLowerCase() === fill && (!stroke || b.stroke.toLowerCase() === stroke)
    }) ?? null
  )
}
