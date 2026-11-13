import { memo } from 'react'
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import { tableRows } from '../blocks/registry'

/** 图谱里的一个点：表名 + 字段数徽标；展开后变成只读的表卡片 */
export interface GraphDotData extends Record<string, unknown> {
  label: string
  fieldCount: number
  columns: string
  groupIndex: number
  hop: number | null
  isFocus: boolean
  isNear: boolean
  isDim: boolean
  expanded: boolean
  onToggleExpand: (id: string) => void
}

export type GraphDotNodeModel = Node<GraphDotData, 'dot'>

function GraphDotNodeInner({ id, data }: NodeProps<GraphDotNodeModel>) {
  const rows = data.expanded ? tableRows(data.columns) : []
  const stateClass = [
    data.isFocus ? ' is-focus' : '',
    data.isNear ? ' is-near' : '',
    data.isDim ? ' is-dim' : '',
    data.expanded ? ' is-expanded' : '',
  ].join('')

  return (
    <div className={`ms-gdot${stateClass}`} data-id={id} data-hop={data.hop ?? ''} data-group={data.groupIndex}>
      <Handle type="target" position={Position.Left} className="ms-gdot__handle" isConnectable={false} />
      <Handle type="source" position={Position.Right} className="ms-gdot__handle" isConnectable={false} />

      {data.expanded ? (
        <div className="ms-gcard">
          <div className="ms-gcard__head">
            <span className="ms-gcard__title">{data.label}</span>
            {data.fieldCount > 0 ? <span className="ms-gcard__count">{data.fieldCount}</span> : null}
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
      ) : (
        <div className="ms-gdot__body">
          <span className="ms-gdot__dot" />
          <span className="ms-gdot__label">{data.label}</span>
          {data.fieldCount > 0 ? (
            <span className="ms-gdot__badge" title={`${data.fieldCount} 个字段`}>
              {data.fieldCount}
            </span>
          ) : null}
        </div>
      )}

      <button
        className="ms-gdot__toggle"
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
