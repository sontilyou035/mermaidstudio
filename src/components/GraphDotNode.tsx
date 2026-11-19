import { memo, type CSSProperties } from 'react'
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'

/** 分组调色板：同一个分组同一个颜色，分组多于 7 个就循环（不静默丢掉） */
const GROUP_COLORS = ['#2563eb', '#059669', '#d97706', '#7c3aed', '#e11d48', '#0d9488', '#64748b']

/** 节点在画布上的固定占位框：圆点在顶部正中，名字在下面 */
export const NODE_W = 140
export const NODE_H = 70
/** 圆点中心距节点框顶部的距离（连线端点也锚在这里；圆点大小变化时圆心不动） */
export const DOT_ANCHOR_Y = 16

/** 圆点直径：连线越多面积越大（面积与条数成正比，所以直径随 √条数 增长） */
export function dotSize(degree: number): number {
  return Math.round(Math.min(22, 8 + Math.sqrt(Math.max(0, degree)) * 3.4))
}

/** 图谱里的一个点：Obsidian 式圆点 + 下方的名字 */
export interface GraphDotData extends Record<string, unknown> {
  label: string
  degree: number
  groupIndex: number
  hop: number | null
  isFocus: boolean
  isDim: boolean
}

export type GraphDotNodeModel = Node<GraphDotData, 'dot'>

/** 两个连接点都压在圆点圆心上：边线由 GraphEdgeView 自己缩到圆点边缘 */
const HANDLE_STYLE: CSSProperties = {
  top: DOT_ANCHOR_Y,
  left: '50%',
  right: 'auto',
  bottom: 'auto',
  transform: 'translate(-50%, -50%)',
  width: 2,
  height: 2,
  minWidth: 0,
  minHeight: 0,
  border: 0,
  background: 'transparent',
  opacity: 0,
  pointerEvents: 'none',
}

function GraphDotNodeInner({ id, data }: NodeProps<GraphDotNodeModel>) {
  const stateClass = [data.isFocus ? ' is-focus' : '', data.isDim ? ' is-dim' : ''].join('')
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
      <Handle type="target" position={Position.Top} style={HANDLE_STYLE} isConnectable={false} />
      <Handle type="source" position={Position.Top} style={HANDLE_STYLE} isConnectable={false} />
      <div className="ms-gdot__body">
        <span className="ms-gdot__dot" style={{ width: dotSize(data.degree), height: dotSize(data.degree) }} />
        <span className="ms-gdot__label">{data.label}</span>
      </div>
    </div>
  )
}

export const GraphDotNode = memo(GraphDotNodeInner)
