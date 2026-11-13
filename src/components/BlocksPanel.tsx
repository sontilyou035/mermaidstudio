import { useStore } from '../store'
import { ShapeThumb } from '../lib/shapes'
import { download, pickFile, readText } from '../blocks/registry'
import { BUILTIN_BLOCKS } from '../blocks/builtins'
import { SHAPE_LABELS } from '../types'
import type { BlockDef } from '../types'

export function BlocksPanel() {
  const customBlocks = useStore((s) => s.customBlocks)
  const openBlockEditor = useStore((s) => s.openBlockEditor)
  const deleteBlock = useStore((s) => s.deleteBlock)
  const duplicateBlock = useStore((s) => s.duplicateBlock)
  const resetCustomBlocks = useStore((s) => s.resetCustomBlocks)
  const importBlocks = useStore((s) => s.importBlocks)
  const toast = useStore((s) => s.toast)

  const importFromFile = async () => {
    const file = await pickFile('.json,application/json')
    if (!file) return
    try {
      const parsed = JSON.parse(await readText(file)) as BlockDef[] | { customBlocks: BlockDef[] }
      const list = Array.isArray(parsed) ? parsed : parsed.customBlocks
      if (!Array.isArray(list)) throw new Error('文件里没有节点块数组')
      importBlocks(list)
    } catch (err) {
      toast(`导入节点块失败：${(err as Error).message}`, 'error')
    }
  }

  return (
    <div className="ms-panel-body">
      <div className="ms-section-title">
        我的节点块
        <span className="ms-section-title__count">{customBlocks.length}</span>
      </div>
      <div className="ms-btn-row">
        <button className="ms-btn ms-btn--primary" onClick={() => openBlockEditor()}>
          ＋ 新建节点块
        </button>
      </div>
      <div className="ms-btn-row">
        <button
          className="ms-btn"
          onClick={() => download('my-node-blocks.json', JSON.stringify({ kind: 'mermaid-studio-blocks', customBlocks }, null, 2), 'application/json')}
        >
          导出节点块
        </button>
        <button className="ms-btn" onClick={importFromFile}>
          导入节点块
        </button>
      </div>

      {customBlocks.length === 0 ? (
        <div className="ms-muted">
          还没有自定义节点块。可以从下面任意内置块「复制并修改」开始 —— 这是最省事的做法。
        </div>
      ) : (
        <div className="ms-blocklist">
          {customBlocks.map((b) => (
            <div key={b.id} className="ms-blockrow">
              <ShapeThumb shape={b.shape} fill={b.fill} stroke={b.stroke} size={30} />
              <div className="ms-blockrow__main">
                <div className="ms-blockrow__name">
                  {b.icon} {b.name}
                </div>
                <div className="ms-blockrow__meta">
                  {b.category} · {SHAPE_LABELS[b.shape]} · {b.fields.length} 字段 · {b.ports.length} 端口
                  {b.mermaidTemplate ? ' · 自定义模板' : ''}
                </div>
              </div>
              <button className="ms-icon-btn" title="编辑" onClick={() => openBlockEditor(b.id)}>
                ✎
              </button>
              <button className="ms-icon-btn" title="复制一份" onClick={() => duplicateBlock(b.id)}>
                ⧉
              </button>
              <button className="ms-icon-btn ms-icon-btn--danger" title="删除" onClick={() => deleteBlock(b.id)}>
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="ms-section-title">从内置块复制</div>
      <div className="ms-blocklist">
        {BUILTIN_BLOCKS.map((b) => (
          <div key={b.id} className="ms-blockrow">
            <ShapeThumb shape={b.shape} fill={b.fill} stroke={b.stroke} size={30} />
            <div className="ms-blockrow__main">
              <div className="ms-blockrow__name">
                {b.icon} {b.name}
              </div>
              <div className="ms-blockrow__meta">{b.description}</div>
            </div>
            <button className="ms-btn ms-btn--sm" onClick={() => openBlockEditor(b.id)}>
              复制为我的块
            </button>
          </div>
        ))}
      </div>

      {customBlocks.length ? (
        <button className="ms-btn ms-btn--danger" onClick={resetCustomBlocks}>
          清空所有自定义节点块
        </button>
      ) : null}
    </div>
  )
}
