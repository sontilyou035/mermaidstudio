import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../store'
import {
  allBlocks,
  blockIdPrefix,
  jsonNodeHeight,
  structuralNodeHeight,
  tableNodeHeight,
  tryPrettyJson,
} from '../blocks/registry'
import { ColorField, normalize } from './ColorField'
import {
  CANONICAL_EDGE_TYPES,
  EDGE_TYPE_INFO,
  composeEdgeLabel,
  isEdgeLabelConforming,
  normalizeEdgeType,
  suggestEdgeType,
} from '../lib/edgeLabels'
import { PORT_POSITION_LABELS, defaultPortSides } from '../lib/ports'
import {
  CURVE_LABELS,
  DIRECTION_LABELS,
  LINE_STYLE_LABELS,
  MARKER_LABELS,
  SHAPE_LABELS,
  type CurveKind,
  type Direction,
  type FlowNode,
  type LineStyle,
  type MarkerKind,
} from '../types'

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="ms-row">
      <span className="ms-row__label">{label}</span>
      <span className="ms-row__control">{children}</span>
    </label>
  )
}

export function Inspector() {
  const doc = useStore((s) => s.doc)
  const customBlocks = useStore((s) => s.customBlocks)
  const updateNodeData = useStore((s) => s.updateNodeData)
  const setNodeField = useStore((s) => s.setNodeField)
  const changeNodeBlock = useStore((s) => s.changeNodeBlock)
  const updateEdgeData = useStore((s) => s.updateEdgeData)
  const setEdgeHandle = useStore((s) => s.setEdgeHandle)
  const resetEdgeHandles = useStore((s) => s.resetEdgeHandles)
  const setEdgeLabelType = useStore((s) => s.setEdgeLabelType)
  const setDirection = useStore((s) => s.setDirection)
  const renameDoc = useStore((s) => s.renameDoc)
  const deleteSelection = useStore((s) => s.deleteSelection)
  const duplicateSelection = useStore((s) => s.duplicateSelection)
  const setNodeSize = useStore((s) => s.setNodeSize)
  const groupSelection = useStore((s) => s.groupSelection)
  const addSelectionToGroup = useStore((s) => s.addSelectionToGroup)
  const removeSelectionFromGroup = useStore((s) => s.removeSelectionFromGroup)
  const fitGroupToMembers = useStore((s) => s.fitGroupToMembers)
  const toggleNodeLocked = useStore((s) => s.toggleNodeLocked)
  const renameNodeId = useStore((s) => s.renameNodeId)
  const regenerateNodeId = useStore((s) => s.regenerateNodeId)
  const alignSelection = useStore((s) => s.alignSelection)
  const distributeSelection = useStore((s) => s.distributeSelection)
  const updateSettings = useStore((s) => s.updateSettings)
  const pushHistory = useStore((s) => s.pushHistory)
  const settings = useStore((s) => s.settings)

  const blocks = useMemo(() => allBlocks(customBlocks), [customBlocks])
  const selectedNodes = doc.nodes.filter((n) => n.selected)
  const selectedEdges = doc.edges.filter((e) => e.selected)
  const node: FlowNode | null = selectedNodes.length === 1 ? selectedNodes[0] : null
  const edge = selectedEdges.length === 1 && selectedNodes.length === 0 ? selectedEdges[0] : null
  const block = node ? blocks.find((b) => b.id === node.data.blockId) : null
  const prefixOfNode = (nodeId: string) => {
    const n = doc.nodes.find((x) => x.id === nodeId)
    const b = n ? blocks.find((x) => x.id === n.data.blockId) : undefined
    return b ? blockIdPrefix(b) : ''
  }
  const edgeLabelText = edge ? composeEdgeLabel(edge.data?.type, edge.data?.note, edge.data?.label).trim() : ''
  const edgeLabelOk = edge ? isEdgeLabelConforming(edgeLabelText) : true
  const suggestedType = edge ? suggestEdgeType(prefixOfNode(edge.source), prefixOfNode(edge.target)) : '下一步'
  const groupOptions = doc.nodes.filter((n) => n.data.isSubgraph)

  // 连线两端的可选端口跟着节点块走：自定义块可能只有左右两个口
  const portsOfNode = (nodeId?: string) => {
    const n = nodeId ? doc.nodes.find((x) => x.id === nodeId) : undefined
    const b = n ? blocks.find((x) => x.id === n.data.blockId) : undefined
    return b?.ports ?? []
  }
  const sourcePorts = edge ? portsOfNode(edge.source) : []
  const targetPorts = edge ? portsOfNode(edge.target) : []
  const edgeAuto = !edge?.data?.handleMode || edge.data.handleMode === 'auto'
  const edgeAutoSides = defaultPortSides(doc.direction)

  const patch = (p: Parameters<typeof updateNodeData>[1]) => {
    if (!node) return
    updateNodeData(node.id, p)
  }

  return (
    <div className="ms-panel-body">
      {node ? (
        <>
          <div className="ms-section-title">
            节点
            <span className="ms-section-title__actions">
              <button className="ms-icon-btn" title="复制节点" onClick={duplicateSelection}>
                ⧉
              </button>
              <button className="ms-icon-btn ms-icon-btn--danger" title="删除节点" onClick={deleteSelection}>
                ✕
              </button>
            </span>
          </div>

          <Row label="节点块">
            <select className="ms-input" value={node.data.blockId} onChange={(e) => changeNodeBlock(node.id, e.target.value)}>
              {blocks.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.icon} {b.name}
                  {b.builtin ? '' : ' ·我的'}
                </option>
              ))}
            </select>
          </Row>

          <Row label="文本">
            <input
              className="ms-input"
              value={node.data.label}
              onChange={(e) => patch({ label: e.target.value })}
              onFocus={pushHistory}
            />
          </Row>

          <NodeIdField
            key={node.id}
            nodeId={node.id}
            onRename={(v) => renameNodeId(node.id, v)}
            onRegenerate={() => regenerateNodeId(node.id)}
          />

          {node.data.isSubgraph ? (
            <Row label="子图 id">
              <input
                className="ms-input"
                placeholder="留空自动生成"
                value={node.data.values?.id ?? ''}
                onChange={(e) => setNodeField(node.id, 'id', e.target.value)}
              />
            </Row>
          ) : null}

          {block?.fields.length ? (
            <div className="ms-subsection">
              <div className="ms-subsection__title">块字段（由节点块定义）</div>
              {block.layout === 'table' ? (
                <div className="ms-hint">
                  字段列表每行写一个字段，格式 <code>字段名: 类型</code>；节点高度会随行数自动变化。
                </div>
              ) : null}
              {block.layout === 'json' ? <JsonFieldTools node={node} onChange={(v) => setNodeField(node.id, 'json', v)} /> : null}
              {block.fields.map((f) => (
                <Row key={f.key} label={f.label}>
                  {f.type === 'select' ? (
                    <select
                      className="ms-input"
                      value={node.data.values?.[f.key] ?? ''}
                      onChange={(e) => setNodeField(node.id, f.key, e.target.value)}
                    >
                      {(f.options ?? []).map((o) => (
                        <option key={o} value={o}>
                          {o === '' ? '—' : o}
                        </option>
                      ))}
                    </select>
                  ) : f.type === 'longtext' ? (
                    <textarea
                      className="ms-input ms-field-textarea"
                      rows={Math.min(10, Math.max(4, (node.data.values?.[f.key] ?? '').split('\n').length + 1))}
                      placeholder={f.placeholder}
                      value={node.data.values?.[f.key] ?? ''}
                      onChange={(e) => setNodeField(node.id, f.key, e.target.value)}
                    />
                  ) : f.type === 'boolean' ? (
                    <input
                      type="checkbox"
                      checked={(node.data.values?.[f.key] ?? '') === 'true'}
                      onChange={(e) => setNodeField(node.id, f.key, e.target.checked ? 'true' : 'false')}
                    />
                  ) : (
                    <input
                      className="ms-input"
                      placeholder={f.placeholder}
                      value={node.data.values?.[f.key] ?? ''}
                      onChange={(e) => setNodeField(node.id, f.key, e.target.value)}
                    />
                  )}
                </Row>
              ))}
            </div>
          ) : null}

          <div className="ms-subsection">
            <div className="ms-subsection__title">外观</div>
            <ColorField label="填充" value={node.data.fill} onChange={(v) => patch({ fill: v })} />
            <ColorField label="边框" value={node.data.stroke} onChange={(v) => patch({ stroke: v })} />
            <ColorField label="文字" value={node.data.textColor} onChange={(v) => patch({ textColor: v })} />
            <Row label="形状">
              <select className="ms-input" value={node.data.shape} onChange={(e) => patch({ shape: e.target.value as FlowNode['data']['shape'] })}>
                {Object.entries(SHAPE_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </Row>
            <Row label="尺寸">
              <input
                type="number"
                className="ms-input ms-input--num"
                value={Math.round(node.data.width)}
                onChange={(e) => setNodeSize(node.id, Math.max(40, Number(e.target.value) || 40), node.data.height)}
              />
              <span className="ms-times">×</span>
              <input
                type="number"
                className="ms-input ms-input--num"
                value={Math.round(node.data.height)}
                onChange={(e) => setNodeSize(node.id, node.data.width, Math.max(32, Number(e.target.value) || 32))}
              />
              {block?.layout === 'table' || block?.layout === 'json' ? (
                <button
                  className="ms-mini"
                  title="按内容行数自动算高度"
                  onClick={() => setNodeSize(node.id, node.data.width, block ? structuralNodeHeight(block, node.data.values) : node.data.height)}
                >
                  按内容自适应
                </button>
              ) : null}
            </Row>
            <Row label="锁定">
              <input type="checkbox" checked={Boolean(node.data.locked)} onChange={() => toggleNodeLocked(node.id)} />
              <span className="ms-hint">锁定后不能拖动/删除，可在图层面板解锁</span>
            </Row>
          </div>

          {node.data.isSubgraph ? (
            <div className="ms-subsection">
              <div className="ms-subsection__title">分组</div>
              <div className="ms-btn-row">
                <button className="ms-btn ms-btn--sm" onClick={() => fitGroupToMembers(node.id)}>
                  适应内容大小
                </button>
                <button className="ms-btn ms-btn--sm" onClick={() => addSelectionToGroup(node.id)}>
                  把选中节点加进来
                </button>
              </div>
              <div className="ms-hint">
                当前组内有 {doc.nodes.filter((n) => n.data.groupId === node.id).length} 个节点。拖动分组框会一起移动组内节点。
              </div>
            </div>
          ) : null}

          {!node.data.isSubgraph && groupOptions.length ? (
            <div className="ms-subsection">
              <div className="ms-subsection__title">分组</div>
              <Row label="所属分组">
                <select
                  className="ms-input"
                  value={node.data.groupId ?? ''}
                  onChange={(e) => patch({ groupId: e.target.value || null })}
                >
                  <option value="">（不分组）</option>
                  {groupOptions.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.data.label}
                    </option>
                  ))}
                </select>
              </Row>
            </div>
          ) : null}

          <div className="ms-kv">
            位置 {Math.round(node.position.x)}, {Math.round(node.position.y)}
          </div>
        </>
      ) : edge ? (
        <>
          <div className="ms-section-title">
            连线
            <span className="ms-section-title__actions">
              <button className="ms-icon-btn ms-icon-btn--danger" title="删除连线" onClick={deleteSelection}>
                ✕
              </button>
            </span>
          </div>
          <Row label="类型">
            <select
              className="ms-input"
              value={normalizeEdgeType(edge.data?.type) || ''}
              onChange={(e) => setEdgeLabelType(edge.id, e.target.value, edge.data?.note ?? '')}
            >
              <option value="">（未设置，不合规）</option>
              {CANONICAL_EDGE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t} · {EDGE_TYPE_INFO[t]?.meaning}（{EDGE_TYPE_INFO[t]?.typical}）
                </option>
              ))}
            </select>
          </Row>
          <Row label="说明">
            <input
              className="ms-input"
              placeholder="可选，例如 order_id"
              value={edge.data?.note ?? ''}
              onChange={(e) => setEdgeLabelType(edge.id, normalizeEdgeType(edge.data?.type) || '下一步', e.target.value)}
              onFocus={pushHistory}
            />
          </Row>
          <div className={`ms-edge-label-preview${edgeLabelOk ? '' : ' is-bad'}`}>
            标签：<code>{edgeLabelText || '（空）'}</code>
            {edgeLabelOk ? null : <span className="ms-hint"> 不合规：类型必须是十种规范类型之一</span>}
          </div>
          {!edgeLabelOk ? (
            <div className="ms-btn-row">
              <button
                className="ms-mini ms-mini--accent"
                onClick={() => setEdgeLabelType(edge.id, suggestedType, edge.data?.label && !edge.data?.label.includes(':') ? edge.data.label : '')}
              >
                按推荐补全：{suggestedType}
              </button>
            </div>
          ) : null}
          <Row label="出口">
            <select
              className="ms-input"
              value={edgeAuto ? '' : (edge.sourceHandle ?? '')}
              onChange={(e) =>
                e.target.value ? setEdgeHandle(edge.id, 'source', e.target.value) : resetEdgeHandles(edge.id)
              }
            >
              <option value="">自动（{PORT_POSITION_LABELS[edgeAutoSides.out]}出）</option>
              {sourcePorts.map((p) => (
                <option key={p.id} value={p.id}>
                  {PORT_POSITION_LABELS[p.position]} · {p.id}
                </option>
              ))}
            </select>
          </Row>
          <Row label="入口">
            <select
              className="ms-input"
              value={edgeAuto ? '' : (edge.targetHandle ?? '')}
              onChange={(e) =>
                e.target.value ? setEdgeHandle(edge.id, 'target', e.target.value) : resetEdgeHandles(edge.id)
              }
            >
              <option value="">自动（{PORT_POSITION_LABELS[edgeAutoSides.in]}入）</option>
              {targetPorts.map((p) => (
                <option key={p.id} value={p.id}>
                  {PORT_POSITION_LABELS[p.position]} · {p.id}
                </option>
              ))}
            </select>
          </Row>
          {edgeAuto ? (
            <>
              <div className="ms-hint">
                自动 = 顺着骨架方向走（TB 下出上入 / LR 右出左入）。把端点直接拖到别的口上，就会变成人工指定。
              </div>
              <div className="ms-btn-row">
                <button className="ms-mini" title="把所有「自动」的连线按当前方向重排" onClick={() => resetEdgeHandles()}>
                  ⟲ 全部按方向重设
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="ms-hint">这条连线是人工指定的端口，切换方向不会覆盖它。</div>
              <div className="ms-btn-row">
                <button className="ms-mini ms-mini--accent" onClick={() => resetEdgeHandles(edge.id)}>
                  ⟲ 恢复自动
                </button>
              </div>
            </>
          )}
          <Row label="拐点">
            <span className="ms-row__control" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span className="ms-hint" style={{ margin: 0 }}>
                {(edge.data?.waypoints?.length ?? 0) > 0
                  ? `${edge.data?.waypoints?.length} 个（双击拐点可删）`
                  : '选中后拖线上的 ＋ 加拐点'}
              </span>
              {(edge.data?.waypoints?.length ?? 0) > 0 ? (
                <button className="ms-mini" onClick={() => updateEdgeData(edge.id, { waypoints: [] })}>
                  清除拐点
                </button>
              ) : null}
            </span>
          </Row>
          <Row label="曲线">
            <select
              className="ms-input"
              value={edge.data?.curve ?? 'smoothstep'}
              onChange={(e) => updateEdgeData(edge.id, { curve: e.target.value as CurveKind })}
            >
              {Object.entries(CURVE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </Row>
          <Row label="线型">
            <select
              className="ms-input"
              value={edge.data?.lineStyle ?? 'solid'}
              onChange={(e) => updateEdgeData(edge.id, { lineStyle: e.target.value as LineStyle })}
            >
              {Object.entries(LINE_STYLE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </Row>
          <Row label="起点">
            <select
              className="ms-input"
              value={edge.data?.startMarker ?? 'none'}
              onChange={(e) => updateEdgeData(edge.id, { startMarker: e.target.value as MarkerKind })}
            >
              {Object.entries(MARKER_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </Row>
          <Row label="终点">
            <select
              className="ms-input"
              value={edge.data?.endMarker ?? 'arrow'}
              onChange={(e) => updateEdgeData(edge.id, { endMarker: e.target.value as MarkerKind })}
            >
              {Object.entries(MARKER_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </Row>
          <Row label="颜色">
            <input
              type="color"
              className="ms-color"
              value={normalize(edge.data?.stroke ?? '#64748b')}
              onChange={(e) => updateEdgeData(edge.id, { stroke: e.target.value })}
            />
          </Row>
          <Row label="粗细">
            <input
              type="range"
              min={1}
              max={8}
              step={0.5}
              value={edge.data?.strokeWidth ?? 2}
              onChange={(e) => updateEdgeData(edge.id, { strokeWidth: Number(e.target.value) })}
            />
          </Row>
          <Row label="流动动画">
            <input
              type="checkbox"
              checked={Boolean(edge.data?.animated)}
              onChange={(e) => updateEdgeData(edge.id, { animated: e.target.checked })}
            />
          </Row>
          <div className="ms-kv">
            {edge.source} → {edge.target}
          </div>
        </>
      ) : selectedNodes.length > 1 ? (
        <>
          <div className="ms-section-title">已选中 {selectedNodes.length} 个节点</div>
          <div className="ms-btn-row">
            <button className="ms-btn" onClick={groupSelection}>
              🗂️ 编成一个分组
            </button>
            <button className="ms-btn" onClick={removeSelectionFromGroup}>
              移出分组
            </button>
          </div>
          <div className="ms-subsection__title">对齐 / 分布</div>
          <div className="ms-btn-row">
            {(
              [
                ['left', '左'],
                ['hcenter', '水平居中'],
                ['right', '右'],
                ['top', '顶'],
                ['vcenter', '垂直居中'],
                ['bottom', '底'],
              ] as const
            ).map(([mode, label]) => (
              <button key={mode} className="ms-btn ms-btn--sm" onClick={() => alignSelection(mode)}>
                {label}
              </button>
            ))}
          </div>
          <div className="ms-btn-row">
            <button className="ms-btn ms-btn--sm" onClick={() => distributeSelection('h')}>
              水平等距
            </button>
            <button className="ms-btn ms-btn--sm" onClick={() => distributeSelection('v')}>
              垂直等距
            </button>
          </div>
          <div className="ms-btn-row">
            <button className="ms-btn" onClick={duplicateSelection}>
              ⧉ 复制
            </button>
            <button className="ms-btn ms-btn--danger" onClick={deleteSelection}>
              ✕ 删除
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="ms-section-title">图表设置</div>
          <Row label="名称">
            <input className="ms-input" value={doc.name} onChange={(e) => renameDoc(e.target.value)} />
          </Row>
          <Row label="方向">
            <select className="ms-input" value={doc.direction} onChange={(e) => setDirection(e.target.value as Direction)}>
              {Object.entries(DIRECTION_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v} ({k})
                </option>
              ))}
            </select>
          </Row>
          <Row label="对齐网格">
            <input
              type="checkbox"
              checked={settings.snapToGrid}
              onChange={(e) => updateSettings({ snapToGrid: e.target.checked })}
            />
          </Row>
          <Row label="渲染引擎">
            <select
              className="ms-input"
              value={settings.renderEngine}
              onChange={(e) => updateSettings({ renderEngine: e.target.value as 'pele' | 'mermaid' })}
            >
              <option value="pele">pele（默认 · 快且体积小）</option>
              <option value="mermaid">mermaid.js（官方 · 最保守）</option>
            </select>
          </Row>
          <Row label="Mermaid 带样式">
            <input
              type="checkbox"
              checked={settings.includeStyles}
              onChange={(e) => updateSettings({ includeStyles: e.target.checked })}
            />
          </Row>
          <div className="ms-kv">
            选中一个节点或连线后，这里会显示它的属性。
          </div>
        </>
      )}
    </div>
  )
}

/** JSON 字段的格式化 / 校验小工具 */
function JsonFieldTools({ node, onChange }: { node: FlowNode; onChange: (v: string) => void }) {
  const raw = String(node.data.values?.json ?? '')
  const result = useMemo(() => (raw.trim() ? tryPrettyJson(raw) : null), [raw])
  const ok = result?.ok === true
  const error = result && !result.ok ? result.error : ''
  return (
    <div className="ms-btn-row">
      <button
        className="ms-mini"
        onClick={() => {
          const r = tryPrettyJson(raw)
          if (r.ok) onChange(r.text)
        }}
        disabled={!ok}
        title="把 JSON 重新排版成两空格缩进"
      >
        格式化 JSON
      </button>
      <span className={`ms-json-status${result && !result.ok ? ' is-bad' : ''}`}>
        {!raw.trim()
          ? '（空）'
          : ok
            ? `JSON 合法 · 约 ${jsonNodeHeight(raw, 110)}px 高`
            : `JSON 不合法：${error}`}
      </span>
    </div>
  )
}

/** 节点 ID：可以人工命名，回车/失焦提交；也支持按名称重新生成 */
function NodeIdField({
  nodeId,
  onRename,
  onRegenerate,
}: {
  nodeId: string
  onRename: (v: string) => boolean
  onRegenerate: () => string | null
}) {
  const [draft, setDraft] = useState(nodeId)
  const [error, setError] = useState('')
  useEffect(() => setDraft(nodeId), [nodeId])

  const commit = () => {
    const next = draft.trim()
    if (next === nodeId) {
      setError('')
      return
    }
    if (!next) {
      setError('ID 不能为空')
      setDraft(nodeId)
      return
    }
    const ok = onRename(next)
    if (!ok) {
      setError('ID 已被占用或不可用')
      setDraft(nodeId)
    } else {
      setError('')
    }
  }

  return (
    <Row label="ID">
      <input
        className={`ms-input ms-input--id${error ? ' is-bad' : ''}`}
        value={draft}
        spellCheck={false}
        placeholder="例如 a_checkout_x1y2z"
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          // 回车直接提交（不依赖失焦），Esc 撤销输入
          if (e.key === 'Enter') {
            commit()
            ;(e.target as HTMLInputElement).blur()
          }
          if (e.key === 'Escape') {
            setDraft(nodeId)
            setError('')
            ;(e.target as HTMLInputElement).blur()
          }
        }}
        onBlur={commit}
        title="节点 ID 会写进导出的 Mermaid（前缀_英文蛇形_随机）"
      />
      <button
        className="ms-mini"
        title="根据当前文本重新生成语义化 ID"
        onClick={() => {
          const next = onRegenerate()
          if (next) setDraft(next)
        }}
      >
        ↻ 按名称生成
      </button>
    </Row>
  )
}
