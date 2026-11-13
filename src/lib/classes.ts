/**
 * 固定的语义样式类（classDef）。
 * 导出 Mermaid 时用这些固定的类名和颜色，方便 AI / Obsidian 侧按约定识别节点类型。
 */
export interface SemanticClass {
  name: string
  label: string
  fill: string
  stroke: string
  color: string
  /** 生成到 Mermaid 里的样式体 */
  style: string
  description: string
}

function make(name: string, label: string, fill: string, stroke: string, color: string, description: string): SemanticClass {
  return { name, label, fill, stroke, color, style: `fill:${fill},stroke:${stroke},color:${color}`, description }
}

export const SEMANTIC_CLASSES: SemanticClass[] = [
  make('role', '角色', '#e0e7ff', '#4f46e5', '#312e81', '人 / 岗位'),
  make('action', '人工动作', '#ffedd5', '#ea580c', '#7c2d12', '需要人工介入的操作'),
  make('process', '处理', '#dbeafe', '#2563eb', '#1e3a8a', '系统处理步骤'),
  make('table', '数据表', '#eef2ff', '#4f46e5', '#312e81', '表 / 数据实体'),
  make('job', '作业', '#fef9c3', '#ca8a04', '#713f12', '作业 / 文档 / 单据'),
  make('mq', '起止 / 消息', '#dcfce7', '#16a34a', '#14532d', '开始、结束、消息'),
  make('external', '外部主体', '#f3f4f6', '#6b7280', '#1f2937', '外部系统 / 外部主体'),
]

export const CLASS_BY_NAME: Map<string, SemanticClass> = new Map(SEMANTIC_CLASSES.map((c) => [c.name, c]))

export function semanticClass(name: string | undefined): SemanticClass | undefined {
  return name ? CLASS_BY_NAME.get(name) : undefined
}

/** 导出时按这个顺序输出 classDef，保证每次生成的文档一致 */
export const CLASS_ORDER: string[] = SEMANTIC_CLASSES.map((c) => c.name)
