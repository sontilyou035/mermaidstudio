import { create } from 'zustand'
import { getRfInstance } from './lib/rf'
import { makeNodeId, sanitizeNodeId } from './lib/translate'
import { findEdgeLabelIssues } from './lib/edgeLabels'
import { buildBackup, parseBackup } from './lib/backup'
import {
  DEFAULT_MD_META,
  DEFAULT_MD_OPTIONS,
  FORMAT_META,
  buildExport,
  suggestedFileName,
  type ExportFormat,
  type MarkdownMeta,
  type MarkdownOptions,
} from './lib/exporters'
import {
  chooseSaveTarget,
  hasTargetHandle,
  readSaveTarget,
  clearCurrentTarget,
  forgetSaveTarget,
  getSaveTarget,
  requestTargetPermission,
  restorePersistedTarget,
  supportsFilePicker,
  writeToSaveTarget,
  type SaveTargetInfo,
} from './lib/files'
import { downloadBlob } from './blocks/registry'
import {
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type EdgeChange,
  type NodeChange,
  type XYPosition,
} from '@xyflow/react'
import {
  DEFAULT_EDGE_DATA,
  type BlockDef,
  type DiagramDoc,
  type Direction,
  type DocMeta,
  type EdgeData,
  type FlowEdge,
  type FlowNode,
  type NodeData,
  type ProjectFile,
} from './types'
import {
  bindTable,
  parseScenario,
  scenarioExportJson,
  tableUsage,
  type ImportReport,
} from './lib/timeline'
import {
  allBlocks,
  blockFallbackWord,
  blockForShape,
  blockIdPrefix,
  blockForStyle,
  blankBlock,
  cloneBlockAsCustom,
  structuralNodeHeight,
  jsonNodeHeight,
  tableNodeHeight,
  composeLabel,
  fillFieldsFromLabel,
  findBlock,
  toMermaidId,
  uid,
} from './blocks/registry'
import { BUILTIN_BLOCKS } from './blocks/builtins'
import { CURVE_TO_RF, edgeFromConnection, nodeFromBlock, normalizeDoc, withEdgeData } from './lib/factory'
import { autoLayout, orderTopDown, syncGroups } from './lib/layout'
import { parseMermaid, toMermaid, edgeTokenToData } from './lib/mermaid'
import { fitNodeWidth } from './lib/textFit'
import { applyDefaultHandles, forceDefaultHandles, portGetter, withHandleMode } from './lib/ports'
import {
  bumpMdVersion,
  createStarterDoc,
  loadCustomBlocks,
  loadMdVersion,
  loadDoc,
  loadIndex,
  loadSettings,
  persistCustomBlocks,
  persistDoc,
  persistSettings,
  removeDoc,
  storageBytes,
  type Settings,
} from './lib/storage'

export type RightTab = 'inspector' | 'layers' | 'blocks' | 'code' | 'preview' | 'files'
export type Theme = 'light' | 'dark'

interface Snapshot {
  nodes: FlowNode[]
  edges: FlowEdge[]
  direction: Direction
}

interface Toast {
  id: string
  message: string
  kind: 'info' | 'error' | 'success'
}

interface IndexState {
  order: string[]
  active: string | null
  metas: Record<string, DocMeta>
}

interface State {
  doc: DiagramDoc
  index: IndexState
  customBlocks: BlockDef[]
  settings: Settings
  past: Snapshot[]
  future: Snapshot[]
  dirty: boolean
  savedAt: number | null
  rightTab: RightTab
  rightOpen: boolean
  /** 左栏（节点块）是否展开；折叠后画布占满 */
  paletteOpen: boolean
  toasts: Toast[]
  blockEditor: { open: boolean; draft: BlockDef | null }
  mermaidDraft: string | null

  /* --- 剧本（时间轴演示） --- */
  player: {
    playing: boolean
    speed: number
    cursorMs: number
    hasRun: boolean
    /** nodeId -> field -> value（运行时的值覆盖层） */
    values: Record<string, Record<string, string>>
    /** nodeId -> field -> 变更时间戳（用于渐变动画） */
    changed: Record<string, Record<string, number>>
    /** edgeId -> 闪烁时间戳 */
    blink: Record<string, number>
  }
  timelineOpen: boolean
  importScenario: (raw: unknown) => ImportReport
  bindScenarioTable: (table: string, nodeId: string) => void
  toggleCoreTable: (nodeId: string) => void
  removeScenarioEvent: (eventId: string) => void
  restoreScenarioEvent: (eventId: string) => void
  scenarioJson: () => string
  scenarioUsage: () => ReturnType<typeof tableUsage>
  playTimeline: () => void
  pauseTimeline: () => void
  replayTimeline: () => void
  seekTimeline: (ms: number) => void
  setPlaybackSpeed: (speed: number) => void
  resetTimeline: () => void
  tickTimeline: () => void
  setTimelineOpen: (open: boolean) => void

  /* --- 派生 --- */
  blocks: () => BlockDef[]

  /* --- 图操作 --- */
  onNodesChange: (changes: NodeChange<FlowNode>[]) => void
  onEdgesChange: (changes: EdgeChange<FlowEdge>[]) => void
  onConnect: (c: Connection) => void
  onReconnect: (edge: FlowEdge, connection: Connection) => void
  addNodeFromBlock: (blockId: string, position: XYPosition, label?: string) => string | null
  updateNodeData: (id: string, patch: Partial<NodeData>) => void
  renameNodeId: (oldId: string, newId: string) => boolean
  regenerateNodeId: (id: string) => string | null
  setNodeField: (id: string, key: string, value: string) => void
  changeNodeBlock: (id: string, blockId: string) => void
  updateEdgeData: (id: string, patch: Partial<EdgeData>) => void
  setEdgeHandle: (id: string, end: 'source' | 'target', handleId: string | null) => void
  resetEdgeHandles: (id?: string) => void
  setEdgeLabelType: (id: string, type: string, note?: string) => void
  normalizeEdgeLabels: () => number
  edgeLabelIssues: () => Array<{ edgeId: string; label: string; suggestion: string }>
  deleteSelection: () => void
  duplicateSelection: () => void
  beginAltDragCopy: (ids: string[]) => void
  finishAltDragCopy: (moved: boolean) => void
  selectAll: () => void
  clearSelection: () => void
  setNodeSize: (id: string, width: number, height: number) => void
  selectOnly: (ids: string[], focus?: boolean) => void
  selectEdge: (id: string) => void
  toggleNodeHidden: (id: string) => void
  toggleNodeLocked: (id: string) => void
  toggleEdgeHidden: (id: string) => void
  showAll: () => void
  showOnlySelected: () => void
  changeZOrder: (id: string, mode: 'front' | 'back' | 'forward' | 'backward') => void
  groupSelection: () => void
  addSelectionToGroup: (groupId: string) => void
  removeSelectionFromGroup: () => void
  fitGroupToMembers: (groupId: string) => void
  alignSelection: (mode: 'left' | 'right' | 'top' | 'bottom' | 'hcenter' | 'vcenter') => void
  distributeSelection: (axis: 'h' | 'v') => void
  setDirection: (d: Direction) => void
  runAutoLayout: () => void
  afterDragStop: () => void
  placeGroupMembers: (entries: Array<{ id: string; x: number; y: number }>) => void

  /* --- 历史 --- */
  pushHistory: () => void
  undo: () => void
  redo: () => void

  /* --- 保存到文件 --- */
  saveDialogOpen: boolean
  fileTarget: SaveTargetInfo | null
  changedAt: number
  openSaveDialog: () => void
  closeSaveDialog: () => void
  refreshFileTarget: () => Promise<void>
  forgetFile: () => Promise<void>
  grantFilePermission: () => Promise<boolean>
  mdVersion: () => number
  saveToFile: (opts: {
    format: ExportFormat
    name: string
    mdOptions: MarkdownOptions
    chooseLocation: boolean
  }) => Promise<{ ok: boolean; message: string; cancelled?: boolean }>
  autoSaveToFile: () => Promise<boolean>

  /* --- 文档 --- */
  newDoc: () => void
  loadSample: () => void
  openDoc: (id: string) => void
  renameDoc: (name: string) => void
  renameDocById: (id: string, name: string) => void
  deleteDoc: (id: string) => void
  duplicateDoc: () => void
  saveNow: () => void

  /* --- 导入导出 --- */
  exportAllData: () => string
  importAllData: (text: string) => { docs: number; blocks: number }
  exportProjectJson: () => string
  importProjectJson: (text: string) => void
  currentMermaid: (includeStyles?: boolean) => string
  importMermaid: (code: string) => { ok: boolean; message: string }
  setMermaidDraft: (v: string | null) => void

  /* --- 自定义块 --- */
  openBlockEditor: (blockId?: string) => void
  closeBlockEditor: () => void
  updateDraft: (patch: Partial<BlockDef>) => void
  saveDraft: () => void
  deleteBlock: (id: string) => void
  duplicateBlock: (id: string) => void
  resetCustomBlocks: () => void
  importBlocks: (blocks: BlockDef[]) => void

