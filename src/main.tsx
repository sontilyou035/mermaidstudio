import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { useStore } from './store'
import './styles.css'

// 把 store 和几个纯函数挂到 window：方便在浏览器控制台排障，也供自动化脚本驱动（本地工具，无安全顾虑）。
// 注意：脚本不能 import('/src/lib/*.ts')——那只在 Vite dev 下有效，生产静态服务只有打包产物。
import { buildMarkdown, mergeManagedSections } from './lib/exporters'
import { extractMermaidFromMarkdown } from './lib/mermaid'
import { CANONICAL_EDGE_TYPES, normalizeEdgeType, suggestEdgeType } from './lib/edgeLabels'
;(window as unknown as Record<string, unknown>).__ms = {
  store: useStore,
  buildMarkdown,
  mergeManagedSections,
  extractMermaidFromMarkdown,
  CANONICAL_EDGE_TYPES,
  normalizeEdgeType,
  suggestEdgeType,
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
