import { useState } from 'react'
import { useStore } from '../store'
import { download, downloadBlob, pickFile, readText, safeFileName } from '../blocks/registry'
import { storageBytes } from '../lib/storage'
import { buildMarkdown, renderMermaidSvg, svgToPngBlob } from '../lib/exporters'
import { backupFileName } from '../lib/backup'
import { allBlocks } from '../blocks/registry'

function formatTime(ts: number) {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function FilesPanel() {
  const doc = useStore((s) => s.doc)
  const index = useStore((s) => s.index)
  const dirty = useStore((s) => s.dirty)
  const savedAt = useStore((s) => s.savedAt)
  const customBlocks = useStore((s) => s.customBlocks)
  const theme = useStore((s) => s.settings.theme)
  const saveNow = useStore((s) => s.saveNow)
  const openSaveDialog = useStore((s) => s.openSaveDialog)
  const newDoc = useStore((s) => s.newDoc)
  const loadSample = useStore((s) => s.loadSample)
  const openDoc = useStore((s) => s.openDoc)
  const deleteDoc = useStore((s) => s.deleteDoc)
  const duplicateDoc = useStore((s) => s.duplicateDoc)
  const renameDocById = useStore((s) => s.renameDocById)
  const exportProjectJson = useStore((s) => s.exportProjectJson)
  const importProjectJson = useStore((s) => s.importProjectJson)
  const exportAllData = useStore((s) => s.exportAllData)
  const importAllData = useStore((s) => s.importAllData)
  const currentMermaid = useStore((s) => s.currentMermaid)
  const toast = useStore((s) => s.toast)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  const metas = index.order.map((id) => index.metas[id]).filter(Boolean)
  const bytes = storageBytes()

  const renderEngine = useStore((s) => s.settings.renderEngine)
  const skin = useStore((s) => s.settings.skin)

  const exportSvgFile = async () => {
    try {
      const svg = await renderMermaidSvg(currentMermaid(), theme === 'dark', renderEngine, skin)
      download(safeFileName(doc.name, '.svg'), svg, 'image/svg+xml;charset=utf-8')
    } catch (err) {
      toast(`导出 SVG 失败：${(err as Error).message}`, 'error')
    }
  }

  const exportPngFile = async () => {
    try {
      const blob = await svgToPngBlob(await renderMermaidSvg(currentMermaid(), theme === 'dark', renderEngine, skin), theme === 'dark')
      downloadBlob(safeFileName(doc.name, '.png'), blob)
    } catch (err) {
      toast(`导出 PNG 失败：${(err as Error).message}`, 'error')
    }
  }

  const exportBackup = () => {
    download(backupFileName(), exportAllData(), 'application/json')
    toast(`已导出 ${index.order.length} 份图表的备份包`, 'success')
  }

  const importBackup = async () => {
    const file = await pickFile('.json,application/json')
    if (!file) return
    try {
      importAllData(await readText(file))
    } catch (err) {
      toast(`导入备份失败：${(err as Error).message}`, 'error')
    }
  }

  const exportMarkdownFile = () => {
    const md = buildMarkdown(doc, allBlocks(customBlocks), currentMermaid())
    download(safeFileName(doc.name, '.md'), md, 'text/markdown;charset=utf-8')
  }

  const importProject = async () => {
    const file = await pickFile('.json,application/json')
    if (!file) return
    importProjectJson(await readText(file))
  }

  return (
    <div className="ms-panel-body">
      <div className="ms-section-title">保存</div>
      <div className="ms-savebar">
        <button className="ms-btn ms-btn--primary" onClick={saveNow}>
          {dirty ? '● 保存到本地' : '已保存'}
        </button>
        <span className="ms-hint">
          {savedAt ? `上次保存 ${formatTime(savedAt)}` : dirty ? '有未保存改动' : '自动保存已开启'}
        </span>
      </div>
      <div className="ms-hint">所有图表自动保存在浏览器本地（localStorage），关闭页面不会丢失。</div>

      <div className="ms-btn-row">
        <button className="ms-btn" onClick={newDoc}>
          ＋ 新建图表
        </button>
        <button className="ms-btn" onClick={duplicateDoc}>
          ⧉ 复制当前
        </button>
        <button className="ms-btn" onClick={loadSample}>
          载入示例
        </button>
      </div>

      <div className="ms-section-title">
        我的图表
        <span className="ms-section-title__count">{metas.length}</span>
      </div>
      <div className="ms-doclist">
        {metas.length === 0 ? <div className="ms-muted">还没有保存的图表</div> : null}
        {metas.map((m) => (
          <div key={m.id} className={`ms-docitem${m.id === doc.id ? ' is-active' : ''}`}>
            {renaming === m.id ? (
              <input
                className="ms-input"
                autoFocus
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onBlur={() => setRenaming(null)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    renameDocById(m.id, renameValue)
                    setRenaming(null)
                  }
                  if (e.key === 'Escape') setRenaming(null)
                }}
              />
            ) : (
              <button className="ms-docitem__main" onClick={() => openDoc(m.id)}>
                <span className="ms-docitem__name">{m.name}</span>
                <span className="ms-docitem__meta">
                  {m.nodeCount} 节点 · {m.edgeCount} 连线 · {formatTime(m.updatedAt)}
                </span>
              </button>
            )}
            <span className="ms-docitem__actions">
              <button
                className="ms-icon-btn"
                title="重命名"
                onClick={() => {
                  setRenaming(m.id)
                  setRenameValue(m.name)
                }}
              >
                ✎
              </button>
              <button className="ms-icon-btn ms-icon-btn--danger" title="删除" onClick={() => deleteDoc(m.id)}>
                ✕
              </button>
            </span>
          </div>
        ))}
      </div>

      <div className="ms-section-title">导入 / 导出</div>
      <div className="ms-btn-row">
        <button
          className="ms-btn"
          onClick={() => download(safeFileName(doc.name, '.mermaid.json'), exportProjectJson(), 'application/json')}
        >
          导出工程 .json
        </button>
        <button className="ms-btn" onClick={importProject}>
          导入工程 .json
        </button>
      </div>
      <div className="ms-btn-row">
        <button className="ms-btn ms-btn--primary" onClick={openSaveDialog}>
          保存 / 选择位置…
        </button>
        <button className="ms-btn" onClick={exportMarkdownFile}>
          导出 .md（给 AI）
        </button>
      </div>
      <div className="ms-btn-row">
        <button className="ms-btn" onClick={() => download(safeFileName(doc.name, '.mmd'), currentMermaid(), 'text/plain')}>
          导出 .mmd
        </button>
        <button className="ms-btn" onClick={exportSvgFile}>
          导出 SVG
        </button>
        <button className="ms-btn" onClick={exportPngFile}>
          导出 PNG
        </button>
      </div>
      <div className="ms-hint">
        工程 .json 会同时带上您的 {customBlocks.length} 个自定义节点块，换电脑也能还原。
      </div>

      <div className="ms-section-title">本地数据</div>
      <div className="ms-kv">占用约 {(bytes / 1024).toFixed(1)} KB · 共 {metas.length} 份图表</div>
      <div className="ms-btn-row">
        <button className="ms-btn ms-btn--primary" onClick={exportBackup} title="把所有图表 + 自定义节点块打包成一份备份">
          ⤓ 导出全部图表（备份）
        </button>
        <button className="ms-btn" onClick={importBackup} title="从备份包恢复；同名图表会作为新的一份导入，不覆盖现有数据">
          ⤒ 从备份恢复
        </button>
      </div>
      <div className="ms-hint">
        浏览器本地数据会随「清缓存 / 换浏览器 / 换访问地址」消失，重要图表请定期导一份备份，放到固定目录。
      </div>
      <button
        className="ms-btn ms-btn--danger"
        onClick={() => {
          if (!confirm('确定清空本地所有图表与自定义节点块？此操作不可恢复。')) return
          try {
            Object.keys(localStorage)
              .filter((k) => k.startsWith('mermaid-studio:'))
              .forEach((k) => localStorage.removeItem(k))
          } catch {
            /* ignore */
          }
          location.reload()
        }}
      >
        清空本地数据
      </button>
    </div>
  )
}
