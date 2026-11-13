import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../store'
import { download, pickFile, readText, safeFileName } from '../blocks/registry'
import { extractMermaidFromMarkdown, parseMermaid } from '../lib/mermaid'
import { renderDiagram } from '../lib/render'

export function CodePanel() {
  const doc = useStore((s) => s.doc)
  const customBlocks = useStore((s) => s.customBlocks)
  const includeStyles = useStore((s) => s.settings.includeStyles)
  const updateSettings = useStore((s) => s.updateSettings)
  const importMermaid = useStore((s) => s.importMermaid)
  const renameDoc = useStore((s) => s.renameDoc)
  const toast = useStore((s) => s.toast)

  const generated = useMemo(() => {
    void customBlocks
    return useStore.getState().currentMermaid(includeStyles)
  }, [doc, customBlocks, includeStyles])

  const [draft, setDraft] = useState(generated)
  const [manual, setManual] = useState(false)

  useEffect(() => {
    if (!manual) setDraft(generated)
  }, [generated, manual])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(draft)
      toast('Mermaid 语法已复制', 'success')
    } catch {
      toast('复制失败，请手动选择复制', 'error')
    }
  }

  const importFile = async () => {
    const file = await pickFile('.mmd,.mermaid,.md,.markdown,.txt,text/plain')
    if (!file) return
    try {
      const raw = await readText(file)
      // .md 里抽 ```mermaid 围栏；.mmd 直接用
      const { code, title } = extractMermaidFromMarkdown(raw)
      if (!code) {
        toast('这个文件里没有 Mermaid 内容', 'error')
        return
      }
      setDraft(code)
      setManual(true)
      if (title && title !== doc.name) renameDoc(title)
      const res = importMermaid(code)
      if (res.ok) toast(`已从「${file.name}」导入到画布`, 'success')
    } catch (err) {
      toast((err as Error).message, 'error')
    }
  }

  return (
    <div className="ms-panel-body ms-panel-body--code">
      <div className="ms-code-actions">
        <label className="ms-switch">
          <input
            type="checkbox"
            checked={includeStyles}
            onChange={(e) => updateSettings({ includeStyles: e.target.checked })}
          />
          输出颜色样式
        </label>
        <label className="ms-switch">
          <input
            type="checkbox"
            checked={manual}
            onChange={(e) => {
              setManual(e.target.checked)
              if (!e.target.checked) setDraft(generated)
            }}
          />
          手动编辑
        </label>
      </div>

      <textarea
        className="ms-code"
        spellCheck={false}
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value)
          setManual(true)
        }}
      />

      <div className="ms-btn-row">
        <button className="ms-btn" onClick={copy}>
          复制
        </button>
        <button
          className="ms-btn"
          onClick={() => download(safeFileName(doc.name, '.mmd'), draft, 'text/plain;charset=utf-8')}
        >
          下载 .mmd
        </button>
        <button className="ms-btn" onClick={importFile} title="支持 .mmd 和带 mermaid 代码块的 .md">
          导入 .md / .mmd
        </button>
        <button
          className="ms-btn ms-btn--primary"
          onClick={() => {
            importMermaid(draft)
          }}
        >
          解析到画布
        </button>
      </div>

      <details className="ms-details">
        <summary>语法速查</summary>
        <pre className="ms-pre">{`flowchart TD
  A["开始"] --> B{"判断"}
  B -->|是| C(["完成"])
  C --> D[(数据库)]
  subgraph G1["分组"]
    C
  end
  classDef red fill:#fee,stroke:#c00
  A:::red
  linkStyle 0 stroke:#f00`}</pre>
      </details>
    </div>
  )
}

export function MermaidPreview() {
  const doc = useStore((s) => s.doc)
  const customBlocks = useStore((s) => s.customBlocks)
  const includeStyles = useStore((s) => s.settings.includeStyles)
  const theme = useStore((s) => s.settings.theme)
  const [svg, setSvg] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [engineUsed, setEngineUsed] = useState<{ engine: string; ms: number; fallback?: string } | null>(null)
  const renderEngine = useStore((s) => s.settings.renderEngine)
  const skin = useStore((s) => s.settings.skin)

  const code = useMemo(() => {
    void customBlocks
    return useStore.getState().currentMermaid(includeStyles)
  }, [doc, customBlocks, includeStyles])

  useEffect(() => {
    let cancelled = false
    const render = async () => {
      try {
        const out = await renderDiagram({ code, dark: theme === 'dark', engine: renderEngine, skin, inlineTheme: true })
        if (!cancelled) {
          setSvg(out.svg)
          setError(null)
          setEngineUsed({ engine: out.engine, ms: out.ms, fallback: out.fallbackReason })
        }
      } catch (err) {
        if (!cancelled) {
          setError((err as Error).message)
          setSvg('')
        }
      }
    }
    const timer = setTimeout(render, 160)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [code, theme, renderEngine, skin])

  return (
    <div className="ms-panel-body ms-panel-body--preview">
      {error ? (
        <div className="ms-alert ms-alert--error">
          <strong>Mermaid 渲染失败</strong>
          <pre className="ms-pre">{error}</pre>
        </div>
      ) : null}
      <div className="ms-preview" dangerouslySetInnerHTML={{ __html: svg }} />
      {!svg && !error ? <div className="ms-muted">渲染中…</div> : null}
      {engineUsed ? (
        <div className="ms-hint ms-render-meta">
          渲染引擎：{engineUsed.engine} · {engineUsed.ms} ms
          {engineUsed.fallback ? `（pele 失败已回退：${engineUsed.fallback}）` : ''}
        </div>
      ) : null}
      <div className="ms-hint">预览基于当前画布生成的 Mermaid 语法，实时刷新。</div>
      <div className="ms-hint">检测到 {parseMermaid(code).nodes.length} 个节点</div>
    </div>
  )
}
