import { useMemo, useState } from 'react'
import { useStore } from '../store'
import { allBlocks, composeLabel } from '../blocks/registry'
import { SHAPE_LABELS, type FlowEdge, type FlowNode } from '../types'
import { isEdgeLabelConforming } from '../lib/edgeLabels'

type Row = { kind: 'node'; node: FlowNode; depth: number } | { kind: 'edge'; edge: FlowEdge; depth: number }

/**
 * 图层面板：像 Figma 一样列出画布上的所有元素。
 * 分组会带上自己的子节点；点击定位、眼睛隐藏、锁锁定、↕ 调层级。
 */
export function LayersPanel() {
  const doc = useStore((s) => s.doc)
  const customBlocks = useStore((s) => s.customBlocks)
  const selectOnly = useStore((s) => s.selectOnly)
  const toggleNodeHidden = useStore((s) => s.toggleNodeHidden)
  const toggleEdgeHidden = useStore((s) => s.toggleEdgeHidden)
  const selectEdge = useStore((s) => s.selectEdge)
  const toggleNodeLocked = useStore((s) => s.toggleNodeLocked)
  const changeZOrder = useStore((s) => s.changeZOrder)
  const showAll = useStore((s) => s.showAll)
  const deleteSelection = useStore((s) => s.deleteSelection)
  const [query, setQuery] = useState('')
  const [showEdges, setShowEdges] = useState(true)

  const blocks = useMemo(() => allBlocks(customBlocks), [customBlocks])

  const rows = useMemo<Row[]>(() => {
    const q = query.trim().toLowerCase()
    const nodes = doc.nodes
    const groups = nodes.filter((n) => n.data.isSubgraph)
    const loose = nodes.filter((n) => !n.data.isSubgraph && !n.data.groupId)
    const out: Row[] = []
    const push = (n: FlowNode, depth: number) => {
      const text = `${n.data.label} ${n.data.blockId}`.toLowerCase()
      if (q && !text.includes(q)) return
      out.push({ kind: 'node', node: n, depth })
    }
    for (const g of groups) {
      push(g, 0)
      for (const c of nodes.filter((n) => n.data.groupId === g.id)) push(c, 1)
    }
    for (const n of loose) push(n, 0)
    if (showEdges) {
      for (const e of doc.edges) {
        const label = `${e.data?.label ?? ''}`.toLowerCase()
        const src = nodes.find((n) => n.id === e.source)?.data.label ?? ''
        const dst = nodes.find((n) => n.id === e.target)?.data.label ?? ''
        if (q && !`${label} ${src} ${dst}`.toLowerCase().includes(q)) continue
        out.push({ kind: 'edge', edge: e, depth: 0 })
      }
    }
    return out
  }, [doc.nodes, doc.edges, query, showEdges])

  const hiddenTotal = doc.nodes.filter((n) => n.hidden).length + doc.edges.filter((e) => e.hidden).length

  return (
    <div className="ms-panel-body ms-panel-body--layers">
      <div className="ms-section-title">
        图层
        <span className="ms-section-title__count">{doc.nodes.length + doc.edges.length}</span>
        <span className="ms-section-title__actions">
          <button className="ms-mini" onClick={showAll} disabled={!hiddenTotal}>
            全部显示
          </button>
        </span>
      </div>

      <input
        className="ms-input ms-input--search ms-input--searchInline"
        placeholder="搜索元素…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      <label className="ms-switch">
        <input type="checkbox" checked={showEdges} onChange={(e) => setShowEdges(e.target.checked)} />
        显示连线
      </label>

      <div className="ms-layerlist">
        {rows.length === 0 ? <div className="ms-muted">没有匹配的元素</div> : null}
        {rows.map((row) => {
          if (row.kind === 'edge') {
            const e = row.edge
            const src = doc.nodes.find((n) => n.id === e.source)?.data.label ?? '?'
            const dst = doc.nodes.find((n) => n.id === e.target)?.data.label ?? '?'
            return (
              <div
                key={e.id}
                className={`ms-layerrow${e.selected ? ' is-active' : ''}${e.hidden ? ' is-hidden' : ''}`}
                onClick={() => selectEdge(e.id)}
                title="选中这条连线（可在检查器里改样式）"
              >
                <span className="ms-layerrow__icon">{isEdgeLabelConforming(e.data?.label) ? '→' : '⚠'}</span>
                <span className="ms-layerrow__name">
                  连线 {src} → {dst}
                  {e.data?.label ? ` · ${e.data.label}` : ' · （无标签）'}
                </span>
                <button
                  className="ms-icon-btn"
                  title={e.hidden ? '显示' : '隐藏'}
                  onClick={(ev) => {
                    ev.stopPropagation()
                    toggleEdgeHidden(e.id)
                  }}
                >
                  {e.hidden ? '🚫' : '👁'}
                </button>
              </div>
            )
          }
          const n = row.node
          const block = blocks.find((b) => b.id === n.data.blockId)
          const isGroup = Boolean(n.data.isSubgraph)
          return (
            <div
              key={n.id}
              className={`ms-layerrow${n.selected ? ' is-active' : ''}${n.hidden ? ' is-hidden' : ''}${isGroup ? ' is-group' : ''}`}
              style={{ paddingLeft: 8 + row.depth * 14 }}
              onClick={(ev) => selectOnly([n.id], ev.metaKey || ev.ctrlKey)}
              onDoubleClick={() => selectOnly([n.id], true)}
              title={`${block?.name ?? n.data.blockId} · ${SHAPE_LABELS[n.data.shape]} · 双击定位`}
            >
              <span className="ms-layerrow__icon">{isGroup ? '🗂️' : block?.icon || '▢'}</span>
              <span className="ms-layerrow__name">{n.data.label || composeLabel(n.data, block) || '(未命名)'}</span>
              <span className="ms-layerrow__meta">{n.data.locked ? '🔒' : ''}</span>
              <button
                className="ms-icon-btn"
                title="上移一层"
                onClick={(ev) => {
                  ev.stopPropagation()
                  changeZOrder(n.id, 'forward')
                }}
              >
                ↑
              </button>
              <button
                className="ms-icon-btn"
                title="下移一层"
                onClick={(ev) => {
                  ev.stopPropagation()
                  changeZOrder(n.id, 'backward')
                }}
              >
                ↓
              </button>
              <button
                className="ms-icon-btn"
                title={n.data.locked ? '解锁' : '锁定'}
                onClick={(ev) => {
                  ev.stopPropagation()
                  toggleNodeLocked(n.id)
                }}
              >
                {n.data.locked ? '🔒' : '🔓'}
              </button>
              <button
                className="ms-icon-btn"
                title={n.hidden ? '显示' : '隐藏'}
                onClick={(ev) => {
                  ev.stopPropagation()
                  toggleNodeHidden(n.id)
                }}
              >
                {n.hidden ? '🚫' : '👁'}
              </button>
              <button
                className="ms-icon-btn ms-icon-btn--danger"
                title="删除"
                onClick={(ev) => {
                  ev.stopPropagation()
                  selectOnly([n.id])
                  deleteSelection()
                }}
              >
                ✕
              </button>
            </div>
          )
        })}
      </div>

      <div className="ms-hint">
        单击 = 选中（⌘/Ctrl 点击 = 定位并缩放），双击 = 缩放定位；↑↓ 调整图层前后顺序。
      </div>
    </div>
  )
}
