import { memo, type CSSProperties } from 'react'
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import { tableRows } from '../blocks/registry'

/** 分组调色板：同一个分组同一个颜色，分组多于 7 个就循环（不静默丢掉） */
const GROUP_COLORS = ['#2563eb', '#059669', '#d97706', '#7c3aed', '#e11d48', '#0d9488', '#64748b']

/** 图谱里的一个点：Obsidian 式圆点 + 下方的名字；展开时在下面挂一张只读表卡片 */
export interface GraphDotData extends Record<string, unknown> {
  label: string
  columns: string
  groupIndex: number
  hop: number | null
  isFocus: boolean
  isDim: boolean
  expanded: boolean
  onToggleExpand: (id: string) => void
}

export type GraphDotNodeModel = Node<GraphDotData, 'dot'>

function GraphDotNodeInner({ id, data }: NodeProps<GraphDotNodeModel>) {
  // 展开时逐行渲染，收起时只用来数徽标——"什么算一个字段"只由 tableRows 定义一次
  const rows = tableRows(data.columns)
  const stateClass = [
    data.isFocus ? ' is-focus' : '',
    data.isDim ? ' is-dim' : '',
    data.expanded ? ' is-expanded' : '',
  ].join('')
  const groupColor =
    data.groupIndex >= 0 ? GROUP_COLORS[data.groupIndex % GROUP_COLORS.length] : 'var(--accent)'

  return (
    <div
      className={`ms-gdot${stateClass}`}
      data-id={id}
      data-hop={data.hop ?? ''}
      data-group={data.groupIndex}
      style={{ '--gdot': groupColor } as CSSProperties}
    >
      <Handle type="target" position={Position.Left} className="ms-gdot__handle" isConnectable={false} />
      <Handle type="source" position={Position.Right} className="ms-gdot__handle" isConnectable={false} />

      <div className="ms-gdot__body">
        <span className="ms-gdot__dot" />
        <span className="ms-gdot__label">{data.label}</span>
      </div>

      {data.expanded ? (
        <div className="ms-gcard">
          <div className="ms-gcard__head">
            <span className="ms-gcard__title">{data.label}</span>
            {rows.length > 0 ? <span className="ms-gcard__count">{rows.length}</span> : null}
          </div>
          <ul className="ms-gcard__rows">
            {rows.map((row, i) => {
              const at = row.indexOf(':')
              const name = at < 0 ? row : row.slice(0, at)
              const type = at < 0 ? '' : row.slice(at + 1)
              return (
                <li className="ms-gcard__row" key={`${row}-${i}`}>
                  <span className="ms-gcard__name">{name.trim()}</span>
                  <span className="ms-gcard__type">{type.trim()}</span>
                </li>
              )
            })}
          </ul>
        </div>
      ) : null}

      <button
        className="ms-gdot__toggle nodrag"
        title={data.expanded ? '收起字段' : '展开字段'}
        aria-label={data.expanded ? '收起字段' : '展开字段'}
        onClick={(e) => {
          e.stopPropagation()
          data.onToggleExpand(id)
        }}
      >
        {data.expanded ? '−' : '+'}
      </button>
    </div>
  )
}

export const GraphDotNode = memo(GraphDotNodeInner)
