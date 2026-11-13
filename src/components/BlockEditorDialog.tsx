import { useMemo } from 'react'
import { useStore } from '../store'
import { ShapeFrame, ShapeThumb } from '../lib/shapes'
import { ColorField } from './ColorField'
import { SEMANTIC_CLASSES, semanticClass } from '../lib/classes'
import { makeNodeId } from '../lib/translate'
import { blockIdPrefix, composeLabel, labelLines } from '../blocks/registry'
import {
  SHAPE_KINDS,
  SHAPE_LABELS,
  SHAPE_WRAP,
  type BlockDef,
  type BlockField,
  type FieldType,
  type Port,
  type PortKind,
  type PortPosition,
  type ShapeKind,
  FIELD_TYPE_LABELS,
} from '../types'

const PRESET_COLORS: Array<[string, string, string]> = [
  ['#dbeafe', '#2563eb', '#1e3a8a'],
  ['#dcfce7', '#16a34a', '#14532d'],
  ['#fef3c7', '#d97706', '#78350f'],
  ['#ede9fe', '#7c3aed', '#4c1d95'],
  ['#fee2e2', '#dc2626', '#7f1d1d'],
  ['#cffafe', '#0891b2', '#164e63'],
  ['#fce7f3', '#db2777', '#831843'],
  ['#f1f5f9', '#475569', '#0f172a'],
]

const EMOJI_PRESETS = ['⭐', '⚙️', '🔀', '📥', '🗄️', '🔌', '🧩', '📄', '🏁', '⏱️', '☁️', '🔐', '📊', '👤', '🚀', '🗂️', '💡', '🧠']

const POSITION_LABELS: Record<PortPosition, string> = { top: '上', right: '右', bottom: '下', left: '左' }
const KIND_LABELS: Record<PortKind, string> = { source: '输出', target: '输入', both: '双向' }

