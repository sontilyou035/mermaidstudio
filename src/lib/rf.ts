/** 只暴露我们用得到的方法，避免 React Flow 泛型到处传染 */
export interface RfHandle {
  fitView: (options?: Record<string, unknown>) => void
  getViewport: () => { x: number; y: number; zoom: number }
  screenToFlowPosition: (position: { x: number; y: number }) => { x: number; y: number }
}

let instance: RfHandle | null = null

export function setRfInstance(i: RfHandle | null) {
  instance = i
}

export function getRfInstance(): RfHandle | null {
  return instance
}

/** 视口中心（用于「点击调色板添加节点」时定位） */
export function viewportCenter(): { x: number; y: number } {
  if (!instance) return { x: 120, y: 120 }
  const { x, y, zoom } = instance.getViewport()
  const el = document.querySelector('.react-flow')
  const w = el?.clientWidth ?? 900
  const h = el?.clientHeight ?? 600
  return { x: (w / 2 - x) / zoom, y: (h / 2 - y) / zoom }
}
