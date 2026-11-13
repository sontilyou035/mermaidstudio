import { memo, useEffect, useMemo, useRef, useState } from 'react'
import {
  Handle,
  NodeResizeControl,
  Position,
  useInternalNode,
  useUpdateNodeInternals,
  type ControlPosition,
  type NodeProps,
} from '@xyflow/react'
import type { FlowNode, PortPosition } from '../types'
import { ShapeFrame } from '../lib/shapes'
import { RichText, stripRichText } from './RichText'
import { useStore } from '../store'
import { allBlocks, composeLabel, findBlock, labelLines, tableRows } from '../blocks/registry'

const POSITION_MAP: Record<PortPosition, Position> = {
  top: Position.Top,
  right: Position.Right,
  bottom: Position.Bottom,
  left: Position.Left,
}

function BlockNodeInner({ id, data, selected }: NodeProps<FlowNode>) {
  const customBlocks = useStore((s) => s.customBlocks)
  const updateNodeData = useStore((s) => s.updateNodeData)
  const pushHistory = useStore((s) => s.pushHistory)
  const setNodeSize = useStore((s) => s.setNodeSize)
  const updateNodeInternals = useUpdateNodeInternals()
  const setNodeField = useStore((s) => s.setNodeField)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(data.label)
  // 剧本回放：播放中锁定编辑；表节点在回放期间显示值覆盖层
  const playing = useStore((s) => s.player.playing)
  const overlayOn = useStore((s) => s.player.hasRun || s.player.playing)
  const playerValues = useStore((s) => s.player.values[id])
  const playerChanged = useStore((s) => s.player.changed[id])
  const [editingRows, setEditingRows] = useState(false)
  const [rowsDraft, setRowsDraft] = useState('')
  const [editingJson, setEditingJson] = useState(false)
  const [jsonDraft, setJsonDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) {
      setDraft(data.label)
      requestAnimationFrame(() => {
        const el = inputRef.current
        if (!el) return
        el.focus()
        const end = el.value.length
        el.setSelectionRange(end, end)
      })
    }
  }, [editing, data.label])


  const blocks = allBlocks(customBlocks)
  const block0 = blocks.find((b) => b.id === data.blockId)
  const block = block0 ?? findBlock(blocks, 'builtin.process')
  const isGroup = Boolean(data.isSubgraph)
  const isTable = block.layout === 'table'
  const isJson = block.layout === 'json'
  // 卡片是默认外观：表格 / JSON / 分组 / 纯文本 之外的所有节点都走卡片
  const isCard =
    block.layout === 'card' ||
    (!isTable && !isJson && !isGroup && data.shape !== 'text')
  // 用 React Flow 内部记录的真实尺寸渲染，保证 NodeResizer 缩放时图形跟手
  const internal = useInternalNode(id)
  const width = Math.round(internal?.measured?.width ?? data.width)
  const height = Math.round(internal?.measured?.height ?? data.height)
  const text = composeLabel(data, block)
  const lines = labelLines(text)
  const showFields = !isTable && !block.labelTemplate?.trim() && block.fields.length > 0
  const rows = isTable ? tableRows(data.values?.columns) : []
  const jsonText = isJson ? String(data.values?.json ?? '').trim() : ''
  const jsonLines = jsonText ? jsonText.split('\n') : []
  const jsonKey = isJson ? String(data.values?.key ?? '').trim() : ''
  const pk = (data.values?.pk ?? '').trim().toLowerCase()

  // 选中连线后，把它两端的节点「点亮」：连接头常显，线实际用到的那个口高亮
  const edges = useStore((s) => s.doc.edges)
  const pinnedPorts = useMemo(() => {
    const used = new Map<string, Set<string>>()
    for (const e of edges) {
      if (!e.selected) continue
      const mark = (nodeId: string, handle?: string | null) => {
        if (!used.has(nodeId)) used.set(nodeId, new Set())
        if (handle) used.get(nodeId)!.add(handle)
      }
      mark(e.source, e.sourceHandle)
      mark(e.target, e.targetHandle)
    }
    return used
  }, [edges])
  const pinned = pinnedPorts.has(id)
  const usedPorts = pinnedPorts.get(id)
  const pinnedClass = pinned ? ' is-ports-pinned' : ''

  useEffect(() => {
    if (editingRows) setRowsDraft(String(data.values?.columns ?? ''))
  }, [editingRows, data.values?.columns])

  useEffect(() => {
    if (editingJson) setJsonDraft(String(data.values?.json ?? ''))
  }, [editingJson, data.values?.json])

  const commitRows = () => {
    setEditingRows(false)
    const next = rowsDraft.trim()
    if (next !== String(data.values?.columns ?? '').trim()) {
      pushHistory()
      setNodeField(id, 'columns', next)
    }
  }

  // 尺寸/端口变化后让 React Flow 重新测量连接点，否则连线端点会留在旧位置
  useEffect(() => {
    updateNodeInternals(id)
  }, [id, width, height, block.ports.length, updateNodeInternals])

  const commitJson = () => {
    setEditingJson(false)
    const next = jsonDraft.trim()
    if (next !== String(data.values?.json ?? '').trim()) {
      pushHistory()
      setNodeField(id, 'json', next)
    }
  }

  const commitLabel = () => {
    setEditing(false)
    if (draft !== data.label) {
      pushHistory()
      updateNodeData(id, { label: draft })
    }
  }

  const labelInput = (
    <input
      ref={inputRef}
      className="ms-node__input nodrag nopan"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commitLabel}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commitLabel()
        if (e.key === 'Escape') setEditing(false)
      }}
    />
  )

  // 只用四个角做缩放手柄：上下左右中间要留给连接口，否则从端口拖不出连线
  const resizeControls =
    selected && !data.locked
      ? (['top-left', 'top-right', 'bottom-left', 'bottom-right'] as ControlPosition[]).map((pos) => (
          <NodeResizeControl
            key={pos}
            position={pos}
            minWidth={isGroup ? 160 : 60}
            minHeight={isGroup ? 110 : 32}
            className="ms-resize-handle"
            onResizeEnd={(_e, params) => setNodeSize(id, params.width, params.height)}
          />
        ))
      : null

  const handles = (block.ports.length ? block.ports : []).map((port) => (
    <Handle
      key={port.id}
      id={port.id}
      type={port.kind === 'target' ? 'target' : 'source'}
      position={POSITION_MAP[port.position]}
      className={`ms-handle${usedPorts?.has(port.id) ? ' is-used' : ''}`}
      isConnectableStart
      isConnectableEnd
    />
  ))

  /* ---------------- Onevra 风卡片节点 ---------------- */

  if (isCard) {
    const title = lines[0] ?? data.label
    const descs = lines.slice(1, 3)
    const fieldChips = block.fields
      .filter((f) => data.values?.[f.key] && f.type !== 'longtext')
      .slice(0, 2)
      .map((f) => data.values[f.key])
    return (
      <div
        className={`ms-node ms-node--card${selected ? ' is-selected' : ''}${pinnedClass}`}
        style={{ width: '100%', height: '100%' }}
        onDoubleClick={(e) => {
          e.stopPropagation()
          if (playing) return
          setEditing(true)
        }}
      >
        {resizeControls}
        {selected ? <span className="ms-node__ring" aria-hidden /> : null}
        <div
          className="ms-card"
          style={{ borderColor: `color-mix(in srgb, ${data.stroke} 26%, var(--border))` }}
        >
          <div className="ms-card__body">
            {editing ? (
              labelInput
            ) : (
              <div className="ms-card__title" style={{ color: data.textColor }}>
                <RichText text={title} />
              </div>
            )}
            {descs.map((l, i) => (
              <div key={i} className="ms-card__desc">
                <RichText text={l} />
              </div>
            ))}
            {!descs.length && fieldChips.length ? (
              <div className="ms-card__desc">{fieldChips.join(' · ')}</div>
            ) : null}
          </div>
        </div>
        {handles}
      </div>
    )
  }

  /* ---------------- JSON 结构体节点（Redis 等） ---------------- */

  if (isJson) {
    return (
      <div
        className={`ms-node ms-node--json${selected ? ' is-selected' : ''}${pinnedClass}`}
        style={{ width: '100%', height: '100%' }}
      >
        {resizeControls}
        <div
          className="ms-json"
          style={{
            borderColor: data.stroke,
            background: data.fill === 'transparent' ? 'transparent' : data.fill,
            color: data.textColor,
          }}
        >
          <div
            className="ms-json__head"
            style={{
              borderColor: data.stroke,
              color: data.textColor,
              background: `color-mix(in srgb, ${data.stroke} 16%, transparent)`,
            }}
            onDoubleClick={(e) => {
              e.stopPropagation()
              if (playing) return
              setEditing(true)
            }}
          >
            {block.icon ? <span className="ms-node__icon">{block.icon}</span> : null}
            {editing ? labelInput : <span className="ms-json__name">{data.label}</span>}
            {jsonKey ? <span className="ms-json__key">{jsonKey}</span> : null}
          </div>
          <div
            className="ms-json__body"
            title="双击编辑 JSON"
            onDoubleClick={(e) => {
              e.stopPropagation()
              if (playing) return
              setEditingJson(true)
            }}
          >
            {editingJson ? (
              <textarea
                className="ms-json__editor nodrag nopan"
                autoFocus
                value={jsonDraft}
                onChange={(e) => setJsonDraft(e.target.value)}
                onBlur={commitJson}
                onKeyDown={(e) => {
                  e.stopPropagation()
                  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') commitJson()
                  if (e.key === 'Escape') setEditingJson(false)
                }}
              />
            ) : jsonLines.length ? (
              <pre className="ms-json__code">{jsonText}</pre>
            ) : (
              <div className="ms-json__empty">双击填写 JSON 结构</div>
            )}
          </div>
        </div>
        {handles}
      </div>
    )
  }

  /* ---------------- 表格类节点 ---------------- */

  if (isTable) {
    return (
      <div
        className={`ms-node ms-node--table${selected ? ' is-selected' : ''}${pinnedClass}`}
        style={{ width: '100%', height: '100%' }}
      >
        {resizeControls}
        <div
          className="ms-table"
          style={{
            borderColor: data.stroke,
            background: data.fill === 'transparent' ? 'transparent' : data.fill,
            color: data.textColor,
          }}
        >
          <div
            className="ms-table__head"
            style={{
              borderColor: data.stroke,
              color: data.textColor,
              background: `color-mix(in srgb, ${data.stroke} 16%, transparent)`,
            }}
            onDoubleClick={(e) => {
              e.stopPropagation()
              if (playing) return
              setEditing(true)
            }}
          >
            {block.icon ? <span className="ms-node__icon">{block.icon}</span> : null}
            {editing ? labelInput : <span className="ms-table__name">{data.label}</span>}
          </div>
          <div
            className="ms-table__rows"
            onDoubleClick={(e) => {
              e.stopPropagation()
              if (playing) return
              setEditingRows(true)
            }}
            title="双击编辑字段列表"
          >
            {editingRows ? (
              <textarea
                className="ms-table__editor nodrag nopan"
                autoFocus
                value={rowsDraft}
                onChange={(e) => setRowsDraft(e.target.value)}
                onBlur={commitRows}
                onKeyDown={(e) => {
                  e.stopPropagation()
                  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') commitRows()
                  if (e.key === 'Escape') setEditingRows(false)
                }}
              />
            ) : null}
            {!editingRows && rows.length === 0 ? <div className="ms-table__empty">双击设置字段</div> : null}
            {!editingRows &&
              rows.map((row, i) => {
              const [name, ...rest] = row.split(':')
              const rawName = name.trim()
              const colName = stripRichText(rawName)
              const isPk = pk !== '' && colName.toLowerCase() === pk
              const changedTs = overlayOn ? playerChanged?.[colName] : undefined
              const flashing = !!changedTs && Date.now() - changedTs < 900
              const valueText = overlayOn ? (playerValues?.[colName] ?? '—') : rest.join(':').trim()
              return (
                <div key={i} className={`ms-table__row${isPk ? ' is-pk' : ''}${overlayOn ? ' is-value-mode' : ''}`}>
                  <span className="ms-table__col">
                    {isPk ? '🔑 ' : ''}
                    <RichText text={rawName} />
                  </span>
                    <span
                      key={overlayOn ? `${valueText}:${changedTs ?? 0}` : undefined}
                      className={`ms-table__type${overlayOn ? ' ms-table__value' : ''}${flashing ? ' is-changed' : ''}`}
                      title={overlayOn ? `${colName}: ${stripRichText(valueText)}` : undefined}
                    >
                      <RichText text={valueText} />
                    </span>
                  </div>
                )
              })}
          </div>
        </div>
        {handles}
      </div>
    )
  }

  /* ---------------- 普通节点 / 分组 ---------------- */

  return (
    <div
      className={`ms-node${isGroup ? ' ms-node--group' : ''}${selected ? ' is-selected' : ''}${pinnedClass}`}
      style={{ width: '100%', height: '100%' }}
      onDoubleClick={(e) => {
        e.stopPropagation()
        if (playing) return
        setEditing(true)
      }}
    >
      {resizeControls}
      <ShapeFrame
        shape={data.shape}
        width={width}
        height={height}
        fill={isGroup ? 'var(--group-fill)' : data.fill}
        stroke={data.stroke}
        strokeWidth={1.6}
        selected={false}
      />
      {selected ? <span className="ms-node__ring" aria-hidden /> : null}

      {data.locked ? <span className="ms-node__lock" title="已锁定（在图层面板解锁）">🔒</span> : null}

      {isGroup ? (
        <div className="ms-node__group-title" style={{ color: data.textColor }}>
          {block.icon ? <span className="ms-node__icon">{block.icon}</span> : null}
          {editing ? labelInput : <span>{data.label}</span>}
        </div>
      ) : (
        <div className="ms-node__body">
          {block.icon ? <span className="ms-node__icon">{block.icon}</span> : null}
          <div className="ms-node__text" style={{ color: data.textColor }}>
            {editing ? (
              labelInput
            ) : (
              <>
                {lines.length === 0 ? <span className="ms-node__placeholder">双击编辑</span> : null}
                {lines.map((l, i) => (
                  <span key={i} className={i === 0 ? 'ms-node__line ms-node__line--main' : 'ms-node__line'}>
                    {l}
                  </span>
                ))}
              </>
            )}
          </div>
          {showFields ? (
            <div className="ms-node__fields">
              {block.fields
                .filter((f) => data.values?.[f.key] && f.type !== 'longtext')
                .slice(0, 3)
                .map((f) => (
                  <span key={f.key} className="ms-node__field">
                    {data.values[f.key]}
                  </span>
                ))}
            </div>
          ) : null}
        </div>
      )}

      {handles}
    </div>
  )
}

export const BlockNode = memo(BlockNodeInner)
