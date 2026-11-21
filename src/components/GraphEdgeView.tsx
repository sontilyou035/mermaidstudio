import { memo } from 'react'
import type { Edge, EdgeProps } from '@xyflow/react'

/** 图谱里的连线：直线 + 自绘箭头，虚线 = 待确认，⚠ = 标签不合规 */
export interface GraphEdgeData extends Record<string, unknown> {
  dashed: boolean
  arrow: boolean
  label: string
  dim: boolean
  /** 两端圆点的半径：线要缩到各自圆点的边缘，节点大小随度数变 */
  sourceR: number
  targetR: number
}

export type GraphEdgeModel = Edge<GraphEdgeData, 'graph'>

const ARROW_LEN = 8
const ARROW_HALF = 3.4

function GraphEdgeViewInner({ id, sourceX, sourceY, targetX, targetY, data }: EdgeProps<GraphEdgeModel>) {
  const d = data ?? { dashed: false, arrow: true, label: '', dim: false, sourceR: 4, targetR: 4 }

  const dx = targetX - sourceX
  const dy = targetY - sourceY
  const len = Math.hypot(dx, dy) || 1
  const ux = dx / len
  const uy = dy / len
  // 连接点锚在圆点圆心，两端各缩到自己的圆点边缘（留 1.5px 空隙）
  const startX = sourceX + ux * (d.sourceR + 1.5)
  const startY = sourceY + uy * (d.sourceR + 1.5)
  const tipX = targetX - ux * (d.targetR + 1.5)
  const tipY = targetY - uy * (d.targetR + 1.5)
  // 线画到箭头根部，箭头压在圆点边缘上
  const baseX = d.arrow ? tipX - ux * ARROW_LEN : tipX
  const baseY = d.arrow ? tipY - uy * ARROW_LEN : tipY
  const nx = -uy
  const ny = ux

  const className = ['ms-gedge', d.dashed ? 'is-dashed' : '', d.dim ? 'is-dim' : '']
    .filter(Boolean)
    .join(' ')

  return (
    <g className={className} data-edge-id={id}>
      <title>{d.label || '（未设置类型）'}</title>
      <path className="ms-gedge__line" d={`M ${startX},${startY} L ${baseX},${baseY}`} />
      {d.arrow ? (
        <path
          className="ms-gedge__arrow"
          d={`M ${tipX},${tipY} L ${baseX + nx * ARROW_HALF},${baseY + ny * ARROW_HALF} L ${
            baseX - nx * ARROW_HALF
          },${baseY - ny * ARROW_HALF} Z`}
        />
      ) : null}
    </g>
  )
}

export const GraphEdgeView = memo(GraphEdgeViewInner)