  /* --- UI --- */
  setTheme: (t: Theme) => void
  toggleTheme: () => void
  setRightTab: (t: RightTab) => void
  toggleRight: () => void
  togglePalette: () => void
  updateSettings: (patch: Partial<Settings>) => void
  toast: (message: string, kind?: Toast['kind']) => void
  dismissToast: (id: string) => void
}

/* ------------------------------------------------------------------ */

let saveTimer: ReturnType<typeof setTimeout> | null = null
const HISTORY_LIMIT = 80

/* ---------------- 剧本回放（运行时不进文档、不进撤销栈） ---------------- */

let rafId = 0
let lastTick = 0

function tableNodesOf(doc: DiagramDoc, blocks: BlockDef[]): FlowNode[] {
  const ids = new Set(blocks.filter((b) => b.layout === 'table').map((b) => b.id))
  return doc.nodes.filter((n) => !n.data.isSubgraph && ids.has(n.data.blockId))
}

/** 播放头时刻的值覆盖层：nodeId -> field -> value（同字段后到先得） */
function overlayAt(doc: DiagramDoc, cursorMs: number): Record<string, Record<string, string>> {
  const tl = doc.timeline
  const out: Record<string, Record<string, string>> = {}
  if (!tl) return out
  const removed = new Set(tl.removedEventIds)
  const events = [...tl.events].filter((e) => !removed.has(e.id)).sort((a, b) => a.startMs - b.startMs)
  for (const ev of events) {
    if (ev.startMs > cursorMs) continue
    for (const c of ev.changes) {
      if (!c.nodeId) continue
      const row = (out[c.nodeId] ??= {})
      row[c.field] = c.value
    }
  }
  return out
}

function edgesTouching(doc: DiagramDoc, nodeIds: string[]): string[] {
  const set = new Set(nodeIds)
  return doc.edges.filter((e) => set.has(e.source) || set.has(e.target)).map((e) => e.id)
}


/** 按住 Option/Alt 拖拽时的临时记录：原件留在原地，副本跟着鼠标走 */
interface AltDragRecord {
  /** 原件 id -> 副本 id */
  idMap: Map<string, string>
  /** 原件拖动前的位置 */
  originStart: Map<string, { x: number; y: number }>
  /** 为了「连线看着不动」被临时挂到副本上的边，结束时还原 */
  edgeRewire: Array<{ edgeId: string; from: string; to: string }>
}
let altDragRecord: AltDragRecord | null = null

function snapshot(doc: DiagramDoc): Snapshot {
  return {
    nodes: doc.nodes.map((n) => ({ ...n, data: { ...n.data, values: { ...n.data.values } } })),
    edges: doc.edges.map((e) => ({ ...e, data: { ...DEFAULT_EDGE_DATA, ...e.data } })),
    direction: doc.direction,
  }
}

function buildMdMeta(settings: { mdAuthor: string; mdConvention: string }, version: number): MarkdownMeta {
  return {
    author: settings.mdAuthor?.trim() || DEFAULT_MD_META.author,
    convention: settings.mdConvention?.trim() || DEFAULT_MD_META.convention,
    version: Math.max(1, version),
  }
}

/**
 * 老文档 / 外部导入的文档：连线没记录端口归属时，按骨架方向补上默认端口，
 * 已经人工指定过端口的边不动。
 */
function withDefaultHandles(doc: DiagramDoc, blocks: BlockDef[]): DiagramDoc {
  const edges = applyDefaultHandles(doc.edges, doc.direction, portGetter(doc.nodes, blocks))
  return edges === doc.edges ? doc : { ...doc, edges }
}

function initState() {
  const index = loadIndex()
  const settings = loadSettings()
  const customBlocks = loadCustomBlocks()
  let doc: DiagramDoc | null = null
  if (index.active) doc = loadDoc(index.active)
  if (!doc && index.order.length) doc = loadDoc(index.order[0])
  if (!doc) doc = createStarterDoc()
  doc = withDefaultHandles(doc, allBlocks(customBlocks))
  return { index, settings, customBlocks, doc }
}

