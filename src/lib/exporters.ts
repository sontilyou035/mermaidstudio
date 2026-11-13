import type { BlockDef, DiagramDoc, EdgeData, FlowNode } from '../types'
import { composeLabel } from '../blocks/registry'
import { renderDiagramForExport } from './render'

export type ExportFormat = 'md' | 'mmd' | 'json' | 'svg' | 'png'

export const FORMAT_META: Record<
  ExportFormat,
  { label: string; ext: string; mime: string; description: string; needsRender: boolean }
> = {
  md: {
    label: 'Markdown（内嵌 mermaid 代码块 · 推荐给 AI）',
    ext: '.md',
    mime: 'text/markdown;charset=utf-8',
    description: 'Markdown 文档',
    needsRender: false,
  },
  mmd: {
    label: 'Mermaid 源码（.mmd）',
    ext: '.mmd',
    mime: 'text/plain;charset=utf-8',
    description: 'Mermaid 文件',
    needsRender: false,
  },
  json: {
    label: '工程文件 .mermaid.json（含自定义节点块）',
    ext: '.mermaid.json',
    mime: 'application/json;charset=utf-8',
    description: 'Mermaid Studio 工程',
    needsRender: false,
  },
  svg: { label: 'SVG 矢量图', ext: '.svg', mime: 'image/svg+xml;charset=utf-8', description: 'SVG 图片', needsRender: true },
  png: { label: 'PNG 图片', ext: '.png', mime: 'image/png', description: 'PNG 图片', needsRender: true },
}

export interface MarkdownOptions {
  /** 写入一级标题 */
  title: boolean
  /** 写入「存疑清单」（每条虚线一条） */
  questions: boolean
  /** 写入「变更记录」 */
  changelog: boolean
}

export const DEFAULT_MD_OPTIONS: MarkdownOptions = { title: true, questions: true, changelog: true }

/** frontmatter 里那几项信息 */
export interface MarkdownMeta {
  author: string
  convention: string
  version: number
}

export const DEFAULT_MD_META: MarkdownMeta = {
  author: 'Mermaid Studio',
  convention: '虚线=待确认（见「存疑清单」逐条确认），实线=已确认；节点样式类见 classDef',
  version: 1,
}

const FLOW_HEADING = '## 流程图'
const QUESTIONS_HEADING = '## 存疑清单'
const CHANGELOG_HEADING = '## 变更记录'
const CHANGELOG_LIMIT = 30

