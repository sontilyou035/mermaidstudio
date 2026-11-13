import { useMemo, useState } from 'react'
import { useStore } from '../store'
import { BUILTIN_BLOCKS } from '../blocks/builtins'
import { ShapeThumb } from '../lib/shapes'
import { allBlocks } from '../blocks/registry'
import { viewportCenter } from '../lib/rf'
import { BUILTIN_CATEGORIES } from '../blocks/builtins'

export function Palette() {
  const customBlocks = useStore((s) => s.customBlocks)
  const addNodeFromBlock = useStore((s) => s.addNodeFromBlock)
  const openBlockEditor = useStore((s) => s.openBlockEditor)
  const deleteBlock = useStore((s) => s.deleteBlock)
  const duplicateBlock = useStore((s) => s.duplicateBlock)
  const afterDragStop = useStore((s) => s.afterDragStop)
  const [query, setQuery] = useState('')

  const blocks = useMemo(() => allBlocks(customBlocks), [customBlocks])

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = q
      ? blocks.filter((b) => b.name.toLowerCase().includes(q) || b.category.toLowerCase().includes(q) || b.description?.toLowerCase().includes(q))
      : blocks
    const map = new Map<string, typeof blocks>()
    for (const b of list) {
      const arr = map.get(b.category) ?? []
      arr.push(b)
      map.set(b.category, arr)
    }
    const order = [...BUILTIN_CATEGORIES, '我的']
    return [...map.entries()].sort((a, b) => {
      const ia = order.indexOf(a[0])
      const ib = order.indexOf(b[0])
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib)
    })
  }, [blocks, query])

  const clickAdd = (blockId: string) => {
    addNodeFromBlock(blockId, viewportCenter())
    afterDragStop()
  }

  return (
    <aside className="ms-palette">
      <div className="ms-palette__head">
        <div className="ms-palette__title">节点块</div>
        <span className="ms-palette__actions">
          <button className="ms-btn ms-btn--primary ms-btn--sm" onClick={() => openBlockEditor()} title="创建自己的节点块">
            ＋ 新建
          </button>
          <button
            className="ms-icon-btn ms-palette__collapse"
            onClick={() => useStore.getState().togglePalette()}
            title="收起左栏（全视图）"
            aria-label="收起左栏"
          >
            ‹
          </button>
        </span>
      </div>

      <input
        className="ms-input ms-input--search"
        placeholder="搜索节点块…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      <div className="ms-palette__list">
        {grouped.map(([category, items]) => (
          <div key={category} className="ms-group">
            <div className="ms-group__title">
              {category}
              <span className="ms-group__count">{items.length}</span>
            </div>
            <div className="ms-group__items">
              {items.map((b) => (
                <div
                  key={b.id}
                  className="ms-block-item"
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('application/mermaid-block', b.id)
                    e.dataTransfer.effectAllowed = 'move'
                  }}
                  onClick={() => clickAdd(b.id)}
                  title={b.description || b.name}
                >
                  <span className="ms-block-item__thumb">
                    <ShapeThumb shape={b.shape} fill={b.fill} stroke={b.stroke} />
                  </span>
                  <span className="ms-block-item__name">
                    {b.icon} {b.name}
                  </span>
                  {!b.builtin ? (
                    <span className="ms-block-item__actions">
                      <button
                        className="ms-icon-btn"
                        title="编辑 / 复制为我的块"
                        onClick={(e) => {
                          e.stopPropagation()
                          openBlockEditor(b.id)
                        }}
                      >
                        ✎
                      </button>
                      <button
                        className="ms-icon-btn"
                        title="再复制一个"
                        onClick={(e) => {
                          e.stopPropagation()
                          duplicateBlock(b.id)
                        }}
                      >
                        ⧉
                      </button>
                      <button
                        className="ms-icon-btn ms-icon-btn--danger"
                        title="删除这个块"
                        onClick={(e) => {
                          e.stopPropagation()
                          deleteBlock(b.id)
                        }}
                      >
                        ✕
                      </button>
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ))}
        {grouped.length === 0 ? <div className="ms-muted">没有匹配的节点块</div> : null}
      </div>

      <div className="ms-palette__foot">
        <div className="ms-hint">拖拽到画布添加 · 点击直接放到中心</div>
        <div className="ms-hint">按住 ⌥/Alt 拖拽节点 = 复制节点</div>
        <div className="ms-hint">内置块 {BUILTIN_BLOCKS.length} 个 · 自定义 {customBlocks.length} 个</div>
      </div>
    </aside>
  )
}
