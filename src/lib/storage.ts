import type { BlockDef, DiagramDoc, DocMeta } from '../types'
import { DEFAULT_EDGE_DATA } from '../types'
import { BUILTIN_BLOCKS } from '../blocks/builtins'
import { nodeFromBlock, CURVE_TO_RF, normalizeDoc } from './factory'
import { uid } from '../blocks/registry'

const K_INDEX = 'mermaid-studio:index'
const K_DOC = (id: string) => `mermaid-studio:doc:${id}`
const K_BLOCKS = 'mermaid-studio:custom-blocks'
const K_SETTINGS = 'mermaid-studio:settings'
const K_MD_VERSION = (docId: string) => `mermaid-studio:md-version:${docId}`

export interface Settings {
  theme: 'light' | 'dark'
  includeStyles: boolean
  snapToGrid: boolean
  /** true = 左键拖拽框选元素；false = 左键拖拽平移画布 */
  boxSelect: boolean
  /** 选了保存文件之后，按间隔自动写入该文件 */
  autoSaveFile: boolean
  /** 自动写入间隔（秒） */
  autoSaveIntervalSec: number
  /** 导出的 md 里 frontmatter 的 author */
  mdAuthor: string
  /** 导出的 md 里 frontmatter 的 convention */
  mdConvention: string
  /** 预览/导出的渲染引擎：pele（默认，快且小）或 mermaid（官方兜底） */
  renderEngine: 'pele' | 'mermaid'
  /** 界面皮肤：warm（暖白 + 陶土橙，默认）/ cool（冷灰蓝） */
  skin: 'warm' | 'cool'
  /** 主视图：流程图（可编辑）/ 关系图谱（只读诊断镜） */
  viewMode: 'flow' | 'graph'
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'light',
  includeStyles: true,
  snapToGrid: false,
  boxSelect: true,
  autoSaveFile: true,
  autoSaveIntervalSec: 60,
  mdAuthor: 'Mermaid Studio',
  mdConvention: '虚线=待确认（见「存疑清单」逐条确认），实线=已确认；节点样式类见 classDef',
  renderEngine: 'pele',
  skin: 'warm',
  viewMode: 'flow',
}

interface IndexShape {
  order: string[]
  active: string | null
  metas: Record<string, DocMeta>
}

function safeGet<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function safeSet(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch (err) {
    console.warn('[mermaid-studio] 保存失败', err)
    return false
  }
}

export function loadIndex(): IndexShape {
  return safeGet<IndexShape>(K_INDEX, { order: [], active: null, metas: {} })
}

export function saveIndex(index: IndexShape) {
  safeSet(K_INDEX, index)
}

export function loadDoc(id: string): DiagramDoc | null {
  const doc = safeGet<DiagramDoc | null>(K_DOC(id), null)
  if (!doc || !Array.isArray(doc.nodes)) return doc
  return normalizeDoc(doc)
}

export function persistDoc(doc: DiagramDoc, index: IndexShape): IndexShape {
  const next: IndexShape = {
    order: index.order.includes(doc.id) ? index.order : [doc.id, ...index.order],
    active: doc.id,
    metas: {
      ...index.metas,
      [doc.id]: {
        id: doc.id,
        name: doc.name,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
        nodeCount: doc.nodes.length,
        edgeCount: doc.edges.length,
      },
    },
  }
  safeSet(K_DOC(doc.id), doc)
  saveIndex(next)
  return next
}

export function removeDoc(id: string, index: IndexShape): IndexShape {
  try {
    localStorage.removeItem(K_DOC(id))
  } catch {
    /* ignore */
  }
  const { [id]: _drop, ...metas } = index.metas
  const next: IndexShape = { order: index.order.filter((x) => x !== id), active: index.active === id ? null : index.active, metas }
  saveIndex(next)
  return next
}

export function loadCustomBlocks(): BlockDef[] {
  return safeGet<BlockDef[]>(K_BLOCKS, [])
}

export function persistCustomBlocks(blocks: BlockDef[]) {
  safeSet(K_BLOCKS, blocks)
}

export function loadSettings(): Settings {
  return { ...DEFAULT_SETTINGS, ...safeGet<Partial<Settings>>(K_SETTINGS, {}) }
}

export function persistSettings(s: Settings) {
  safeSet(K_SETTINGS, s)
}

/** md 文档版本号：每次手动导出 +1，自动保存不变 */
export function loadMdVersion(docId: string): number {
  return safeGet<number>(K_MD_VERSION(docId), 0)
}

export function bumpMdVersion(docId: string): number {
  const next = loadMdVersion(docId) + 1
  safeSet(K_MD_VERSION(docId), next)
  return next
}

export function storageBytes(): number {
  try {
    let total = 0
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (!k || !k.startsWith('mermaid-studio:')) continue
      total += (localStorage.getItem(k) ?? '').length + k.length
    }
    return total
  } catch {
    return 0
  }
}

/** 首次打开时的示例图 */
export function createStarterDoc(): DiagramDoc {
  const byId = (id: string) => BUILTIN_BLOCKS.find((b) => b.id === id) ?? BUILTIN_BLOCKS[0]
  const start = nodeFromBlock(byId('builtin.start'), { x: 340, y: 40 }, '开始')
  const input = nodeFromBlock(byId('builtin.io'), { x: 320, y: 150 }, '读取订单')
  const check = nodeFromBlock(byId('builtin.decision'), { x: 315, y: 270 }, '库存充足？')
  const ok = nodeFromBlock(byId('builtin.process'), { x: 128, y: 440 }, '创建发货单')
  const fail = nodeFromBlock(byId('builtin.process'), { x: 540, y: 440 }, '通知补货')
  const db = nodeFromBlock(byId('builtin.database'), { x: 146, y: 580 }, '订单库')
  const end = nodeFromBlock(byId('builtin.start'), { x: 344, y: 700 }, '结束')

  ok.data.values = {}
  const mk = (source: string, target: string, label = '', patch = {}) => ({
    id: uid('e'),
    source,
    target,
    type: CURVE_TO_RF[DEFAULT_EDGE_DATA.curve],
    data: { ...DEFAULT_EDGE_DATA, label, ...patch },
    label: label || undefined,
  })

  return {
    id: uid('doc'),
    name: '示例流程',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    direction: 'TB',
    nodes: [start, input, check, ok, fail, db, end],
    edges: [
      mk(start.id, input.id),
      mk(input.id, check.id),
      mk(check.id, ok.id, '是'),
      mk(check.id, fail.id, '否'),
      mk(ok.id, db.id),
      mk(db.id, end.id),
    ],
  }
}
