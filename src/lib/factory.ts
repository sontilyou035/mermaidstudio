import type { XYPosition } from '@xyflow/react'
import {
  DEFAULT_EDGE_DATA,
  type DiagramDoc,
  type BlockDef,
  type CurveKind,
  type EdgeData,
  type FlowEdge,
  type FlowNode,
  type NodeData,
} from '../types'
import { blockFallbackWord, blockIdPrefix, structuralNodeHeight, uid } from '../blocks/registry'
import { makeNodeId } from './translate'
import { composeEdgeLabel, normalizeEdgeType } from './edgeLabels'

/** 所有连线共用同一个自定义边组件，曲线样式由 data.curve 决定 */
export const EDGE_TYPE = 'ms'

export const CURVE_TO_RF: Record<CurveKind, string> = {
  bezier: EDGE_TYPE,
  straight: EDGE_TYPE,
  step: EDGE_TYPE,
  smoothstep: EDGE_TYPE,
  simplebezier: EDGE_TYPE,
}

export function nodeFromBlock(
  block: BlockDef,
  position: XYPosition,
  label?: string,
  taken: Set<string> = new Set(),
): FlowNode {
  const values: Record<string, string> = {}
  for (const f of block.fields) values[f.key] = f.default ?? ''
  const height = structuralNodeHeight(block, values)
  const data: NodeData = {
    blockId: block.id,
    label: label ?? block.name,
    values,
    fill: block.fill,
    stroke: block.stroke,
    textColor: block.textColor,
    shape: block.shape,
    width: block.width,
    height,
    isSubgraph: block.kind === 'subgraph',
  }
  return {
    // 语义化 ID：<前缀>_<英文蛇形>_<随机>，例如 p_create_order_k3t9p
    id: makeNodeId(blockIdPrefix(block), label ?? block.name, blockFallbackWord(block), taken),
    type: 'block',
    position,
    data,
    // React Flow 用 node.style 承载真实尺寸（NodeResizer 会直接改它）
    style: { width: block.width, height },
  }
}

/**
 * 兼容旧版本保存的数据：早期节点把尺寸放在 data 里、没有 node.style，
 * 打开时补齐，避免节点退化成按内容自适应。
 */
/** 一张空白文档：打开应用首页时的"新建模式"（不落盘，等真实编辑再保存） */
export function createBlankDoc(): DiagramDoc {
  return {
    id: uid('doc'),
    name: '未命名图表',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    direction: 'TB',
    nodes: [],
    edges: [],
  }
}

export function normalizeDoc(doc: DiagramDoc): DiagramDoc {
  return {
    ...doc,
    nodes: doc.nodes.map((n) =>
      n.style && (n.style as { width?: number }).width
        ? n
        : { ...n, style: { ...(n.style ?? {}), width: n.data.width, height: n.data.height } },
    ),
  }
}

export function edgeFromConnection(
  source: string,
  target: string,
  handles: { sourceHandle?: string | null; targetHandle?: string | null } = {},
  patch: Partial<EdgeData> = {},
): FlowEdge {
  const data: EdgeData = { ...DEFAULT_EDGE_DATA, ...patch }
  // 标签按规范补全：类型 + 可选说明
  data.type = normalizeEdgeType(data.type) || normalizeEdgeType(patch.type ?? '') || ''
  data.label = composeEdgeLabel(data.type, data.note, data.label)
  // 从端口拖出来的边记住用户选的端口；没带端口的（程序生成）交给自动分配
  data.handleMode = handles.sourceHandle || handles.targetHandle ? 'manual' : 'auto'
  return {
    id: uid('e'),
    source,
    target,
    // 记住用户实际拖拽的那两个端口，否则连线会回到节点的默认连接点
    sourceHandle: handles.sourceHandle ?? null,
    targetHandle: handles.targetHandle ?? null,
    type: CURVE_TO_RF[data.curve],
    data,
    label: data.label || undefined,
  }
}

/** 修改边数据后，同步 React Flow 层面的渲染属性 */
export function withEdgeData(edge: FlowEdge, patch: Partial<EdgeData>): FlowEdge {
  const data: EdgeData = { ...DEFAULT_EDGE_DATA, ...edge.data, ...patch }
  // 改了类型 / 说明就重算标签；只改别的字段时保留原标签
  if ('type' in patch || 'note' in patch) {
    const type = normalizeEdgeType(data.type)
    data.type = type
    data.label = composeEdgeLabel(type, data.note, type ? '' : (edge.data?.label ?? ''))
  }
  return {
    ...edge,
    data,
    type: CURVE_TO_RF[data.curve],
    label: data.label?.trim() ? data.label : undefined,
  }
}
