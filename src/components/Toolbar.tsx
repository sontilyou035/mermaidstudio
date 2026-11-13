import { useState } from 'react'
import { useStore } from '../store'
import { DIRECTION_LABELS, type Direction } from '../types'
import { download, safeFileName } from '../blocks/registry'
import { getRfInstance } from '../lib/rf'

export function Toolbar() {
  const doc = useStore((s) => s.doc)
  const dirty = useStore((s) => s.dirty)
  const theme = useStore((s) => s.settings.theme)
  const past = useStore((s) => s.past.length)
  const future = useStore((s) => s.future.length)
  const setRightTab = useStore((s) => s.setRightTab)
  const toggleTheme = useStore((s) => s.toggleTheme)
  const skin = useStore((s) => s.settings.skin)
  const renameDoc = useStore((s) => s.renameDoc)
  const newDoc = useStore((s) => s.newDoc)
  const openSaveDialog = useStore((s) => s.openSaveDialog)
  const updateSettings = useStore((s) => s.updateSettings)
  const undo = useStore((s) => s.undo)
  const redo = useStore((s) => s.redo)
  const runAutoLayout = useStore((s) => s.runAutoLayout)
  const setDirection = useStore((s) => s.setDirection)
  const exportProjectJson = useStore((s) => s.exportProjectJson)
  const currentMermaid = useStore((s) => s.currentMermaid)
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <header className="ms-topbar">
      <div className="ms-brand">
        <img className="ms-brand__logo" src="/logo.svg" alt="" width={22} height={22} />
        <span className="ms-brand__name">Mermaid Studio</span>
      </div>

      <input
        className="ms-input ms-input--docname"
        value={doc.name}
        onChange={(e) => renameDoc(e.target.value)}
        title="图表名称"
      />
      {dirty ? <span className="ms-dot" title="有未保存的改动" /> : null}

      <div className="ms-topbar__group">
        <button className="ms-btn ms-btn--sm" onClick={newDoc} title="新建空白图表">
          新建
        </button>
        <button
          className="ms-btn ms-btn--sm ms-btn--primary"
          onClick={openSaveDialog}
          title="保存：可选本地目录，默认导出含 mermaid 代码块的 .md (Ctrl/Cmd+S)"
        >
          保存…
        </button>
      </div>

      <div className="ms-topbar__group">
        <button className="ms-btn ms-btn--sm" disabled={!past} onClick={undo} title="撤销 (Ctrl/Cmd+Z)">
          ↶ 撤销
        </button>
        <button className="ms-btn ms-btn--sm" disabled={!future} onClick={redo} title="重做 (Ctrl/Cmd+Shift+Z)">
          ↷ 重做
        </button>
      </div>

      <div className="ms-topbar__group">
        <button className="ms-btn ms-btn--sm" onClick={runAutoLayout} title="用 dagre 重新排版">
          ✦ 自动布局
        </button>
        <select
          className="ms-input ms-input--compact"
          value={doc.direction}
          onChange={(e) => setDirection(e.target.value as Direction)}
          title="布局方向"
        >
          {Object.entries(DIRECTION_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <button className="ms-btn ms-btn--sm" onClick={() => getRfInstance()?.fitView({ padding: 0.25, duration: 300 })}>
          适应视图
        </button>
      </div>

      <div className="ms-topbar__spacer" />

      <div className="ms-topbar__group">
        <div className="ms-menu">
          <button className="ms-btn ms-btn--sm" onClick={() => setMenuOpen((v) => !v)}>
            导入 / 导出 ▾
          </button>
          {menuOpen ? (
            <div className="ms-menu__pop" onMouseLeave={() => setMenuOpen(false)}>
              <button
                className="ms-menu__item"
                onClick={() => {
                  download(safeFileName(doc.name, '.mermaid.json'), exportProjectJson(), 'application/json')
                  setMenuOpen(false)
                }}
              >
                导出工程文件 .json
              </button>
              <button
                className="ms-menu__item"
                onClick={() => {
                  download(safeFileName(doc.name, '.mmd'), currentMermaid(), 'text/plain;charset=utf-8')
                  setMenuOpen(false)
                }}
              >
                导出 Mermaid .mmd
              </button>
              <button
                className="ms-menu__item"
                onClick={() => {
                  setRightTab('files')
                  setMenuOpen(false)
                }}
              >
                更多导出（SVG / PNG）…
              </button>
              <button
                className="ms-menu__item"
                onClick={() => {
                  setRightTab('code')
                  setMenuOpen(false)
                }}
              >
                导入 Mermaid 语法…
              </button>
              <button
                className="ms-menu__item"
                onClick={() => {
                  setRightTab('files')
                  setMenuOpen(false)
                }}
              >
                导入工程文件…
              </button>
            </div>
          ) : null}
        </div>
      </div>

      <button
        className="ms-btn ms-btn--sm"
        onClick={() => updateSettings({ skin: skin === 'warm' ? 'cool' : 'warm' })}
        title={skin === 'warm' ? '当前：暖色皮肤（陶土橙）。点一下切回冷色' : '当前：冷色皮肤。点一下切到暖色（陶土橙）'}
      >
        {skin === 'warm' ? '🎨 暖' : '🎨 冷'}
      </button>

      <button className="ms-icon-btn ms-icon-btn--lg" onClick={toggleTheme} title="切换深浅色">
        {theme === 'dark' ? '☀️' : '🌙'}
      </button>
    </header>
  )
}
