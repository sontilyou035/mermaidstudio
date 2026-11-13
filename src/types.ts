import type { Edge, Node, Viewport } from '@xyflow/react'

/* ------------------------------------------------------------------ *
 * 形状（与 Mermaid flowchart 的节点语法一一对应）
 * ------------------------------------------------------------------ */

export type ShapeKind =
  | 'rect' // [ ]
  | 'round' // ( )
  | 'stadium' // ([ ])
  | 'subroutine' // [[ ]]
  | 'cylinder' // [( )]
  | 'circle' // (( ))
  | 'doublecircle' // ((( )))
  | 'diamond' // { }
  | 'hexagon' // {{ }}
  | 'parallelogram' // [/ /]
  | 'parallelogram-alt' // [\ \]
  | 'trapezoid' // [/ \]
  | 'trapezoid-alt' // [\ /]
  | 'asymmetric' // > ]
  | 'text' // 纯文本（无边框）
  | 'group' // subgraph 容器

export interface ShapeWrap {
  open: string
  close: string
}

/** 每种形状对应的 Mermaid 包装符号 */
export const SHAPE_WRAP: Record<ShapeKind, ShapeWrap> = {
  rect: { open: '[', close: ']' },
  round: { open: '(', close: ')' },
  stadium: { open: '([', close: '])' },
  subroutine: { open: '[[', close: ']]' },
  cylinder: { open: '[(', close: ')]' },
  circle: { open: '((', close: '))' },
  doublecircle: { open: '(((', close: ')))' },
  diamond: { open: '{', close: '}' },
  hexagon: { open: '{{', close: '}}' },
  parallelogram: { open: '[/', close: '/]' },
  'parallelogram-alt': { open: '[\\', close: '\\]' },
  trapezoid: { open: '[/', close: '\\]' },
  'trapezoid-alt': { open: '[\\', close: '/]' },
  asymmetric: { open: '>', close: ']' },
  text: { open: '[', close: ']' },
  group: { open: '[', close: ']' },
}

export const SHAPE_LABELS: Record<ShapeKind, string> = {
  rect: '矩形',
  round: '圆角矩形',
  stadium: '胶囊 / 起止',
  subroutine: '子流程',
  cylinder: '圆柱 / 数据库',
  circle: '圆形',
  doublecircle: '双圆',
  diamond: '菱形 / 判断',
  hexagon: '六边形 / 准备',
  parallelogram: '平行四边形 / 输入输出',
  'parallelogram-alt': '反向平行四边形',
  trapezoid: '梯形',
  'trapezoid-alt': '反向梯形 / 手动操作',
  asymmetric: '旗形 / 文档',
  text: '纯文本',
  group: '分组容器',
}

export const SHAPE_KINDS = Object.keys(SHAPE_WRAP) as ShapeKind[]

/* ------------------------------------------------------------------ *
 * 端口（连接点）
 * ------------------------------------------------------------------ */

export type PortPosition = 'top' | 'right' | 'bottom' | 'left'
export type PortKind = 'source' | 'target' | 'both'

export interface Port {
  id: string
  position: PortPosition
  kind: PortKind
  label?: string
}

export const DEFAULT_PORTS: Port[] = [
  { id: 'top', position: 'top', kind: 'both' },
  { id: 'right', position: 'right', kind: 'both' },
  { id: 'bottom', position: 'bottom', kind: 'both' },
  { id: 'left', position: 'left', kind: 'both' },
]

/* ------------------------------------------------------------------ *
 * 节点块定义（自定义 node block 的核心结构）
 * ------------------------------------------------------------------ */

export type FieldType = 'text' | 'number' | 'select' | 'boolean' | 'longtext'

export interface BlockField {
  key: string
  label: string
  type: FieldType
  options?: string[]
  default?: string
  placeholder?: string
}

export interface BlockDef {
  /** 稳定 id，节点通过 blockId 引用它 */
  id: string
  name: string
  category: string
  /** 内置块不可删除，但可以“复制为自定义块”后再改 */
  builtin?: boolean
  icon: string
  description?: string
  shape: ShapeKind
  /** 'subgraph' 的块会被序列化成 subgraph ... end */
  kind: 'node' | 'subgraph'
  /** 渲染方式：默认按形状；'card' Onevra 卡片；'table' 表格；'json' 结构体 */
  layout?: 'default' | 'card' | 'table' | 'json'
  fill: string
  stroke: string
  textColor: string
  width: number
  height: number
  /** 额外字段：会出现在检查器里，可通过 {{key}} 用在标签模板 / Mermaid 模板中 */
  fields: BlockField[]
  ports: Port[]
  /** 标签模板，支持 {{label}} 与 {{字段key}}，可用 \n 换行 */
  labelTemplate?: string
  /** 覆盖形状默认包装符，例如 {open:'[', close:']'} */
  mermaidWrap?: ShapeWrap | null
  /** 完全自定义 Mermaid 行模板：{{id}} {{label}} {{open}} {{close}} {{shape}} {{字段key}} */
  mermaidTemplate?: string
  /** 语义样式类（role / action / process / table / job / mq / external），导出时用固定 classDef */
  className?: string
  /** 自动生成节点 ID 用的前缀（r_ / a_ / p_ / t_ / j_ / m_ / x_ / d_ / rd_ / f_ …） */
  idPrefix?: string
  /** 自定义 classDef 样式体（没设 className 时生效），例如 "fill:#eef,stroke:#66f" */
  classDef?: string
  /** 使用该块时附加在文档末尾的原始 Mermaid 行（高级用法） */
  extraLines?: string[]
  updatedAt?: number
}