/** YAML 里统一用双引号包住，避免冒号、# 之类把 frontmatter 写坏 */
function yamlValue(v: string): string {
  return `"${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

function sectionBody(text: string, heading: string): string[] | null {
  const lines = text.split(/\r?\n/)
  const start = lines.findIndex((l) => l.trim() === heading)
  if (start < 0) return null
  const body: string[] = []
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) break
    body.push(lines[i])
  }
  return body
}

function replaceSection(text: string, heading: string, body: string[]): string {
  const lines = text.split(/\r?\n/)
  const start = lines.findIndex((l) => l.trim() === heading)
  if (start < 0) return text
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) {
      end = i
      break
    }
  }
  return [...lines.slice(0, start + 1), ...body, ...lines.slice(end)].join('\n')
}

/** 取出所有非受管章节（用户在 Obsidian 里自己加的 ## 背景 / ## 备注 之类），避免被覆盖 */
function extraSections(text: string, managed: Set<string>): string[] {
  const lines = text.split(/\r?\n/)
  const chunks: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(##+)\s+(.*)$/)
    if (!m) continue
    const level = m[1].length
    const heading = lines[i].trim()
    if (managed.has(heading)) continue
    const body: string[] = []
    let j = i + 1
    for (; j < lines.length; j++) {
      const nm = lines[j].match(/^(#+)\s+/)
      if (nm && nm[1].length <= level) break
      body.push(lines[j])
    }
    chunks.push([heading, ...body].join('\n').trimEnd())
    i = j - 1
  }
  return chunks
}

interface QuestionItem {
  marker: string | null
  text: string
  line: string
}

function parseQuestions(lines: string[]): QuestionItem[] {
  const items: QuestionItem[] = []
  for (const raw of lines) {
    const line = raw.trim()
    const m = line.match(/^-\s*\[[ xX]\]\s*(.*)$/)
    if (!m) continue
    const marker = line.match(/<!--\s*ms:([\w-]+)\s*-->/)?.[1] ?? null
    items.push({ marker, text: m[1].replace(/<!--\s*ms:[\w-]+\s*-->/, '').trim(), line })
  }
  return items
}

/**
 * 合并上一次文件里手写的内容：
 *  - 「存疑清单」保留用户勾选状态和自定义条目；
 *  - 「变更记录」保留历史条目（新条目排最前）。
 */
export function mergeManagedSections(previous: string, next: string): string {
  let out = next

  const prevQ = sectionBody(previous, QUESTIONS_HEADING)
  const nextQ = sectionBody(out, QUESTIONS_HEADING)
  if (prevQ && nextQ) {
    const prevItems = parseQuestions(prevQ)
    const used = new Set<QuestionItem>()
    const merged: string[] = []
    for (const line of nextQ) {
      const m = line.match(/^-\s*\[[ xX]\]\s*(.*)$/)
      if (!m) {
        merged.push(line)
        continue
      }
      const marker = line.match(/<!--\s*ms:([\w-]+)\s*-->/)?.[1] ?? null
      const text = m[1].replace(/<!--\s*ms:[\w-]+\s*-->/, '').trim()
      // 先按标记认（用户可能改了文字），再退回文字匹配
      const hit =
        prevItems.find((p) => !used.has(p) && marker && p.marker === marker) ??
        prevItems.find((p) => !used.has(p) && p.text === text)
      if (hit) {
        used.add(hit)
        merged.push(hit.line)
      } else {
        merged.push(line.trim())
      }
    }
    // 用户自己加的条目（没有标记或对不上）留在最后
    for (const p of prevItems) if (!used.has(p)) merged.push(p.line)
    out = replaceSection(out, QUESTIONS_HEADING, merged)
  }

  // 用户自己加的章节原样保留在最后
  const managed = new Set([FLOW_HEADING, QUESTIONS_HEADING, CHANGELOG_HEADING])
  const extras = extraSections(previous, managed).filter((chunk: string) => {
    const heading = chunk.split('\n')[0].trim()
    return !out.includes(`\n${heading}\n`) && !out.startsWith(`${heading}\n`)
  })
  if (extras.length) out = `${out.trimEnd()}\n\n${extras.join('\n\n')}\n`

  const prevC = sectionBody(previous, CHANGELOG_HEADING)
  const nextC = sectionBody(out, CHANGELOG_HEADING)
  if (prevC && nextC) {
    const fresh = nextC.map((l) => l.trim()).filter(Boolean)
    const old = prevC.map((l) => l.trim()).filter((l) => l && !fresh.includes(l))
    const merged = [...nextC.filter((l) => l.trim()), ...old].slice(0, CHANGELOG_LIMIT + 8)
    out = replaceSection(out, CHANGELOG_HEADING, merged)
  }

  return out
}

/**
 * 每条虚线对应一条存疑项。
 * 行尾的 `<!-- ms:边id -->` 是给工具用的标记：重新导出时靠它认出同一条，
 * 从而保留你在 Obsidian 里改过的文字和勾选状态（在阅读视图里不显示）。
 */
export function dashedQuestions(doc: DiagramDoc): string[] {
  const labelOf = (id: string) => doc.nodes.find((n) => n.id === id)?.data.label ?? id
  return doc.edges
    .filter((e) => (e.data?.lineStyle ?? 'solid') === 'dashed')
    .map((e) => {
      const label = String(e.data?.label ?? '').trim()
      const route = `${labelOf(e.source)} → ${labelOf(e.target)}`
      return `- [ ] ${label ? `${label}（${route}）` : route} <!-- ms:${e.id} -->`
    })
}

function pad(n: number) {
  return String(n).padStart(2, '0')
}

export function formatTime(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 生成 Markdown：frontmatter + 标题 + mermaid 代码块 + 存疑清单 + 变更记录 */
export function buildMarkdown(
  doc: DiagramDoc,
  blocks: BlockDef[],
  code: string,
  opts: MarkdownOptions = DEFAULT_MD_OPTIONS,
  meta: MarkdownMeta = DEFAULT_MD_META,
  previous?: string | null,
): string {
  void blocks
  const now = formatTime(Date.now())
  const nodeCount = doc.nodes.filter((n) => !n.data.isSubgraph).length
  const groupCount = doc.nodes.filter((n) => n.data.isSubgraph).length
  const out: string[] = []

  // frontmatter：Obsidian / AI 都能直接读
  out.push('---')
  out.push(`title: ${yamlValue(doc.name || '未命名图表')}`)
  out.push('kind: mermaid-flowchart')
  out.push(`version: ${meta.version}`)
  out.push(`author: ${yamlValue(meta.author)}`)
  out.push(`updated: ${now}`)
  out.push(`convention: ${yamlValue(meta.convention)}`)
  out.push('---', '')

  if (opts.title) out.push(`# ${doc.name || '未命名图表'}`, '')

  out.push('## 流程图', '', '```mermaid', code.trim(), '```', '')

  if (opts.questions) {
    out.push(QUESTIONS_HEADING, '')
    out.push('<!-- 虚线代表待确认；每条虚线对应下面一条，确认后把 [ ] 改成 [x] -->', '')
    const items = dashedQuestions(doc)
    if (items.length) out.push(...items, '')
    else out.push('<!-- 本图没有虚线（待确认项） -->', '')
  }

  if (opts.changelog) {
    out.push(CHANGELOG_HEADING, '')
    out.push(`- ${now} v${meta.version} 导出（${nodeCount} 节点 / ${groupCount} 分组 / ${doc.edges.length} 连线）`, '')
  }

  const text = out.join('\n')
  return previous ? mergeManagedSections(previous, text) : text
}

