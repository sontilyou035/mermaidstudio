import type { CSSProperties, ReactElement } from 'react'
import type { ShapeKind } from '../types'

interface ShapeFrameProps {
  shape: ShapeKind
  width: number
  height: number
  fill: string
  stroke: string
  strokeWidth?: number
  dashed?: boolean
  style?: CSSProperties
  selected?: boolean
}

/**
 * 用 SVG 精确绘制 Mermaid 的各种节点形状。
 * 所有形状都画在 0..width / 0..height 的坐标系里，方便和 React Flow 的节点框对齐。
 */
export function ShapeFrame({
  shape,
  width,
  height,
  fill,
  stroke,
  strokeWidth = 1.6,
  dashed,
  style,
  selected,
}: ShapeFrameProps) {
  const w = Math.max(2, width)
  const h = Math.max(2, height)
  const sw = strokeWidth
  const common = {
    fill,
    stroke,
    strokeWidth: selected ? sw + 1 : sw,
    strokeDasharray: dashed ? '7 5' : undefined,
    strokeLinejoin: 'round' as const,
  }
  const inset = sw / 2 + 0.5
  const W = w - inset * 2
  const H = h - inset * 2
  const ox = inset
  const oy = inset

  let body: ReactElement | null = null

  switch (shape) {
    case 'rect':
    case 'text':
      body = <rect x={ox} y={oy} width={W} height={H} rx={12} {...common} fill={shape === 'text' ? 'none' : fill} stroke={shape === 'text' ? 'none' : stroke} />
      break
    case 'round':
      body = <rect x={ox} y={oy} width={W} height={H} rx={Math.min(16, H / 2)} {...common} />
      break
    case 'stadium':
      body = <rect x={ox} y={oy} width={W} height={H} rx={H / 2} {...common} />
      break
    case 'subroutine':
      body = (
        <g>
          <rect x={ox} y={oy} width={W} height={H} rx={4} {...common} />
          <line x1={ox + 12} y1={oy} x2={ox + 12} y2={oy + H} stroke={stroke} strokeWidth={sw} />
          <line x1={ox + W - 12} y1={oy} x2={ox + W - 12} y2={oy + H} stroke={stroke} strokeWidth={sw} />
        </g>
      )
      break
    case 'cylinder': {
      const ry = Math.min(14, H * 0.18)
      const rx = W / 2
      body = (
        <g>
          <path
            d={`M${ox},${oy + ry} a${rx},${ry} 0 0 1 ${W},0 v${H - ry * 2} a${rx},${ry} 0 0 1 ${-W},0 z`}
            {...common}
          />
          <path d={`M${ox},${oy + ry} a${rx},${ry} 0 0 0 ${W},0`} fill="none" stroke={stroke} strokeWidth={sw} />
        </g>
      )
      break
    }
    case 'circle':
      body = <ellipse cx={ox + W / 2} cy={oy + H / 2} rx={W / 2} ry={H / 2} {...common} />
      break
    case 'doublecircle':
      body = (
        <g>
          <ellipse cx={ox + W / 2} cy={oy + H / 2} rx={W / 2} ry={H / 2} {...common} />
          <ellipse
            cx={ox + W / 2}
            cy={oy + H / 2}
            rx={Math.max(1, W / 2 - 6)}
            ry={Math.max(1, H / 2 - 6)}
            fill="none"
            stroke={stroke}
            strokeWidth={sw}
          />
        </g>
      )
      break
    case 'diamond':
      body = (
        <polygon
          points={`${ox + W / 2},${oy} ${ox + W},${oy + H / 2} ${ox + W / 2},${oy + H} ${ox},${oy + H / 2}`}
          {...common}
        />
      )
      break
    case 'hexagon':
      body = (
        <polygon
          points={`${ox + W * 0.18},${oy} ${ox + W * 0.82},${oy} ${ox + W},${oy + H / 2} ${ox + W * 0.82},${oy + H} ${ox + W * 0.18},${oy + H} ${ox},${oy + H / 2}`}
          {...common}
        />
      )
      break
    case 'parallelogram':
      body = (
        <polygon
          points={`${ox + W * 0.18},${oy} ${ox + W},${oy} ${ox + W * 0.82},${oy + H} ${ox},${oy + H}`}
          {...common}
        />
      )
      break
    case 'parallelogram-alt':
      body = (
        <polygon
          points={`${ox},${oy} ${ox + W * 0.82},${oy} ${ox + W},${oy + H} ${ox + W * 0.18},${oy + H}`}
          {...common}
        />
      )
      break
    case 'trapezoid':
      body = (
        <polygon
          points={`${ox + W * 0.18},${oy} ${ox + W * 0.82},${oy} ${ox + W},${oy + H} ${ox},${oy + H}`}
          {...common}
        />
      )
      break
    case 'trapezoid-alt':
      body = (
        <polygon
          points={`${ox},${oy} ${ox + W},${oy} ${ox + W * 0.82},${oy + H} ${ox + W * 0.18},${oy + H}`}
          {...common}
        />
      )
      break
    case 'asymmetric':
      body = (
        <polygon
          points={`${ox},${oy} ${ox + W},${oy} ${ox + W * 0.86},${oy + H} ${ox},${oy + H}`}
          {...common}
        />
      )
      break
    case 'group':
      body = <rect x={ox} y={oy} width={W} height={H} rx={14} {...common} strokeDasharray="10 6" />
      break
    default:
      body = <rect x={ox} y={oy} width={W} height={H} rx={12} {...common} />
  }

  return (
    <svg
      className="shape-frame"
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      style={{ position: 'absolute', inset: 0, overflow: 'visible', pointerEvents: 'none', ...style }}
    >
      {body}
    </svg>
  )
}

/** 调色板里的小缩略图 */
export function ShapeThumb({ shape, fill, stroke, size = 26 }: { shape: ShapeKind; fill: string; stroke: string; size?: number }) {
  const h = Math.round(size * 0.72)
  return (
    <span className="shape-thumb" style={{ width: size, height: h, display: 'inline-block', position: 'relative' }}>
      <ShapeFrame shape={shape} width={size} height={h} fill={fill === 'transparent' ? 'none' : fill} stroke={stroke} strokeWidth={1.6} />
    </span>
  )
}