/* ------------------------------------------------------------------ *
 * 图数据
 * ------------------------------------------------------------------ */

export type Direction = 'TB' | 'LR' | 'BT' | 'RL'

export interface NodeData extends Record<string, unknown> {
  blockId: string
  label: string
  values: Record<string, string>
  fill: string
  stroke: string
  textColor: string
  shape: ShapeKind
  width: number
  height: number
  isSubgraph?: boolean
  /** 所属分组（subgraph）节点的 id，显式维护，便于精确序列化 */
  groupId?: string | null
  /** 图层里隐藏的元素（不参与显示，但仍保留在数据里） */
  hidden?: boolean
  /** 图层里锁定的元素（不可拖动/删除） */
  locked?: boolean
}

export type CurveKind = 'bezier' | 'straight' | 'step' | 'smoothstep' | 'simplebezier'
export type LineStyle = 'solid' | 'dashed' | 'thick'
export type MarkerKind = 'none' | 'arrow' | 'circle' | 'cross'

export interface EdgeData extends Record<string, unknown> {
  /** 连线类型（十种规范类型之一），标签格式 `类型` 或 `类型: 说明` */
  type?: string
  /** 标签里的说明部分 */
  note?: string
  curve: CurveKind
  lineStyle: LineStyle
  startMarker: MarkerKind
  endMarker: MarkerKind
  stroke: string
  strokeWidth: number
  animated?: boolean
  label?: string
  /**
   * 手动拐点（画布坐标）。有线走位需求时可以自己拖出几个点让连线绕开别的线；
   * 只存在画布数据里，Mermaid 不描述走向，导出语法时直接忽略。
   */
  waypoints?: Array<{ x: number; y: number }>
  /**
   * 连接口归属：auto = 按骨架方向自动分配（上进下出 / 左进右出），
   * manual = 用户拖过端点或在检查器里指定过，不再被自动流程覆盖。
   */
  handleMode?: 'auto' | 'manual'
}

export type FlowNode = Node<NodeData>
export type FlowEdge = Edge<EdgeData>

/* ---------------- 剧本（时间轴演示） ---------------- */

/** 一次字段变更：哪张表（节点）、哪个字段、变成什么值 */
export interface ScenarioChange {
  /** 表名（导入 JSON 里的原始名字，用于人工绑定与导出） */
  table: string
  /** 对应的数据表节点 id（导入时自动匹配，匹配不上为空） */
  nodeId?: string
  field: string
  value: string
}

/** 一次页面操作：开始时刻 + 持续时长 + 涉及节点 + 一次或多次字段变更 */
export interface ScenarioEvent {
  id: string
  name: string
  startMs: number
  durationMs: number
  nodeIds: string[]
  changes: ScenarioChange[]
}

export interface Timeline {
  version: 1
  totalMs: number
  events: ScenarioEvent[]
  /** 核心表（保留的表节点 id 集合）；未勾选表的变更只在导出时被过滤 */
  coreTables: string[]
  /** 被人工删除的事件 id */
  removedEventIds: string[]
}

export interface DiagramDoc {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  direction: Direction
  nodes: FlowNode[]
  edges: FlowEdge[]
  viewport?: Viewport
  /** 剧本（时间轴演示），可选，老文档没有 */
  timeline?: Timeline
}

export interface DocMeta {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  nodeCount: number
  edgeCount: number
}

/** 导出的工程文件（.mermaid.json），包含图与自定义块 */
export interface ProjectFile {
  kind: 'mermaid-studio-project'
  version: 1
  exportedAt: number
  doc: DiagramDoc
  customBlocks: BlockDef[]
}

/* ------------------------------------------------------------------ *
 * 常量
 * ------------------------------------------------------------------ */

export const CURVE_LABELS: Record<CurveKind, string> = {
  bezier: '贝塞尔',
  straight: '直线',
  step: '折线',
  smoothstep: '平滑折线',
  simplebezier: '简单贝塞尔',
}

export const LINE_STYLE_LABELS: Record<LineStyle, string> = {
  solid: '实线',
  dashed: '虚线',
  thick: '加粗',
}

export const MARKER_LABELS: Record<MarkerKind, string> = {
  none: '无',
  arrow: '箭头',
  circle: '圆点',
  cross: '叉号',
}

export const DIRECTION_LABELS: Record<Direction, string> = {
  TB: '从上到下',
  LR: '从左到右',
  BT: '从下到上',
  RL: '从右到左',
}

export const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  text: '文本',
  longtext: '多行文本',
  number: '数字',
  select: '下拉',
  boolean: '开关',
}

export const DEFAULT_EDGE_DATA: EdgeData = {
  type: '',
  note: '',
  curve: 'smoothstep',
  lineStyle: 'solid',
  startMarker: 'none',
  endMarker: 'arrow',
  stroke: '#64748b',
  strokeWidth: 2,
  animated: false,
  label: '',
}