export const useStore = create<State>()((set, get) => {
  const initial = initState()

  const scheduleSave = () => {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      const { doc, index } = get()
      const stamped: DiagramDoc = { ...doc, updatedAt: Date.now() }
      const nextIndex = persistDoc(stamped, index)
      set({ index: nextIndex, dirty: false, savedAt: Date.now() })
    }, 700)
  }

  /** 统一的“可撤销修改”入口 */
  const commit = (mutator: (doc: DiagramDoc) => DiagramDoc, opts: { history?: boolean } = {}) => {
    const state = get()
    const history = opts.history !== false
    const past = history ? [...state.past, snapshot(state.doc)].slice(-HISTORY_LIMIT) : state.past
    set({
      doc: { ...mutator(state.doc), updatedAt: Date.now() },
      past,
      future: history ? [] : state.future,
      dirty: true,
      changedAt: Date.now(),
    })
    scheduleSave()
  }

  return {
    doc: initial.doc,
    index: initial.index,
    customBlocks: initial.customBlocks,
    settings: initial.settings,
    past: [],
    future: [],
    dirty: false,
    savedAt: null,
    rightTab: 'inspector',
    rightOpen: true,
    paletteOpen: true,
    toasts: [],
    blockEditor: { open: false, draft: null },
    mermaidDraft: null,
    player: { playing: false, speed: 1, cursorMs: 0, hasRun: false, values: {}, changed: {}, blink: {} },
    timelineOpen: false,
    saveDialogOpen: false,
    fileTarget: null,
    changedAt: Date.now(),

    blocks: () => allBlocks(get().customBlocks),

    /* ---------------- 图操作 ---------------- */

    onNodesChange: (changes) => {
      // 删除节点/连线要能撤销
      if (changes.some((c) => c.type === 'remove')) get().pushHistory()
      // 只有真正的编辑才算「有改动」：选中、以及非缩放的尺寸测量都不算
      const meaningful = changes.some(
        (c) => c.type === 'position' || c.type === 'remove' || c.type === 'add' || c.type === 'replace' || (c.type === 'dimensions' && c.resizing),
      )
      set((state) => {
        const nodes = applyNodeChanges(changes, state.doc.nodes)
        const removed = changes.some((c) => c.type === 'remove')
        let edges = state.doc.edges
        if (removed) {
          const ids = new Set(nodes.map((n) => n.id))
          edges = edges.filter((e) => ids.has(e.source) && ids.has(e.target))
        }
        return meaningful
          ? { doc: { ...state.doc, nodes, edges }, dirty: true, changedAt: Date.now() }
          : { doc: { ...state.doc, nodes, edges } }
      })
    },

    onEdgesChange: (changes) => {
      if (changes.some((c) => c.type === 'remove')) get().pushHistory()
      const meaningful = changes.some((c) => c.type === 'remove' || c.type === 'add' || c.type === 'replace')
      set((state) =>
        meaningful
          ? { doc: { ...state.doc, edges: applyEdgeChanges(changes, state.doc.edges) }, dirty: true, changedAt: Date.now() }
          : { doc: { ...state.doc, edges: applyEdgeChanges(changes, state.doc.edges) } },
      )
    },

    onReconnect: (edge, connection) => {
      if (!connection.source || !connection.target) return
      get().pushHistory()
      set((state) => ({
        doc: {
          ...state.doc,
          edges: state.doc.edges.map((e) =>
            e.id === edge.id
              ? withHandleMode(
                  {
                    ...e,
                    source: connection.source!,
                    target: connection.target!,
                    sourceHandle: connection.sourceHandle,
                    targetHandle: connection.targetHandle,
                  },
                  // 用户亲手拖过端点：记成人工指定，之后切方向不再翻面
                  'manual',
                )
              : e,
          ),
        },
        dirty: true,
      }))
    },

    onConnect: (c) => {
      if (!c.source || !c.target) return
      get().pushHistory()
      // 新连线默认空白：不带上一次/推荐的标签，让用户自己填
      commit(
        (doc) => ({
          ...doc,
          edges: [...doc.edges, edgeFromConnection(c.source!, c.target!, { sourceHandle: c.sourceHandle, targetHandle: c.targetHandle })],
        }),
        { history: false },
      )
    },

    addNodeFromBlock: (blockId, position, label) => {
      const blocks = allBlocks(get().customBlocks)
      const block = blocks.find((b) => b.id === blockId)
      if (!block) return null
      // 新节点默认选中（同时取消其它选中），方便马上改名/设字段
      const taken = new Set(get().doc.nodes.map((n) => n.id))
      const node = { ...nodeFromBlock(block, position, label, taken), selected: true }
      commit((doc) => ({
        ...doc,
        nodes: block.kind === 'subgraph'
          ? [node, ...doc.nodes.map((n) => (n.selected ? { ...n, selected: false } : n))]
          : [...doc.nodes.map((n) => (n.selected ? { ...n, selected: false } : n)), node],
      }))
      set({ rightTab: 'inspector', rightOpen: true })
      return node.id
    },

    renameNodeId: (oldId, newIdRaw) => {
      const state = get()
      const newId = sanitizeNodeId(newIdRaw)
      if (!newId) {
        state.toast('ID 不能为空，只能用字母数字下划线', 'error')
        return false
      }
      if (newId === oldId) return true
      if (state.doc.nodes.some((n) => n.id === newId)) {
        state.toast(`ID「${newId}」已经被占用`, 'error')
        return false
      }
      get().pushHistory()
      commit(
        (doc) => ({
          ...doc,
          nodes: doc.nodes.map((n) => {
            if (n.id === oldId) return { ...n, id: newId }
            // 组内节点记的是分组 id，也要跟着改
            if (n.data.groupId === oldId) return { ...n, data: { ...n.data, groupId: newId } }
            return n
          }),
          edges: doc.edges.map((e) =>
            e.source === oldId || e.target === oldId
              ? { ...e, source: e.source === oldId ? newId : e.source, target: e.target === oldId ? newId : e.target }
              : e,
          ),
        }),
        { history: false },
      )
      return true
    },

    regenerateNodeId: (id) => {
      const state = get()
      const node = state.doc.nodes.find((n) => n.id === id)
      if (!node) return null
      const blocks = allBlocks(state.customBlocks)
      const block = blocks.find((b) => b.id === node.data.blockId) ?? blocks[0]
      const taken = new Set(state.doc.nodes.filter((n) => n.id !== id).map((n) => n.id))
      const next = makeNodeId(blockIdPrefix(block), node.data.label, blockFallbackWord(block), taken)
      return get().renameNodeId(id, next) ? next : null
    },

    updateNodeData: (id, patch) =>
      commit((doc) => ({
        ...doc,
        nodes: doc.nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)),
      })),

    setNodeField: (id, key, value) => {
      const blocks = allBlocks(get().customBlocks)
      commit(
        (doc) => ({
          ...doc,
          nodes: doc.nodes.map((n) => {
            if (n.id !== id) return n
            const values = { ...n.data.values, [key]: value }
            const block = blocks.find((b) => b.id === n.data.blockId)
            // 表格 / JSON 结构体节点：内容行数变化时自动调整高度
            if ((block?.layout === 'table' && key === 'columns') || (block?.layout === 'json' && key === 'json')) {
              const height = block.layout === 'table' ? tableNodeHeight(values.columns, 96) : jsonNodeHeight(values.json, 110)
              return { ...n, data: { ...n.data, values, height }, style: { ...(n.style ?? {}), height } }
            }
            return { ...n, data: { ...n.data, values } }
          }),
        }),
        { history: false },
      )
    },

    changeNodeBlock: (id, blockId) => {
      const blocks = allBlocks(get().customBlocks)
      const block = blocks.find((b) => b.id === blockId)
      if (!block) return
      commit((doc) => ({
        ...doc,
        nodes: doc.nodes.map((n) => {
          if (n.id !== id) return n
          const values = { ...n.data.values }
          for (const f of block.fields) if (values[f.key] === undefined) values[f.key] = f.default ?? ''
          return {
            ...n,
            style: { ...(n.style ?? {}), width: block.width, height: structuralNodeHeight(block, n.data.values) },
            data: {
              ...n.data,
              blockId: block.id,
              fill: block.fill,
              stroke: block.stroke,
              textColor: block.textColor,
              shape: block.shape,
              width: block.width,
              height: structuralNodeHeight(block, values),
              isSubgraph: block.kind === 'subgraph',
              values,
            },
          }
        }),
      }))
    },

    updateEdgeData: (id, patch) =>
      commit(
        (doc) => ({ ...doc, edges: doc.edges.map((e) => (e.id === id ? withEdgeData(e, patch) : e)) }),
        { history: false },
      ),

    /** 人工指定某一端的端口（检查器下拉框 / 直接拖端点） */
    setEdgeHandle: (id, end, handleId) => {
      get().pushHistory()
      commit(
        (doc) => ({
          ...doc,
          edges: doc.edges.map((e) =>
            e.id === id
              ? withHandleMode(
                  end === 'source' ? { ...e, sourceHandle: handleId } : { ...e, targetHandle: handleId },
                  'manual',
                )
              : e,
          ),
        }),
        { history: false },
      )
    },

    /** 恢复自动分配：按当前骨架方向重算端口；不传 id 就只收拾「自动」的边 */
    resetEdgeHandles: (id) => {
      const state = get()
      const portsOf = portGetter(state.doc.nodes, state.blocks())
      get().pushHistory()
      commit(
        (doc) => ({
          ...doc,
          edges: id
            ? doc.edges.map((e) => (e.id === id ? forceDefaultHandles(e, doc.direction, portsOf) : e))
            : applyDefaultHandles(doc.edges, doc.direction, portsOf),
        }),
        { history: false },
      )
    },

    setEdgeLabelType: (id, type, note) =>
      commit(
        (doc) => ({
          ...doc,
          edges: doc.edges.map((e) => (e.id === id ? withEdgeData(e, { type, note: note ?? e.data?.note ?? '' }) : e)),
        }),
        { history: false },
      ),

    edgeLabelIssues: () => {
      const state = get()
      const blocksNow = allBlocks(state.customBlocks)
      const prefixOf = (nodeId: string) => {
        const n = state.doc.nodes.find((x) => x.id === nodeId)
        const b = n ? blocksNow.find((x) => x.id === n.data.blockId) : undefined
        return b ? blockIdPrefix(b) : ''
      }
      return findEdgeLabelIssues(state.doc.edges, prefixOf)
    },

    normalizeEdgeLabels: () => {
      const state = get()
      const blocksNow = allBlocks(state.customBlocks)
      const prefixOf = (nodeId: string) => {
        const n = state.doc.nodes.find((x) => x.id === nodeId)
        const b = n ? blocksNow.find((x) => x.id === n.data.blockId) : undefined
        return b ? blockIdPrefix(b) : ''
      }
      const issues = findEdgeLabelIssues(state.doc.edges, prefixOf)
      if (!issues.length) return 0
      const byId = new Map(issues.map((i) => [i.edgeId, i]))
      get().pushHistory()
      commit(
        (doc) => ({
          ...doc,
          edges: doc.edges.map((e) => {
            const issue = byId.get(e.id)
            if (!issue) return e
            // 原来那点文字当说明留着，类型换成推荐的
            const note = issue.label && !issue.label.includes(':') ? issue.label : (e.data?.note ?? '')
            return withEdgeData(e, { type: issue.suggestion, note })
          }),
        }),
        { history: false },
      )
      get().toast(`已按规范补全 ${issues.length} 条连线标签`, 'success')
      return issues.length
    },

    deleteSelection: () => {
      const { doc } = get()
      const nodeIds = new Set(doc.nodes.filter((n) => n.selected).map((n) => n.id))
      const edgeIds = new Set(doc.edges.filter((e) => e.selected).map((e) => e.id))
      if (!nodeIds.size && !edgeIds.size) return
      get().pushHistory()
      commit(
        (d) => ({
          ...d,
          nodes: d.nodes.filter((n) => !nodeIds.has(n.id)),
          edges: d.edges.filter((e) => !edgeIds.has(e.id) && !nodeIds.has(e.source) && !nodeIds.has(e.target)),
        }),
        { history: false },
      )
    },

    duplicateSelection: () => {
      const { doc } = get()
      const selected = doc.nodes.filter((n) => n.selected)
      if (!selected.length) return
      const idMap = new Map<string, string>()
      const clones = selected.map((n) => {
        const nid = uid('n')
        idMap.set(n.id, nid)
        return { ...n, id: nid, position: { x: n.position.x + 40, y: n.position.y + 40 }, selected: true, data: { ...n.data, values: { ...n.data.values } } }
      })
      const clonedEdges = doc.edges
        .filter((e) => idMap.has(e.source) && idMap.has(e.target))
        .map((e) => ({ ...e, id: uid('e'), source: idMap.get(e.source)!, target: idMap.get(e.target)!, selected: false }))
      get().pushHistory()
      commit(
        (d) => ({
          ...d,
          nodes: [...d.nodes.map((n) => ({ ...n, selected: false })), ...clones],
          edges: [...d.edges, ...clonedEdges],
        }),
        { history: false },
      )
    },

    beginAltDragCopy: (ids) => {
      const state = get()
      const { doc } = state
      const targets = ids.filter((id) => doc.nodes.some((n) => n.id === id))
      if (!targets.length) return
      const copies: FlowNode[] = []
      const idMap = new Map<string, string>()
      const originStart = new Map<string, { x: number; y: number }>()
      for (const id of targets) {
        const origin = doc.nodes.find((n) => n.id === id)
        if (!origin) continue
        const copy: FlowNode = {
          ...origin,
          id: uid(origin.data.isSubgraph ? 'g' : 'n'),
          position: { ...origin.position },
          selected: false,
          dragging: false,
          data: { ...origin.data, values: { ...origin.data.values } },
        }
        copies.push(copy)
        idMap.set(id, copy.id)
        originStart.set(id, { ...origin.position })
      }
      if (!copies.length) return
      // 把原件上的连线临时挂到副本上：拖动过程中看起来就是「原件原地不动、连线也不动」
      const edgeRewire: AltDragRecord['edgeRewire'] = []
      const edges = doc.edges.map((e) => {
        const s2 = idMap.get(e.source)
        const t2 = idMap.get(e.target)
        if (!s2 && !t2) return e
        edgeRewire.push({ edgeId: e.id, from: e.source, to: e.target })
        return { ...e, source: s2 ?? e.source, target: t2 ?? e.target }
      })
      altDragRecord = { idMap, originStart, edgeRewire }
      set({
        doc: { ...doc, nodes: [...doc.nodes, ...copies], edges },
        dirty: true,
        changedAt: Date.now(),
      })
    },

    finishAltDragCopy: (moved) => {
      const rec = altDragRecord
      altDragRecord = null
      if (!rec) return
      const state = get()
      const { doc } = state
      const copyIds = new Set(rec.idMap.values())
      const rewire = new Map(rec.edgeRewire.map((r) => [r.edgeId, r]))
      // 连线还原到原件上
      let edges = doc.edges.map((e) => {
        const r = rewire.get(e.id)
        return r ? { ...e, source: r.from, target: r.to } : e
      })

      if (!moved) {
        // 只是带了 Alt 点了一下，没有真的拖动 → 撤销这次复制
        set({
          doc: {
            ...doc,
            nodes: doc.nodes.filter((n) => !copyIds.has(n.id)),
            edges: edges.filter((e) => !copyIds.has(e.source) && !copyIds.has(e.target)),
          },
          dirty: true,
          changedAt: Date.now(),
        })
        return
      }

      // 副本接住拖到的位置，原件回到起点，并选中副本
      const copyPosition = new Map<string, { x: number; y: number }>()
      for (const [originId, copyId] of rec.idMap) {
        const origin = doc.nodes.find((n) => n.id === originId)
        if (origin) copyPosition.set(copyId, { ...origin.position })
      }
      const nodes = doc.nodes.map((n) => {
        const start = rec.originStart.get(n.id)
        if (start) return { ...n, position: { ...start }, selected: false }
        const p = copyPosition.get(n.id)
        return p ? { ...n, position: p, selected: true } : n
      })
      set({ doc: { ...doc, nodes, edges }, dirty: true, changedAt: Date.now() })
      get().toast(`已复制 ${rec.idMap.size} 个节点（⌥/Alt 拖拽）`, 'success')
    },

    selectAll: () =>
      set((state) => ({
        doc: { ...state.doc, nodes: state.doc.nodes.map((n) => ({ ...n, selected: true })) },
      })),

    clearSelection: () =>
      set((state) => ({
        doc: {
          ...state.doc,
          nodes: state.doc.nodes.map((n) => (n.selected ? { ...n, selected: false } : n)),
          edges: state.doc.edges.map((e) => (e.selected ? { ...e, selected: false } : e)),
        },
      })),

    setNodeSize: (id, width, height) =>
      set((state) => ({
        doc: {
          ...state.doc,
          nodes: state.doc.nodes.map((n) =>
            n.id === id
              ? { ...n, data: { ...n.data, width: Math.round(width), height: Math.round(height) }, style: { ...(n.style ?? {}), width, height } }
              : n,
          ),
        },
        dirty: true,
      })),

    selectOnly: (ids, focus) => {
      const set$ = new Set(ids)
      set((state) => ({
        doc: {
          ...state.doc,
          nodes: state.doc.nodes.map((n) => (n.selected === set$.has(n.id) ? n : { ...n, selected: set$.has(n.id) })),
          edges: state.doc.edges.map((e) => (e.selected ? { ...e, selected: false } : e)),
        },
      }))
      if (focus) {
        const target = get().doc.nodes.find((n) => set$.has(n.id))
        if (target) {
          getRfInstance()?.fitView({
            nodes: [{ id: target.id }],
            padding: 0.6,
            duration: 350,
            maxZoom: 1.4,
          })
        }
      }
    },

    selectEdge: (id) =>
      set((state) => ({
        doc: {
          ...state.doc,
          nodes: state.doc.nodes.map((n) => (n.selected ? { ...n, selected: false } : n)),
          edges: state.doc.edges.map((e) => (e.selected === (e.id === id) ? e : { ...e, selected: e.id === id })),
        },
        rightTab: 'inspector',
        rightOpen: true,
      })),

    toggleNodeHidden: (id) =>
      commit(
        (doc) => ({
          ...doc,
          nodes: doc.nodes.map((n) => (n.id === id ? { ...n, hidden: !n.hidden } : n)),
        }),
        { history: false },
      ),

    toggleEdgeHidden: (id) =>
      commit(
        (doc) => ({ ...doc, edges: doc.edges.map((e) => (e.id === id ? { ...e, hidden: !e.hidden } : e)) }),
        { history: false },
      ),

    toggleNodeLocked: (id) =>
      commit(
        (doc) => ({
          ...doc,
          nodes: doc.nodes.map((n) => {
            if (n.id !== id) return n
            const locked = !n.data.locked
            return { ...n, data: { ...n.data, locked }, draggable: !locked, deletable: !locked }
          }),
        }),
        { history: false },
      ),

    showAll: () =>
      commit(
        (doc) => ({
          ...doc,
          nodes: doc.nodes.map((n) => (n.hidden ? { ...n, hidden: false } : n)),
          edges: doc.edges.map((e) => (e.hidden ? { ...e, hidden: false } : e)),
        }),
        { history: false },
      ),

    showOnlySelected: () =>
      commit(
        (doc) => {
          const keep = new Set(doc.nodes.filter((n) => n.selected).map((n) => n.id))
          if (!keep.size) return doc
          return {
            ...doc,
            nodes: doc.nodes.map((n) => ({ ...n, hidden: !keep.has(n.id) })),
            edges: doc.edges.map((e) => ({ ...e, hidden: !(keep.has(e.source) && keep.has(e.target)) })),
          }
        },
        { history: false },
      ),

    changeZOrder: (id, mode) => {
      const { doc } = get()
      const node = doc.nodes.find((n) => n.id === id)
      if (!node) return
      const zs = doc.nodes.map((n) => n.zIndex ?? 0)
      const maxZ = Math.max(...zs, 0)
      const minZ = Math.min(...zs, 0)
      const cur = node.zIndex ?? 0
      const nextZ =
        mode === 'front' ? maxZ + 1 : mode === 'back' ? minZ - 1 : mode === 'forward' ? cur + 1 : cur - 1
      // 分组改层级时，组内节点一起平移，保持组内相对顺序
      const delta = nextZ - cur
      const groupId = node.data.isSubgraph ? node.id : null
      commit(
        (d) => ({
          ...d,
          nodes: d.nodes.map((n) => {
            if (n.id === id) return { ...n, zIndex: nextZ }
            if (groupId && n.data.groupId === groupId) return { ...n, zIndex: (n.zIndex ?? 0) + delta }
            return n
          }),
        }),
        { history: false },
      )
    },

    groupSelection: () => {
      const { doc, customBlocks } = get()
      const selected = doc.nodes.filter((n) => n.selected && !n.data.isSubgraph)
      if (selected.length < 1) {
        get().toast('先框选/选中要编组的节点', 'error')
        return
      }
      const groupBlock =
        allBlocks(customBlocks).find((b) => b.id === 'builtin.group') ?? allBlocks(customBlocks)[0]
      const pad = 36
      const minX = Math.min(...selected.map((n) => n.position.x)) - pad
      const minY = Math.min(...selected.map((n) => n.position.y)) - 54
      const maxX = Math.max(...selected.map((n) => n.position.x + n.data.width)) + pad
      const maxY = Math.max(...selected.map((n) => n.position.y + n.data.height)) + pad
      const group = nodeFromBlock(groupBlock, { x: minX, y: minY }, `分组 ${doc.nodes.filter((n) => n.data.isSubgraph).length + 1}`)
      group.data.width = maxX - minX
      group.data.height = maxY - minY
      group.style = { ...(group.style ?? {}), width: group.data.width, height: group.data.height }
      group.selected = false
      const ids = new Set(selected.map((n) => n.id))
      get().pushHistory()
      commit(
        (d) => ({
          ...d,
          nodes: [
            group,
            ...d.nodes.map((n) => (ids.has(n.id) ? { ...n, data: { ...n.data, groupId: group.id } } : n)),
          ],
        }),
        { history: false },
      )
      get().toast(`已把 ${selected.length} 个节点编成一个分组`, 'success')
    },

    addSelectionToGroup: (groupId) => {
      const { doc } = get()
      const ids = new Set(doc.nodes.filter((n) => n.selected && !n.data.isSubgraph && n.id !== groupId).map((n) => n.id))
      if (!ids.size) {
        get().toast('先选中要加入分组的节点', 'error')
        return
      }
      get().pushHistory()
      commit(
        (d) => ({
          ...d,
          // 套完分组要重排一次：分组必须垫在成员下面，否则会盖住刚加进去的节点
          nodes: orderTopDown(d.nodes.map((n) => (ids.has(n.id) ? { ...n, data: { ...n.data, groupId } } : n))),
        }),
        { history: false },
      )
      get().fitGroupToMembers(groupId)
      get().toast(`已把 ${ids.size} 个节点加入分组`, 'success')
    },

    removeSelectionFromGroup: () => {
      const { doc } = get()
      const ids = new Set(doc.nodes.filter((n) => n.selected && n.data.groupId).map((n) => n.id))
      if (!ids.size) return
      get().pushHistory()
      commit(
        (d) => ({
          ...d,
          nodes: d.nodes.map((n) => (ids.has(n.id) ? { ...n, data: { ...n.data, groupId: null } } : n)),
        }),
        { history: false },
      )
      get().toast(`已把 ${ids.size} 个节点移出分组`, 'success')
    },

    fitGroupToMembers: (groupId) => {
      const { doc } = get()
      const group = doc.nodes.find((n) => n.id === groupId)
      if (!group) return
      // 成员包含子分组（嵌套分组时父框要连子框一起包住）
      const members = doc.nodes.filter((n) => n.id !== groupId && n.data.groupId === groupId)
      if (!members.length) return
      const padX = 36
      const padTop = 54
      const padBottom = 30
      const minX = Math.min(...members.map((m) => m.position.x)) - padX
      const minY = Math.min(...members.map((m) => m.position.y)) - padTop
      const maxX = Math.max(...members.map((m) => m.position.x + m.data.width)) + padX
      const maxY = Math.max(...members.map((m) => m.position.y + m.data.height)) + padBottom
      const width = Math.max(180, maxX - minX)
      const height = Math.max(120, maxY - minY)
      commit(
        (d) => ({
          ...d,
          nodes: d.nodes.map((n) =>
            n.id === groupId
              ? { ...n, position: { x: minX, y: minY }, data: { ...n.data, width, height }, style: { ...(n.style ?? {}), width, height } }
              : n,
          ),
        }),
        { history: false },
      )
    },

    alignSelection: (mode) => {
      const { doc } = get()
      const nodes = doc.nodes.filter((n) => n.selected)
      if (nodes.length < 2) {
        get().toast('至少选中 2 个节点才能对齐', 'error')
        return
      }
      const minX = Math.min(...nodes.map((n) => n.position.x))
      const maxX = Math.max(...nodes.map((n) => n.position.x + n.data.width))
      const minY = Math.min(...nodes.map((n) => n.position.y))
      const maxY = Math.max(...nodes.map((n) => n.position.y + n.data.height))
      const ids = new Set(nodes.map((n) => n.id))
      get().pushHistory()
      commit(
        (d) => ({
          ...d,
          nodes: d.nodes.map((n) => {
            if (!ids.has(n.id)) return n
            const p = { ...n.position }
            if (mode === 'left') p.x = minX
            if (mode === 'right') p.x = maxX - n.data.width
            if (mode === 'top') p.y = minY
            if (mode === 'bottom') p.y = maxY - n.data.height
            if (mode === 'hcenter') p.x = Math.round((minX + maxX) / 2 - n.data.width / 2)
            if (mode === 'vcenter') p.y = Math.round((minY + maxY) / 2 - n.data.height / 2)
            return { ...n, position: p }
          }),
        }),
        { history: false },
      )
    },

    distributeSelection: (axis) => {
      const { doc } = get()
      const nodes = doc.nodes.filter((n) => n.selected)
      if (nodes.length < 3) {
        get().toast('至少选中 3 个节点才能等距分布', 'error')
        return
      }
      const ids = new Set(nodes.map((n) => n.id))
      const sorted = [...nodes].sort((a, b) =>
        axis === 'h' ? a.position.x - b.position.x : a.position.y - b.position.y,
      )
      const first = sorted[0]
      const last = sorted[sorted.length - 1]
      const start = axis === 'h' ? first.position.x : first.position.y
      const end =
        axis === 'h' ? last.position.x + last.data.width : last.position.y + last.data.height
      const totalSize = sorted.reduce((sum, n) => sum + (axis === 'h' ? n.data.width : n.data.height), 0)
      const gap = (end - start - totalSize) / (sorted.length - 1)
      const pos = new Map<string, number>()
      let cursor = start
      for (const n of sorted) {
        pos.set(n.id, Math.round(cursor))
        cursor += (axis === 'h' ? n.data.width : n.data.height) + gap
      }
      get().pushHistory()
      commit(
        (d) => ({
          ...d,
          nodes: d.nodes.map((n) => {
            if (!ids.has(n.id)) return n
            const value = pos.get(n.id) ?? 0
            const position =
              axis === 'h' ? { x: value, y: n.position.y } : { x: n.position.x, y: value }
            return { ...n, position }
          }),
        }),
        { history: false },
      )
    },

    // 切方向时连线要跟着翻面：TB 下出上入 → LR 右出左入 …
    setDirection: (d) => {
      const portsOf = portGetter(get().doc.nodes, get().blocks())
      commit((doc) => ({ ...doc, direction: d, edges: applyDefaultHandles(doc.edges, d, portsOf) }))
    },

    runAutoLayout: () => {
      get().pushHistory()
      const { doc } = get()
      let degraded = false
      const nodes = autoLayout(doc.nodes, doc.edges, { direction: doc.direction, onFallback: () => { degraded = true } })
      commit((d) => ({ ...d, nodes }), { history: false })
      get().toast(degraded ? '已重新排版（图形过密，已降级成顺序堆叠）' : '已重新排版', degraded ? 'info' : 'success')
    },

    placeGroupMembers: (entries) => {
      if (!entries.length) return
      const byId = new Map(entries.map((e) => [e.id, e]))
      set((state) => ({
        doc: {
          ...state.doc,
          nodes: state.doc.nodes.map((n) => {
            const p = byId.get(n.id)
            return p ? { ...n, position: { x: p.x, y: p.y } } : n
          }),
        },
        dirty: true,
        changedAt: Date.now(),
      }))
    },

    afterDragStop: () => {
      const { doc } = get()
      const nodes = orderTopDown(syncGroups(doc.nodes))
      const changed = nodes.some((n, i) => n !== doc.nodes[i])
      if (!changed) return
      commit((d) => ({ ...d, nodes }), { history: false })
    },

    /* ---------------- 历史 ---------------- */

    pushHistory: () =>
      set((state) => ({ past: [...state.past, snapshot(state.doc)].slice(-HISTORY_LIMIT), future: [] })),

    undo: () => {
      const { past, future, doc } = get()
      if (!past.length) return
      const prev = past[past.length - 1]
      set({
        past: past.slice(0, -1),
        future: [...future, snapshot(doc)].slice(-HISTORY_LIMIT),
        doc: { ...doc, nodes: prev.nodes, edges: prev.edges, direction: prev.direction, updatedAt: Date.now() },
        dirty: true,
        changedAt: Date.now(),
      })
      scheduleSave()
    },

    redo: () => {
      const { past, future, doc } = get()
      if (!future.length) return
      const next = future[future.length - 1]
      set({
        future: future.slice(0, -1),
        past: [...past, snapshot(doc)].slice(-HISTORY_LIMIT),
        doc: { ...doc, nodes: next.nodes, edges: next.edges, direction: next.direction, updatedAt: Date.now() },
        dirty: true,
        changedAt: Date.now(),
      })
      scheduleSave()
    },

    openSaveDialog: () => set({ saveDialogOpen: true }),
    closeSaveDialog: () => set({ saveDialogOpen: false }),

    refreshFileTarget: async () => {
      const docId = get().doc.id
      const target = await restorePersistedTarget(docId)
      // 读盘期间可能已经切到别的图了，别把旧图的目标按到新图上
      if (get().doc.id !== docId) return
      set({ fileTarget: target ? { ...target } : null })
    },

    forgetFile: async () => {
      await forgetSaveTarget(get().doc.id)
      set({ fileTarget: null })
      get().toast('已取消文件自动保存目标', 'info')
    },

    mdVersion: () => loadMdVersion(get().doc.id),

    grantFilePermission: async () => {
      const ok = await requestTargetPermission()
      const target = getSaveTarget()
      set({ fileTarget: target ? { ...target } : null })
      if (!ok) get().toast('未获得文件写入授权', 'error')
      return ok
    },

    saveToFile: async ({ format, name, mdOptions, chooseLocation }) => {
      // 先落一份到浏览器本地，双保险
      get().saveNow()
      const state = get()
      const blocks = allBlocks(state.customBlocks)
      const previous = format === 'md' && hasTargetHandle() ? await readSaveTarget() : null
      // 手动导出：版本号 +1（自动保存不动版本号）
      const version = bumpMdVersion(state.doc.id)
      const ctx = {
        doc: state.doc,
        blocks,
        code: toMermaid(state.doc, blocks, { includeStyles: state.settings.includeStyles }),
        projectJson: get().exportProjectJson(),
        name,
        dark: state.settings.theme === 'dark',
        mdOptions: mdOptions ?? DEFAULT_MD_OPTIONS,
        mdMeta: buildMdMeta(state.settings, version),
        previousMarkdown: previous,
      }
      const fileName = suggestedFileName(name, format)
      const meta = FORMAT_META[format]

      let payload: string | Blob
      try {
        payload = await buildExport(ctx, format)
      } catch (err) {
        get().toast(`生成 ${format.toUpperCase()} 失败：${(err as Error).message}`, 'error')
        return { ok: false, message: (err as Error).message }
      }

      if (chooseLocation && supportsFilePicker()) {
        const target = await chooseSaveTarget(fileName, format, meta.mime, meta.description, state.doc.id)
        if (!target) return { ok: false, message: '已取消选择保存位置', cancelled: true }
        set({ fileTarget: { ...target } })
        const written = await writeToSaveTarget(payload)
        const fresh = getSaveTarget()
        set({ fileTarget: fresh ? { ...fresh } : null })
        if (written) {
          get().toast(`已保存到 ${target.name}`, 'success')
          return { ok: true, message: `已保存到 ${target.name}` }
        }
        downloadBlob(fileName, payload instanceof Blob ? payload : new Blob([payload], { type: meta.mime }))
        get().toast('写入所选文件失败，已改为下载到浏览器下载目录', 'error')
        return { ok: true, message: '已改为下载' }
      }

      // 已有目标文件且授权过 → 直接写；否则退回下载
      const existing = getSaveTarget()
      if (!chooseLocation && existing && existing.permission === 'granted') {
        const written = await writeToSaveTarget(payload)
        const fresh = getSaveTarget()
        set({ fileTarget: fresh ? { ...fresh } : null })
        if (written) {
          get().toast(`已保存到 ${existing.name}`, 'success')
          return { ok: true, message: `已保存到 ${existing.name}` }
        }
      }

      downloadBlob(fileName, payload instanceof Blob ? payload : new Blob([payload], { type: meta.mime }))
      get().toast(
        supportsFilePicker() ? `已下载 ${fileName}` : `已下载 ${fileName}（当前浏览器不支持选择保存位置，文件在下载目录）`,
        'success',
      )
      return { ok: true, message: `已下载 ${fileName}` }
    },

    autoSaveToFile: async () => {
      const state = get()
      const target = getSaveTarget()
      // 默认就是自动保存；但只写「这张图自己的」文件，新建/换图后不会碰上一个文件
      if (!target || target.permission !== 'granted' || target.docId !== state.doc.id) return false
      if (state.changedAt <= (target.savedAt ?? 0)) return false
      const blocks = allBlocks(state.customBlocks)
      const previous = target.format === 'md' ? await readSaveTarget() : null
      const ctx = {
        doc: state.doc,
        blocks,
        code: toMermaid(state.doc, blocks, { includeStyles: state.settings.includeStyles }),
        projectJson: get().exportProjectJson(),
        name: state.doc.name,
        dark: state.settings.theme === 'dark',
        mdOptions: DEFAULT_MD_OPTIONS,
        mdMeta: buildMdMeta(state.settings, loadMdVersion(state.doc.id)),
        previousMarkdown: previous,
      }
      try {
        const payload = await buildExport(ctx, target.format)
        const ok = await writeToSaveTarget(payload)
        const fresh = getSaveTarget()
        set({ fileTarget: fresh ? { ...fresh } : null })
        if (!ok) get().toast('自动保存到文件失败，请重新选择保存位置', 'error')
        return ok
      } catch (err) {
        console.warn('[mermaid-studio] 自动保存失败', err)
        return false
      }
    },

    /* --- 文档 --- */

    newDoc: () => {
      const blank: DiagramDoc = {
        id: uid('doc'),
        name: '未命名图表',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        direction: 'TB',
        nodes: [],
        edges: [],
      }
      const nextIndex = persistDoc(blank, get().index)
      get().resetTimeline()
      // 新图不沿用上一张图的文件：清掉内存句柄，等用户选新文件（磁盘上旧图的记录还在）
      clearCurrentTarget()
      set({ doc: blank, index: nextIndex, past: [], future: [], dirty: false, savedAt: Date.now(), fileTarget: null })
      get().toast('已新建空白图表', 'success')
    },

    loadSample: () => {
      const sample = withDefaultHandles(createStarterDoc(), allBlocks(get().customBlocks))
      const nextIndex = persistDoc(sample, get().index)
      get().resetTimeline()
      clearCurrentTarget()
      set({ doc: sample, index: nextIndex, past: [], future: [], dirty: false, savedAt: Date.now(), fileTarget: null })
    },

    openDoc: (id) => {
      const loaded = loadDoc(id)
      if (!loaded) {
        get().toast('找不到该图表', 'error')
        return
      }
      // 老文档补默认端口（上回画布上的连线可能是上下颠倒的）
      const doc = withDefaultHandles(loaded, allBlocks(get().customBlocks))
      get().resetTimeline()
      clearCurrentTarget()
      set({ doc, index: { ...get().index, active: id }, past: [], future: [], dirty: false, fileTarget: null })
      // 每张图记着自己的保存文件，切过去就恢复它
      void get().refreshFileTarget()
    },

    renameDoc: (name) => {
      commit((doc) => ({ ...doc, name }), { history: false })
      const { doc, index } = get()
      const nextIndex = persistDoc({ ...doc, name }, index)
      set({ index: nextIndex })
    },

    renameDocById: (id, name) => {
      const { index, doc } = get()
      const stored = id === doc.id ? null : loadDoc(id)
      if (stored) persistDoc({ ...stored, name, updatedAt: Date.now() }, index)
      else if (id === doc.id) persistDoc({ ...doc, name, updatedAt: Date.now() }, index)
      const metas = index.metas[id]
        ? { ...index.metas, [id]: { ...index.metas[id], name, updatedAt: Date.now() } }
        : index.metas
      set({
        index: { ...index, metas },
        doc: doc.id === id ? { ...doc, name } : doc,
      })
    },

    deleteDoc: (id) => {
      const { index, doc } = get()
      const nextIndex = removeDoc(id, index)
      const remaining = nextIndex.order[0]
      void forgetSaveTarget(id)
      if (doc.id === id) {
        const nextDoc = remaining ? loadDoc(remaining) : null
        clearCurrentTarget()
        set({ index: nextIndex, doc: nextDoc ?? createStarterDoc(), past: [], future: [], fileTarget: null })
        void get().refreshFileTarget()
      } else {
        set({ index: nextIndex })
      }
      get().toast('已删除图表', 'success')
    },

    duplicateDoc: () => {
      const { doc, index } = get()
      const copy: DiagramDoc = {
        ...doc,
        id: uid('doc'),
        name: `${doc.name} 副本`,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        nodes: doc.nodes.map((n) => ({ ...n, data: { ...n.data, values: { ...n.data.values } } })),
        edges: doc.edges.map((e) => ({ ...e, data: { ...DEFAULT_EDGE_DATA, ...e.data } })),
      }
      const nextIndex = persistDoc(copy, index)
      clearCurrentTarget()
      set({ doc: copy, index: nextIndex, dirty: false, savedAt: Date.now(), fileTarget: null })
      get().toast('已复制图表', 'success')
    },

    saveNow: () => {
      if (saveTimer) clearTimeout(saveTimer)
      const { doc, index } = get()
      const stamped = { ...doc, updatedAt: Date.now() }
      const nextIndex = persistDoc(stamped, index)
      set({ doc: stamped, index: nextIndex, dirty: false, savedAt: Date.now() })
      get().toast('已保存到本地', 'success')
    },

    /* ---------------- 导入导出 ---------------- */

    exportAllData: () => {
      const { index, customBlocks, settings } = get()
      const documents = index.order
        .map((id) => loadDoc(id))
        .filter((d): d is DiagramDoc => Boolean(d))
      const backup = buildBackup(documents, customBlocks, {
        theme: settings.theme,
        includeStyles: settings.includeStyles,
        mdAuthor: settings.mdAuthor,
        mdConvention: settings.mdConvention,
      })
      return JSON.stringify(backup, null, 2)
    },

    importAllData: (text) => {
      const backup = parseBackup(text)
      let index = get().index
      let docs = 0
      for (const doc of backup.documents) {
        // id 撞了就当成一份新图表导入，不覆盖原有数据
        const exists = index.order.includes(doc.id)
        const next: DiagramDoc = exists
          ? { ...doc, id: uid('doc'), name: `${doc.name}（导入）`, createdAt: Date.now(), updatedAt: Date.now() }
          : doc
        index = persistDoc(next, index)
        docs++
      }
      const mergedBlocks = [...get().customBlocks]
      let blocks = 0
      for (const b of backup.customBlocks) {
        if (!b?.id || mergedBlocks.some((x) => x.id === b.id)) continue
        mergedBlocks.push({ ...b, builtin: false })
        blocks++
      }
      persistCustomBlocks(mergedBlocks)
      set({ index, customBlocks: mergedBlocks })
      if (backup.settings) {
        const patch: Partial<Settings> = {}
        if (typeof backup.settings.theme === 'string') patch.theme = backup.settings.theme as Settings['theme']
        if (typeof backup.settings.mdAuthor === 'string') patch.mdAuthor = backup.settings.mdAuthor
        if (typeof backup.settings.mdConvention === 'string') patch.mdConvention = backup.settings.mdConvention
        if (Object.keys(patch).length) get().updateSettings(patch)
      }
      get().toast(`已导入 ${docs} 份图表、${blocks} 个自定义节点块`, 'success')
      return { docs, blocks }
    },

    exportProjectJson: () => {
      const { doc, customBlocks } = get()
      const payload: ProjectFile = {
        kind: 'mermaid-studio-project',
        version: 1,
        exportedAt: Date.now(),
        doc,
        customBlocks,
      }
      return JSON.stringify(payload, null, 2)
    },

    importProjectJson: (text) => {
      try {
        const parsed = JSON.parse(text) as ProjectFile | DiagramDoc
        const isProject = (parsed as ProjectFile).kind === 'mermaid-studio-project'
        const incoming: DiagramDoc = isProject ? (parsed as ProjectFile).doc : (parsed as DiagramDoc)
        if (!incoming || !Array.isArray(incoming.nodes) || !Array.isArray(incoming.edges)) {
          throw new Error('文件结构不正确')
        }
        let customBlocks = get().customBlocks
        if (isProject && Array.isArray((parsed as ProjectFile).customBlocks)) {
          const merged = [...customBlocks]
          for (const b of (parsed as ProjectFile).customBlocks) {
            if (!merged.some((x) => x.id === b.id)) merged.push(b)
          }
          customBlocks = merged
          persistCustomBlocks(merged)
        }
        const doc: DiagramDoc = withDefaultHandles(
          normalizeDoc({ ...incoming, id: uid('doc'), updatedAt: Date.now() }),
          allBlocks(customBlocks),
        )
        const nextIndex = persistDoc(doc, get().index)
        clearCurrentTarget()
        set({ doc, customBlocks, index: nextIndex, past: [], future: [], dirty: false, savedAt: Date.now(), fileTarget: null })
        get().toast('已导入工程文件', 'success')
      } catch (err) {
        get().toast(`导入失败：${(err as Error).message}`, 'error')
      }
    },

    currentMermaid: (includeStyles) =>
      toMermaid(get().doc, allBlocks(get().customBlocks), {
        includeStyles: includeStyles ?? get().settings.includeStyles,
      }),

    importMermaid: (code) => {
      try {
        const blocks = allBlocks(get().customBlocks)
        const parsed = parseMermaid(code)
        if (!parsed.nodes.length) return { ok: false, message: '没有解析到任何节点，请检查 Mermaid 语法' }

        const nodes: FlowNode[] = []
        const idMap = new Map<string, string>()
        for (const pn of parsed.nodes) {
          // 1) 语义类（:::role）2) classDef 名 blk_<块id> 3) 颜色 4) 形状
          // 同一语义类可能有多个块（job = 文档 + 定时任务，mq = 开始/结束 + MQ），优先挑形状一致的
          const byClass = pn.className
            ? (blocks.find((b) => b.className === pn.className && b.shape === pn.shape) ??
              blocks.find((b) => b.className === pn.className))
            : undefined
          const byId = pn.className?.startsWith('blk_')
            ? blocks.find((b) => `blk_${toMermaidId(b.id)}` === pn.className)
            : undefined
          const custom = blockForStyle(pn.style, blocks)
          const block = byClass ?? byId ?? custom ?? blockForShape(pn.shape, blocks)
          const isGroup = block.kind === 'subgraph' || pn.shape === 'group'
          const taken = new Set([...idMap.values()])
          const node = nodeFromBlock(block, { x: 0, y: 0 }, pn.label, taken)
          // Mermaid 里的节点 id 就是语义化命名的，能沿用就沿用，保证往返稳定
          const safeId = sanitizeNodeId(pn.id)
          if (safeId && !taken.has(safeId)) node.id = safeId
          // 有标签模板的块（数据表 / Redis / API 等）：把多行标签还原成字段
          const restored = fillFieldsFromLabel(pn.label, block)
          if (restored) {
            node.data.label = restored.label
            node.data.values = { ...node.data.values, ...restored.values }
            node.data.height = structuralNodeHeight(block, node.data.values)
            node.style = { ...(node.style ?? {}), width: node.data.width, height: node.data.height }
          }
          node.data.isSubgraph = isGroup
          // 导入时按文字实际宽度撑开节点：长中文标题默认 200 宽会被省略号吃掉
          if (!isGroup) {
            const width = fitNodeWidth(block, node.data)
            if (width !== node.data.width) {
              node.data.width = width
              node.style = { ...(node.style ?? {}), width, height: node.data.height }
            }
          }
          if (pn.style?.fill) node.data.fill = pn.style.fill === 'none' ? 'transparent' : pn.style.fill
          if (pn.style?.stroke) node.data.stroke = pn.style.stroke === 'none' ? 'transparent' : pn.style.stroke
          if (pn.style?.color) node.data.textColor = pn.style.color
          if (isGroup) node.data.values = { ...node.data.values, id: pn.id }
          if (pn.className) node.data.values = { ...node.data.values, _class: pn.className }
          nodes.push(node)
          idMap.set(pn.id, node.id)
        }
        // 分组归属
        const byMermaidId = new Map(parsed.nodes.map((n) => [n.id, n]))
        for (const n of nodes) {
          const mid = [...idMap.entries()].find(([, v]) => v === n.id)?.[0]
          const src = mid ? byMermaidId.get(mid) : undefined
          if (src?.subgraphId && idMap.has(src.subgraphId)) {
            n.data.groupId = idMap.get(src.subgraphId)!
          }
        }

        // Mermaid 本身不描述端口，导入时按骨架方向补：TB 下出上入、LR 右出左入。
        // 之后用户拖端点 / 在检查器里改端口，都会把这条边标成 manual，不再被覆盖。
        const portsOf = portGetter(nodes, blocks)
        const edges: FlowEdge[] = parsed.edges
          .filter((e) => idMap.has(e.source) && idMap.has(e.target))
          .map((e) => {
            const data: EdgeData = {
              ...DEFAULT_EDGE_DATA,
              label: e.label ?? '',
              type: e.type ?? '',
              note: e.note ?? '',
              lineStyle: e.lineStyle,
              startMarker: e.startMarker,
              endMarker: e.endMarker,
              handleMode: 'auto',
            }
            if (e.style?.stroke) data.stroke = e.style.stroke
            if (e.style?.['stroke-width']) data.strokeWidth = parseFloat(e.style['stroke-width']) || 2
            return {
              id: uid('e'),
              source: idMap.get(e.source)!,
              target: idMap.get(e.target)!,
              type: CURVE_TO_RF[data.curve],
              data,
              label: data.label || undefined,
            }
          })
          .map((edge) => forceDefaultHandles(edge, parsed.direction, portsOf))

        let degraded = false
        const laidOut = autoLayout(nodes, edges, { direction: parsed.direction, onFallback: () => { degraded = true } })
        get().pushHistory()
        commit((d) => ({ ...d, nodes: laidOut, edges, direction: parsed.direction }), { history: false })
        const warn = parsed.warnings.length ? `，${parsed.warnings.length} 行被忽略` : ''
        const degradeHint = degraded ? '；图形过密，排版已降级' : ''
        get().toast(
          `已导入 ${nodes.length} 个节点 / ${edges.length} 条连线${warn}${degradeHint}`,
          parsed.warnings.length || degraded ? 'info' : 'success',
        )
        return { ok: true, message: '导入成功' }
      } catch (err) {
        get().toast(`Mermaid 解析失败：${(err as Error).message}`, 'error')
        return { ok: false, message: (err as Error).message }
      }
    },

    /* ---------------- 剧本（时间轴演示） ---------------- */

    importScenario: (raw) => {
      const state = get()
      const { timeline, report } = parseScenario(state.doc, tableNodesOf(state.doc, state.blocks()), raw)
      if (!timeline) {
        get().toast(`剧本导入失败：${report.error}`, 'error')
        return report
      }
      commit((doc) => ({ ...doc, timeline }), { history: true })
      set({ player: { playing: false, speed: 1, cursorMs: 0, hasRun: false, values: {}, changed: {}, blink: {} }, timelineOpen: true })
      const miss = report.unmatchedTables.length ? `，${report.unmatchedTables.length} 张表未匹配` : ''
      get().toast(`已导入 ${report.eventCount} 个事件 / ${report.changeCount} 条变更${miss}`, miss ? 'info' : 'success')
      return report
    },

    bindScenarioTable: (table, nodeId) => {
      const tl = get().doc.timeline
      if (!tl) return
      commit((doc) => ({ ...doc, timeline: doc.timeline ? bindTable(doc.timeline, table, nodeId) : doc.timeline }), { history: true })
      get().resetTimeline()
      get().toast(`已把表「${table}」绑定到节点`, 'success')
    },

    toggleCoreTable: (nodeId) => {
      const tl = get().doc.timeline
      if (!tl) return
      const has = tl.coreTables.includes(nodeId)
      const coreTables = has ? tl.coreTables.filter((id) => id !== nodeId) : [...tl.coreTables, nodeId]
      commit((doc) => ({ ...doc, timeline: doc.timeline ? { ...doc.timeline, coreTables } : doc.timeline }), { history: true })
      get().resetTimeline()
    },

    removeScenarioEvent: (eventId) => {
      const tl = get().doc.timeline
      if (!tl) return
      const removedEventIds = tl.removedEventIds.includes(eventId) ? tl.removedEventIds : [...tl.removedEventIds, eventId]
      commit((doc) => ({ ...doc, timeline: doc.timeline ? { ...doc.timeline, removedEventIds } : doc.timeline }), { history: true })
      get().resetTimeline()
      get().toast('已删除该事件（导出时不再包含）', 'success')
    },

    restoreScenarioEvent: (eventId) => {
      const tl = get().doc.timeline
      if (!tl) return
      const removedEventIds = tl.removedEventIds.filter((id) => id !== eventId)
      commit((doc) => ({ ...doc, timeline: doc.timeline ? { ...doc.timeline, removedEventIds } : doc.timeline }), { history: true })
      get().resetTimeline()
    },

    scenarioJson: () => {
      const tl = get().doc.timeline
      return tl ? scenarioExportJson(tl, get().doc) : ''
    },

    scenarioUsage: () => {
      const tl = get().doc.timeline
      return tl ? tableUsage(tl) : []
    },

    playTimeline: () => {
      const tl = get().doc.timeline
      if (!tl) {
        get().toast('还没有剧本，先导入剧本 JSON', 'info')
        return
      }
      if (get().player.playing) return
      const restart = get().player.cursorMs >= tl.totalMs
      lastTick = 0
      set({ player: { ...get().player, playing: true, cursorMs: restart ? 0 : get().player.cursorMs, values: restart ? {} : get().player.values } })
      rafId = requestAnimationFrame(() => get().tickTimeline())
    },

    pauseTimeline: () => {
      if (rafId) cancelAnimationFrame(rafId)
      rafId = 0
      lastTick = 0
      set({ player: { ...get().player, playing: false } })
    },

    replayTimeline: () => {
      get().pauseTimeline()
      set({ player: { ...get().player, cursorMs: 0, values: {}, changed: {}, blink: {}, hasRun: false } })
      get().playTimeline()
    },

    seekTimeline: (ms) => {
      const tl = get().doc.timeline
      if (!tl) return
      const cursorMs = Math.max(0, Math.min(tl.totalMs, Math.round(ms)))
      lastTick = 0
      set({
        player: { ...get().player, cursorMs, hasRun: cursorMs > 0, values: overlayAt(get().doc, cursorMs), changed: {}, blink: {} },
      })
    },

    setPlaybackSpeed: (speed) => set({ player: { ...get().player, speed: Math.max(0.25, Math.min(4, speed)) } }),

    resetTimeline: () => {
      if (rafId) cancelAnimationFrame(rafId)
      rafId = 0
      lastTick = 0
      set({ player: { playing: false, speed: get().player.speed, cursorMs: 0, hasRun: false, values: {}, changed: {}, blink: {} } })
    },

    tickTimeline: () => {
      const state = get()
      const tl = state.doc.timeline
      if (!tl || !state.player.playing) return
      const now = performance.now()
      const dt = lastTick ? Math.min(64, now - lastTick) : 16
      lastTick = now
      const prev = state.player.cursorMs
      const next = Math.min(tl.totalMs, prev + dt * state.player.speed)
      const removed = new Set(tl.removedEventIds)
      // 从 0 开始播放时，起点在 0ms 的事件也要触发
      const fired = tl.events.filter((e) => !removed.has(e.id) && (e.startMs > prev || (prev === 0 && e.startMs === 0)) && e.startMs <= next)
      const values = overlayAt(state.doc, next)
      // 闪烁 / 渐隐标记跨帧保留 900ms（否则下一帧就被空集合覆盖）
      const ts = Date.now()
      const changed: Record<string, Record<string, number>> = {}
      for (const [nodeId, fields] of Object.entries(state.player.changed)) {
        for (const [field, t] of Object.entries(fields)) {
          if (ts - t < 900) {
            changed[nodeId] ??= {}
            changed[nodeId][field] = t
          }
        }
      }
      const blink: Record<string, number> = {}
      for (const [edgeId, t] of Object.entries(state.player.blink)) {
        if (ts - t < 900) blink[edgeId] = t
      }
      for (const ev of fired) {
        for (const c of ev.changes) {
          if (!c.nodeId) continue
          changed[c.nodeId] ??= {}
          changed[c.nodeId][c.field] = ts
        }
        for (const eid of edgesTouching(state.doc, ev.nodeIds)) blink[eid] = ts
      }
      set({ player: { ...state.player, cursorMs: next, hasRun: true, values, changed, blink } })
      if (Object.keys(blink).length) {
        setTimeout(() => {
          const p = get().player
          const left = Object.fromEntries(Object.entries(p.blink).filter(([, t]) => Date.now() - t < 900))
          if (Object.keys(left).length !== Object.keys(p.blink).length) set({ player: { ...get().player, blink: left } })
        }, 950)
      }
      if (next >= tl.totalMs) {
        set({ player: { ...get().player, playing: false } })
        lastTick = 0
        rafId = 0
        return
      }
      rafId = requestAnimationFrame(() => get().tickTimeline())
    },

    setTimelineOpen: (open) => set({ timelineOpen: open }),

    setMermaidDraft: (v) => set({ mermaidDraft: v }),

    /* ---------------- 自定义块 ---------------- */

    openBlockEditor: (blockId) => {
      const blocks = allBlocks(get().customBlocks)
      if (blockId) {
        const base = blocks.find((b) => b.id === blockId)
        if (base) {
          set({ blockEditor: { open: true, draft: cloneBlockAsCustom(base, base.builtin ? '副本' : '') } })
          return
        }
      }
      set({ blockEditor: { open: true, draft: blankBlock() } })
    },

    closeBlockEditor: () => set({ blockEditor: { open: false, draft: null } }),

    updateDraft: (patch) => {
      const draft = get().blockEditor.draft
      if (!draft) return
      set({ blockEditor: { open: true, draft: { ...draft, ...patch } } })
    },

    saveDraft: () => {
      const draft = get().blockEditor.draft
      if (!draft) return
      if (!draft.name.trim()) {
        get().toast('请填写节点块名称', 'error')
        return
      }
      const stamped = { ...draft, id: draft.id || uid('blk'), builtin: false, updatedAt: Date.now() }
      const exists = get().customBlocks.some((b) => b.id === stamped.id)
      const customBlocks = exists
        ? get().customBlocks.map((b) => (b.id === stamped.id ? stamped : b))
        : [...get().customBlocks, stamped]
      persistCustomBlocks(customBlocks)
      set({ customBlocks, blockEditor: { open: false, draft: null } })
      get().toast(exists ? '节点块已更新' : '节点块已创建', 'success')
    },

    deleteBlock: (id) => {
      const customBlocks = get().customBlocks.filter((b) => b.id !== id)
      persistCustomBlocks(customBlocks)
      const fallbackId = BUILTIN_BLOCKS[0].id
      commit(
        (doc) => ({
          ...doc,
          nodes: doc.nodes.map((n) =>
            n.data.blockId === id
              ? {
                  ...n,
                  data: {
                    ...n.data,
                    blockId: fallbackId,
                    fill: BUILTIN_BLOCKS[0].fill,
                    stroke: BUILTIN_BLOCKS[0].stroke,
                    textColor: BUILTIN_BLOCKS[0].textColor,
                    shape: BUILTIN_BLOCKS[0].shape,
                  },
                }
              : n,
          ),
        }),
        { history: false },
      )
      set({ customBlocks })
      get().toast('节点块已删除，相关节点已回退到默认块', 'success')
    },

    duplicateBlock: (id) => {
      const blocks = allBlocks(get().customBlocks)
      const base = blocks.find((b) => b.id === id)
      if (!base) return
      const copy = cloneBlockAsCustom(base, '副本')
      const customBlocks = [...get().customBlocks, copy]
      persistCustomBlocks(customBlocks)
      set({ customBlocks, blockEditor: { open: true, draft: copy } })
    },

    resetCustomBlocks: () => {
      persistCustomBlocks([])
      set({ customBlocks: [] })
      get().toast('已清空自定义节点块', 'success')
    },

    importBlocks: (blocks) => {
      const merged = [...get().customBlocks]
      let added = 0
      for (const b of blocks) {
        if (!b?.id || !b?.name) continue
        if (merged.some((x) => x.id === b.id)) continue
        merged.push({ ...b, builtin: false })
        added++
      }
      persistCustomBlocks(merged)
      set({ customBlocks: merged })
      get().toast(added ? `已导入 ${added} 个节点块` : '没有新的节点块', added ? 'success' : 'info')
    },

    /* ---------------- UI ---------------- */

    setTheme: (t) => {
      const settings = { ...get().settings, theme: t }
      persistSettings(settings)
      set({ settings })
    },

    toggleTheme: () => get().setTheme(get().settings.theme === 'dark' ? 'light' : 'dark'),

    setRightTab: (t) => set({ rightTab: t, rightOpen: true }),

    toggleRight: () => set((s) => ({ rightOpen: !s.rightOpen })),

    togglePalette: () => set((s) => ({ paletteOpen: !s.paletteOpen })),

    updateSettings: (patch) => {
      const settings = { ...get().settings, ...patch }
      persistSettings(settings)
      set({ settings })
    },

    toast: (message, kind = 'info') => {
      const id = uid('t')
      set((s) => ({ toasts: [...s.toasts, { id, message, kind }] }))
      setTimeout(() => get().dismissToast(id), 3200)
    },

    dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  }
})

/* ---------------- 便捷选择器 ---------------- */

export function useAllBlocks(): BlockDef[] {
  const custom = useStore((s) => s.customBlocks)
  return [...BUILTIN_BLOCKS, ...custom]
}

export function useSelectedNode(): FlowNode | null {
  const doc = useStore((s) => s.doc)
  return doc.nodes.find((n) => n.selected) ?? null
}

export function useSelectedEdge(): FlowEdge | null {
  const doc = useStore((s) => s.doc)
  return doc.edges.find((e) => e.selected) ?? null
}

export { allBlocks, findBlock, composeLabel, storageBytes }
