import { useEffect } from 'react'
import { Toolbar } from './components/Toolbar'
import { Palette } from './components/Palette'
import { Canvas } from './components/Canvas'
import { GraphView } from './components/GraphView'
import { Inspector } from './components/Inspector'
import { CodePanel, MermaidPreview } from './components/CodePanel'
import { BlocksPanel } from './components/BlocksPanel'
import { LayersPanel } from './components/LayersPanel'
import { FilesPanel } from './components/FilesPanel'
import { BlockEditorDialog } from './components/BlockEditorDialog'
import { SaveDialog } from './components/SaveDialog'
import { TimelinePanel } from './components/TimelinePanel'
import { useStore } from './store'

export default function App() {
  const theme = useStore((s) => s.settings.theme)
  const skin = useStore((s) => s.settings.skin)
  const viewMode = useStore((s) => s.settings.viewMode)
  const rightOpen = useStore((s) => s.rightOpen)
  const rightTab = useStore((s) => s.rightTab)
  const setRightTab = useStore((s) => s.setRightTab)
  const paletteOpen = useStore((s) => s.paletteOpen)
  const togglePalette = useStore((s) => s.togglePalette)
  const toggleRight = useStore((s) => s.toggleRight)
  const toasts = useStore((s) => s.toasts)
  const dismissToast = useStore((s) => s.dismissToast)
  const undo = useStore((s) => s.undo)
  const redo = useStore((s) => s.redo)
  const openSaveDialog = useStore((s) => s.openSaveDialog)
  const autoSaveIntervalSec = useStore((s) => s.settings.autoSaveIntervalSec)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.documentElement.dataset.skin = skin
  }, [theme, skin])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      const mod = e.metaKey || e.ctrlKey
      if (!mod) return
      const key = e.key.toLowerCase()
      if (key === 's') {
        e.preventDefault()
        openSaveDialog()
        return
      }
      if (typing) return
      if (key === 'z') {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
      }
      if (key === 'y') {
        e.preventDefault()
        redo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo, redo, openSaveDialog])

  // 打开页面后恢复上次选定的保存文件（浏览器要求点一次授权才能继续写）
  useEffect(() => {
    void useStore.getState().refreshFileTarget()
  }, [])

  // 定时把改动写进当前图表选定的文件（默认就是自动保存，没有开关）
  useEffect(() => {
    const timer = setInterval(() => {
      void useStore.getState().autoSaveToFile()
    }, Math.max(10, autoSaveIntervalSec) * 1000)
    return () => clearInterval(timer)
  }, [autoSaveIntervalSec])

  // 右侧面板的标签：图层 / 节点块这两个面板先收起来（左侧调色板已经覆盖了日常用法）
  const RIGHT_TABS = [
    ['inspector', '检查器'],
    ['code', '语法'],
    ['files', '保存'],
  ] as const

  const panel = () => {
    switch (rightTab) {
      // 这两个面板的标签已收起；保留渲染分支，临时需要时 setRightTab('layers' | 'blocks') 还能看到
      case 'layers':
        return <LayersPanel />
      case 'blocks':
        return <BlocksPanel />
      case 'code':
        return <CodePanel />
      case 'preview':
        return <MermaidPreview />
      case 'files':
        return <FilesPanel />
      default:
        return <Inspector />
    }
  }

  return (
    <div className="ms-app">
      <Toolbar />
      <div className="ms-main">
        {paletteOpen ? <Palette /> : null}
        <div className="ms-canvas-col">
          {viewMode === 'graph' ? <GraphView /> : <Canvas />}
          {viewMode === 'flow' ? <TimelinePanel /> : null}
        </div>
        {!paletteOpen ? (
          <button className="ms-rail ms-rail--left" onClick={togglePalette} title="展开节点块（左栏）" aria-label="展开左栏">
            ›
          </button>
        ) : null}
        {!rightOpen ? (
          <button className="ms-rail ms-rail--right" onClick={toggleRight} title="展开检查器（右栏）" aria-label="展开右栏">
            ‹
          </button>
        ) : null}
        {rightOpen ? (
          <aside className="ms-right">
            <div className="ms-right-tabs" role="tablist" aria-label="右侧面板">
              {RIGHT_TABS.map(([tab, label]) => (
                <button
                  key={tab}
                  role="tab"
                  aria-selected={rightTab === tab}
                  className={`ms-tab${rightTab === tab ? ' is-active' : ''}`}
                  onClick={() => setRightTab(tab)}
                >
                  {label}
                </button>
              ))}
              <button
                className="ms-icon-btn ms-right-tabs__collapse"
                onClick={toggleRight}
                title="收起右栏（全视图）"
                aria-label="收起右栏"
              >
                ›
              </button>
            </div>
            <div className="ms-right-body">{panel()}</div>
          </aside>
        ) : null}
      </div>
      <BlockEditorDialog />
      <SaveDialog />
      <div className="ms-toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`ms-toast ms-toast--${t.kind}`} onClick={() => dismissToast(t.id)}>
            {t.message}
          </div>
        ))}
      </div>
    </div>
  )
}