/** 渲染出 SVG 字符串（默认 pele，失败回退 mermaid；导出时把主题内联进去） */
export async function renderMermaidSvg(
  code: string,
  dark: boolean,
  engine: 'pele' | 'mermaid' = 'pele',
  skin: 'warm' | 'cool' = 'warm',
): Promise<string> {
  return renderDiagramForExport(code, dark, engine, skin)
}

export async function svgToPngBlob(svg: string, dark: boolean, scale = 2): Promise<Blob> {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }))
  try {
    const img = new Image()
    await new Promise((resolve, reject) => {
      img.onload = resolve
      img.onerror = reject
      img.src = url
    })
    const canvas = document.createElement('canvas')
    canvas.width = (img.width || 1200) * scale
    canvas.height = (img.height || 800) * scale
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = dark ? '#0f172a' : '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (!blob) throw new Error('PNG 生成失败')
    return blob
  } finally {
    URL.revokeObjectURL(url)
  }
}

export interface BuildContext {
  doc: DiagramDoc
  blocks: BlockDef[]
  code: string
  projectJson: string
  name: string
  dark: boolean
  mdOptions?: MarkdownOptions
  mdMeta?: MarkdownMeta
  /** 上一次写出的 md 内容（用来保留手写的存疑项和历史变更记录） */
  previousMarkdown?: string | null
}

export function suggestedFileName(name: string, format: ExportFormat): string {
  const base = (name || 'diagram').replace(/[\\/:*?"<>|]+/g, '_').trim() || 'diagram'
  return `${base}${FORMAT_META[format].ext}`
}

/** 按格式产出最终要写盘的内容 */
export async function buildExport(ctx: BuildContext, format: ExportFormat): Promise<string | Blob> {
  switch (format) {
    case 'mmd':
      return ctx.code
    case 'json':
      return ctx.projectJson
    case 'md':
      return buildMarkdown(
        ctx.doc,
        ctx.blocks,
        ctx.code,
        ctx.mdOptions ?? DEFAULT_MD_OPTIONS,
        ctx.mdMeta ?? DEFAULT_MD_META,
        ctx.previousMarkdown,
      )
    case 'svg':
      return await renderMermaidSvg(ctx.code, ctx.dark)
    case 'png':
      return await svgToPngBlob(await renderMermaidSvg(ctx.code, ctx.dark), ctx.dark)
    default:
      return ctx.code
  }
}

export function isFlowNode(x: unknown): x is FlowNode {
  return typeof x === 'object' && x !== null && 'data' in (x as Record<string, unknown>)
}
