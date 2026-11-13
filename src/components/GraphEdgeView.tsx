import { memo } from 'react'
import type { Edge, EdgeProps } from '@xyflow/react'

/** 图谱里的连线：直线 + 自绘箭头，虚线 = 待确认，⚠ = 标签不合规 */
export interface GraphEdgeData extends Record<string, unknown> {
  dashed: boolean
  warn: boolean
  arrow: boolean
  label: string
  dim: boolean
}

export type GraphEdgeModel = Edge<GraphEdgeData, 'graph'>

const ARROW_LEN = 11
const ARROW_HALF = 4.5

function GraphEdgeViewInner({ id, sourceX, sourceY, targetX, targetY, data }: EdgeProps<GraphEdgeModel>) {
  const d = data ?? { dashed: false, warn: false, arrow: true, label: '', dim: false }

  const dx = targetX - sourceX
  const dy = targetY - sourceY
  const len = Math.hypot(dx, dy) || 1
  const ux = dx / len
  const uy = dy / len
  // 线画到箭头根部，箭头压在目标端点上
  const baseX = d.arrow ? targetX - ux * ARROW_LEN : targetX
  const baseY = d.arrow ? targetY - uy * ARROW_LEN : targetY
  const nx = -uy
  const ny = ux

  const className = [
    'ms-gedge',
    d.dashed ? 'is-dashed' : '',
    d.warn ? 'is-warn' : '',
    d.dim ? 'is-dim' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <g className={className} data-edge-id={id}>
      <title>{d.label || '（未设置类型）'}</title>
      <path className="ms-gedge__line" d={`M ${sourceX},${sourceY} L ${baseX},${baseY}`} />
      {d.arrow ? (
        <path
          className="ms-gedge__arrow"
          d={`M ${targetX},${targetY} L ${baseX + nx * ARROW_HALF},${baseY + ny * ARROW_HALF} L ${
            baseX - nx * ARROW_HALF
          },${baseY - ny * ARROW_HALF} Z`}
        />
      ) : null}
      {d.warn ? (
        <text
          className="ms-gedge__warn"
          x={(sourceX + targetX) / 2}
          y={(sourceY + targetY) / 2}
          textAnchor="middle"
          dominantBaseline="central"
        >
          ⚠
        </text>
      ) : null}
    </g>
  )
}

export const GraphEdgeView = memo(GraphEdgeViewInner)