export function BlockEditorDialog() {
  const open = useStore((s) => s.blockEditor.open)
  const draft = useStore((s) => s.blockEditor.draft)
  const updateDraft = useStore((s) => s.updateDraft)
  const saveDraft = useStore((s) => s.saveDraft)
  const closeBlockEditor = useStore((s) => s.closeBlockEditor)
  const customBlocks = useStore((s) => s.customBlocks)

  const isExisting = useMemo(() => (draft ? customBlocks.some((b) => b.id === draft.id) : false), [customBlocks, draft])

  if (!open || !draft) return null

  const set = (patch: Partial<BlockDef>) => updateDraft(patch)
  const wrap = draft.mermaidWrap ?? SHAPE_WRAP[draft.shape]
  const previewLabel = composeLabel(
    { label: draft.name, values: Object.fromEntries(draft.fields.map((f) => [f.key, f.default ?? ''])) },
    draft,
  )
  const previewLines = labelLines(previewLabel)
  const sampleLine = `${'n1'}${wrap.open}"${(previewLabel || draft.name).replace(/\n+/g, '<br/>')}"${wrap.close}`

  const setFields = (fields: BlockField[]) => set({ fields })
  const setPorts = (ports: Port[]) => set({ ports })

  return (
    <div className="ms-modal" onMouseDown={(e) => e.target === e.currentTarget && closeBlockEditor()}>
      <div className="ms-modal__panel ms-modal__panel--wide">
        <div className="ms-modal__head">
          <div>
            <div className="ms-modal__title">{isExisting ? '编辑节点块' : '新建节点块'}</div>
            <div className="ms-modal__sub">自定义节点块会保存在本地，并出现在左侧调色板里</div>
          </div>
          <button className="ms-icon-btn" onClick={closeBlockEditor}>
            ✕
          </button>
        </div>

        <div className="ms-modal__grid">
          {/* 左：表单 */}
          <div className="ms-modal__col">
            <div className="ms-subsection__title">基本信息</div>
            <label className="ms-row">
              <span className="ms-row__label">名称</span>
              <span className="ms-row__control">
                <input className="ms-input" value={draft.name} onChange={(e) => set({ name: e.target.value })} />
              </span>
            </label>
            <label className="ms-row">
              <span className="ms-row__label">分组</span>
              <span className="ms-row__control">
                <input
                  className="ms-input"
                  value={draft.category}
                  placeholder="例如：我的 / 业务"
                  onChange={(e) => set({ category: e.target.value || '我的' })}
                />
              </span>
            </label>
            <label className="ms-row">
              <span className="ms-row__label">图标</span>
              <span className="ms-row__control">
                <input className="ms-input ms-input--num" value={draft.icon} onChange={(e) => set({ icon: e.target.value })} />
                <span className="ms-emoji-row">
                  {EMOJI_PRESETS.map((e) => (
                    <button key={e} className="ms-emoji" onClick={() => set({ icon: e })}>
                      {e}
                    </button>
                  ))}
                </span>
              </span>
            </label>
            <label className="ms-row">
              <span className="ms-row__label">ID 前缀</span>
              <span className="ms-row__control">
                <input
                  className="ms-input ms-input--num"
                  placeholder={blockIdPrefix(draft)}
                  value={draft.idPrefix ?? ''}
                  onChange={(e) => set({ idPrefix: e.target.value.replace(/[^A-Za-z0-9_]/g, '') })}
                />
                <span className="ms-hint">
                  自动生成节点 ID 用：<code>{blockIdPrefix(draft)}_名称_随机</code>
                </span>
              </span>
            </label>

            <label className="ms-row">
              <span className="ms-row__label">说明</span>
              <span className="ms-row__control">
                <input
                  className="ms-input"
                  value={draft.description ?? ''}
                  placeholder="鼠标悬停时显示"
                  onChange={(e) => set({ description: e.target.value })}
                />
              </span>
            </label>
            <label className="ms-row">
              <span className="ms-row__label">类型</span>
              <span className="ms-row__control">
                <select
                  className="ms-input"
                  value={draft.kind}
                  onChange={(e) => {
                    const kind = e.target.value as BlockDef['kind']
                    set({ kind, shape: kind === 'subgraph' ? 'group' : draft.shape === 'group' ? 'rect' : draft.shape })
                  }}
                >
                  <option value="node">普通节点</option>
                  <option value="subgraph">分组容器（subgraph）</option>
                </select>
              </span>
            </label>

            <label className="ms-row">
              <span className="ms-row__label">渲染方式</span>
              <span className="ms-row__control">
                <select
                  className="ms-input"
                  value={draft.layout ?? 'default'}
                  onChange={(e) => {
                    const layout = e.target.value as 'default' | 'table'
                    set({
                      layout,
                      fields:
                        layout === 'table' && !draft.fields.some((f) => f.key === 'columns')
                          ? [
                              ...draft.fields,
                              { key: 'pk', label: '主键', type: 'text', default: 'id' },
                              { key: 'columns', label: '字段列表', type: 'longtext', default: 'id: bigint\nname: varchar' },
                            ]
                          : draft.fields,
                      labelTemplate:
                        layout === 'table' ? '{{label}}\n{{columns}}' : draft.labelTemplate,
                    })
                  }}
                >
                  <option value="default">按形状（普通节点）</option>
                  <option value="card">卡片（Onevra 风：图标块 + 标题 + 说明）</option>
                  <option value="table">表格（表头 + 字段列表）</option>
                </select>
                <span className="ms-hint">
                  {draft.layout === 'table'
                    ? '表格渲染请保留 key 为 columns 的多行文本字段'
                    : draft.layout === 'json'
                      ? 'JSON 渲染请保留 key 为 json 的多行文本字段（高度按行数自动算）'
                      : draft.layout === 'card'
                        ? '卡片渲染：标签第一行是标题，第二、三行是灰色说明'
                        : '按形状渲染成普通节点'}
                </span>
              </span>
            </label>

            <div className="ms-subsection__title">形状与尺寸</div>
            <div className="ms-shape-grid">
              {SHAPE_KINDS.filter((s) => (draft.kind === 'subgraph' ? s === 'group' : s !== 'group')).map((s) => (
                <button
                  key={s}
                  className={`ms-shape-cell${draft.shape === s ? ' is-active' : ''}`}
                  onClick={() => set({ shape: s as ShapeKind })}
                  title={SHAPE_LABELS[s]}
                >
                  <ShapeThumb shape={s} fill={draft.fill} stroke={draft.stroke} size={40} />
                  <span>{SHAPE_LABELS[s]}</span>
                </button>
              ))}
            </div>
            <label className="ms-row">
              <span className="ms-row__label">默认尺寸</span>
              <span className="ms-row__control">
                <input
                  type="number"
                  className="ms-input ms-input--num"
                  value={draft.width}
                  onChange={(e) => set({ width: Math.max(40, Number(e.target.value) || 40) })}
                />
                <span className="ms-times">×</span>
                <input
                  type="number"
                  className="ms-input ms-input--num"
                  value={draft.height}
                  onChange={(e) => set({ height: Math.max(32, Number(e.target.value) || 32) })}
                />
              </span>
            </label>

            <div className="ms-subsection__title">配色</div>
            <div className="ms-swatches">
              {PRESET_COLORS.map(([f, s, t]) => (
                <button
                  key={f + s}
                  className="ms-swatch"
                  style={{ background: f, borderColor: s, color: t }}
                  onClick={() => set({ fill: f, stroke: s, textColor: t })}
                >
                  Aa
                </button>
              ))}
            </div>
            <ColorField label="填充" value={draft.fill} onChange={(v) => set({ fill: v })} />
            <ColorField label="边框" value={draft.stroke} onChange={(v) => set({ stroke: v })} />
            <ColorField label="文字" value={draft.textColor} onChange={(v) => set({ textColor: v })} />

            <div className="ms-subsection__title">
              连接端口
              <span className="ms-section-title__actions">
                <button className="ms-mini" onClick={() => setPorts(presetPorts('all'))}>
                  四向
                </button>
                <button className="ms-mini" onClick={() => setPorts(presetPorts('lr'))}>
                  左右
                </button>
                <button className="ms-mini" onClick={() => setPorts(presetPorts('tb'))}>
                  上下
                </button>
              </span>
            </div>
            {draft.ports.map((p, i) => (
              <div key={i} className="ms-listrow">
                <input
                  className="ms-input"
                  value={p.id}
                  onChange={(e) => setPorts(draft.ports.map((x, j) => (i === j ? { ...x, id: e.target.value } : x)))}
                />
                <select
                  className="ms-input"
                  value={p.position}
                  onChange={(e) => setPorts(draft.ports.map((x, j) => (i === j ? { ...x, position: e.target.value as PortPosition } : x)))}
                >
                  {Object.entries(POSITION_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
                <select
                  className="ms-input"
                  value={p.kind}
                  onChange={(e) => setPorts(draft.ports.map((x, j) => (i === j ? { ...x, kind: e.target.value as PortKind } : x)))}
                >
                  {Object.entries(KIND_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
                <button className="ms-icon-btn ms-icon-btn--danger" onClick={() => setPorts(draft.ports.filter((_, j) => j !== i))}>
                  ✕
                </button>
              </div>
            ))}
            <button
              className="ms-btn ms-btn--sm"
              onClick={() => setPorts([...draft.ports, { id: `p${draft.ports.length + 1}`, position: 'right', kind: 'both' }])}
            >
              ＋ 添加端口
            </button>

            <div className="ms-subsection__title">字段（可选）</div>
            <div className="ms-hint">
              字段会在右侧检查器里变成输入框，可用 <code>{'{{字段key}}'}</code> 写进标签模板。
            </div>
            {draft.fields.map((f, i) => (
              <div key={i} className="ms-fieldrow">
                <input
                  className="ms-input"
                  placeholder="key"
                  value={f.key}
                  onChange={(e) => setFields(draft.fields.map((x, j) => (i === j ? { ...x, key: e.target.value } : x)))}
                />
                <input
                  className="ms-input"
                  placeholder="显示名"
                  value={f.label}
                  onChange={(e) => setFields(draft.fields.map((x, j) => (i === j ? { ...x, label: e.target.value } : x)))}
                />
                <select
                  className="ms-input"
                  value={f.type}
                  onChange={(e) => setFields(draft.fields.map((x, j) => (i === j ? { ...x, type: e.target.value as FieldType } : x)))}
                >
                  {Object.entries(FIELD_TYPE_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
                <input
                  className="ms-input"
                  placeholder={f.type === 'select' ? '选项，逗号分隔' : '默认值'}
                  value={f.type === 'select' ? (f.options ?? []).join(',') : f.default ?? ''}
                  onChange={(e) =>
                    setFields(
                      draft.fields.map((x, j) =>
                        i === j
                          ? f.type === 'select'
                            ? { ...x, options: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) }
                            : { ...x, default: e.target.value }
                          : x,
                      ),
                    )
                  }
                />
                <button
                  className="ms-icon-btn ms-icon-btn--danger"
                  onClick={() => setFields(draft.fields.filter((_, j) => j !== i))}
                >
                  ✕
                </button>
              </div>
            ))}
            <button
              className="ms-btn ms-btn--sm"
              onClick={() => setFields([...draft.fields, { key: `field${draft.fields.length + 1}`, label: '新字段', type: 'text', default: '' }])}
            >
              ＋ 添加字段
            </button>

            <div className="ms-subsection__title">标签模板（可选）</div>
            <textarea
              className="ms-input ms-textarea"
              rows={2}
              placeholder={'{{label}}\\n{{method}} {{path}}'}
              value={draft.labelTemplate ?? ''}
              onChange={(e) => set({ labelTemplate: e.target.value })}
            />
            <div className="ms-hint">
              留空则只显示节点文本。<code>{'{{label}}'}</code> 是节点文本本身，<code>\n</code> 表示换行。
            </div>

            <div className="ms-subsection__title">Mermaid 高级设置</div>
            <label className="ms-row">
              <span className="ms-row__label">包装符</span>
              <span className="ms-row__control">
                <input
                  className="ms-input ms-input--num"
                  placeholder={SHAPE_WRAP[draft.shape].open}
                  value={draft.mermaidWrap?.open ?? ''}
                  onChange={(e) =>
                    set({
                      mermaidWrap: e.target.value
                        ? { open: e.target.value, close: draft.mermaidWrap?.close ?? SHAPE_WRAP[draft.shape].close }
                        : null,
                    })
                  }
                />
                <input
                  className="ms-input ms-input--num"
                  placeholder={SHAPE_WRAP[draft.shape].close}
                  value={draft.mermaidWrap?.close ?? ''}
                  onChange={(e) =>
                    set({
                      mermaidWrap: e.target.value
                        ? { open: draft.mermaidWrap?.open ?? SHAPE_WRAP[draft.shape].open, close: e.target.value }
                        : null,
                    })
                  }
                />
                <button className="ms-mini" onClick={() => set({ mermaidWrap: null })}>
                  跟随形状
                </button>
              </span>
            </label>
            <label className="ms-row">
              <span className="ms-row__label">样式类</span>
              <span className="ms-row__control">
                <select
                  className="ms-input"
                  value={draft.className ?? ''}
                  onChange={(e) => {
                    const cls = semanticClass(e.target.value)
                    set(
                      cls
                        ? { className: cls.name, fill: cls.fill, stroke: cls.stroke, textColor: cls.color, classDef: '' }
                        : { className: '' },
                    )
                  }}
                >
                  <option value="">（自定义 / 按颜色）</option>
                  {SEMANTIC_CLASSES.map((c) => (
                    <option key={c.name} value={c.name}>
                      {c.name} · {c.label}（{c.description}）
                    </option>
                  ))}
                </select>
              </span>
            </label>
            {draft.className ? (
              <div className="ms-hint">
                导出时会写成固定的 <code>classDef {draft.className} {semanticClass(draft.className)?.style}</code>，
                画布配色已同步成这套颜色。
              </div>
            ) : (
              <label className="ms-row">
                <span className="ms-row__label">classDef</span>
                <span className="ms-row__control">
                  <input
                    className="ms-input"
                    placeholder="fill:#eef,stroke:#66f,color:#111"
                    value={draft.classDef ?? ''}
                    onChange={(e) => set({ classDef: e.target.value })}
                  />
                </span>
              </label>
            )}
            <label className="ms-row">
              <span className="ms-row__label">行模板</span>
              <span className="ms-row__control">
                <textarea
                  className="ms-input ms-textarea"
                  rows={2}
                  placeholder="{{shape}}"
                  value={draft.mermaidTemplate ?? ''}
                  onChange={(e) => set({ mermaidTemplate: e.target.value })}
                />
              </span>
            </label>
            <div className="ms-hint">
              可用占位符：<code>{'{{id}}'}</code> <code>{'{{label}}'}</code> <code>{'{{open}}'}</code>{' '}
              <code>{'{{close}}'}</code> <code>{'{{shape}}'}</code> 以及任意 <code>{'{{字段key}}'}</code>。
            </div>
          </div>

          {/* 右：预览 */}
          <div className="ms-modal__col ms-modal__col--preview">
            <div className="ms-subsection__title">实时预览</div>
            <div className="ms-preview-stage">
              <div className="ms-preview-node" style={{ width: draft.width, height: draft.height }}>
                <ShapeFrame
                  shape={draft.shape}
                  width={draft.width}
                  height={draft.height}
                  fill={draft.kind === 'subgraph' ? 'rgba(148,163,184,0.12)' : draft.fill}
                  stroke={draft.stroke}
                />
                <div className="ms-node__body">
                  {draft.icon ? <span className="ms-node__icon">{draft.icon}</span> : null}
                  <div className="ms-node__text" style={{ color: draft.textColor }}>
                    {previewLines.length ? (
                      previewLines.map((l, i) => (
                        <span key={i} className={i === 0 ? 'ms-node__line ms-node__line--main' : 'ms-node__line'}>
                          {l}
                        </span>
                      ))
                    ) : (
                      <span className="ms-node__line ms-node__line--main">{draft.name}</span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="ms-subsection__title">生成的 Mermaid</div>
            <pre className="ms-pre">{`${sampleLine}${
              draft.className && semanticClass(draft.className)
                ? `\nclassDef ${draft.className} ${semanticClass(draft.className)!.style}`
                : draft.classDef
                  ? `\nclassDef blk_${draft.id.replace(/[^A-Za-z0-9_]/g, '_')} ${draft.classDef}`
                  : ''
            }`}</pre>
            <div className="ms-hint">
              端口：{draft.ports.length} 个 · 字段：{draft.fields.length} 个 · 形状：{SHAPE_LABELS[draft.shape]}
            </div>
            <div className="ms-hint">
              节点 ID 示例：<code>{makeNodeId(blockIdPrefix(draft), draft.name, 'node')}</code>
            </div>
          </div>
        </div>

        <div className="ms-modal__foot">
          <button className="ms-btn" onClick={closeBlockEditor}>
            取消
          </button>
          <button className="ms-btn ms-btn--primary" onClick={saveDraft}>
            {isExisting ? '保存修改' : '创建节点块'}
          </button>
        </div>
      </div>
    </div>
  )
}


function presetPorts(kind: 'all' | 'lr' | 'tb'): Port[] {
  if (kind === 'lr')
    return [
      { id: 'left', position: 'left', kind: 'both' },
      { id: 'right', position: 'right', kind: 'both' },
    ]
  if (kind === 'tb')
    return [
      { id: 'top', position: 'top', kind: 'both' },
      { id: 'bottom', position: 'bottom', kind: 'both' },
    ]
  return [
    { id: 'top', position: 'top', kind: 'both' },
    { id: 'right', position: 'right', kind: 'both' },
    { id: 'bottom', position: 'bottom', kind: 'both' },
    { id: 'left', position: 'left', kind: 'both' },
  ]
}
