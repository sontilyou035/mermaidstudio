import { useMemo, useState } from 'react'
import { useStore } from '../store'

const ALIGNS: Array<[Parameters<ReturnType<typeof useStore.getState>['alignSelection']>[0], string]> = [
  ['left', '左对齐'],
  ['hcenter', '水平居中'],
  ['right', '右对齐'],
  ['top', '顶对齐'],
  ['vcenter', '垂直居中'],
  ['bottom', '底对齐'],
]

/** 画布底部浮动的批量操作条：框选之后能一次改一堆元素 */
export function SelectionActions() {
  const doc = useStore((s) => s.doc)
  const groupSelection = useStore((s) => s.groupSelection)
  const addSelectionToGroup = useStore((s) => s.addSelectionToGroup)
  const removeSelectionFromGroup = useStore((s) => s.removeSelectionFromGroup)
  const alignSelection = useStore((s) => s.alignSelection)
  const distributeSelection = useStore((s) => s.distributeSelection)
  const duplicateSelection = useStore((s) => s.duplicateSelection)
  const deleteSelection = useStore((s) => s.deleteSelection)
  const clearSelection = useStore((s) => s.clearSelection)
  const showOnlySelected = useStore((s) => s.showOnlySelected)
  const [groupPick, setGroupPick] = useState('')

  const selectedNodes = doc.nodes.filter((n) => n.selected)
  const selectedEdges = doc.edges.filter((e) => e.selected)
  const groups = useMemo(() => doc.nodes.filter((n) => n.data.isSubgraph), [doc.nodes])
  const count = selectedNodes.length + selectedEdges.length
  // 只选中一个元素时不弹这条浮动条：单元素操作都在右侧检查器里，
  // 免得它挡住画布下方（尤其是节点的连接口）
  if (count < 2) return null

  const plain = selectedNodes.filter((n) => !n.data.isSubgraph)

  return (
    <div className="ms-selection-bar">
      <span className="ms-selection-bar__count">
        已选中 {selectedNodes.length} 节点{selectedEdges.length ? ` · ${selectedEdges.length} 连线` : ''}
      </span>

      <button className="ms-btn ms-btn--sm" onClick={groupSelection} disabled={plain.length === 0} title="把选中的节点装进一个新的分组">
        编组
      </button>

      {groups.length ? (
        <span className="ms-selection-bar__group">
          <select
            className="ms-input ms-input--compact"
            value={groupPick}
            onChange={(e) => {
              setGroupPick(e.target.value)
              if (e.target.value) addSelectionToGroup(e.target.value)
              setGroupPick('')
            }}
          >
            <option value="">加入分组…</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.data.label}
              </option>
            ))}
          </select>
        </span>
      ) : null}

      <button
        className="ms-btn ms-btn--sm"
        onClick={removeSelectionFromGroup}
        disabled={!plain.some((n) => n.data.groupId)}
      >
        移出分组
      </button>

      <span className="ms-selection-bar__sep" />

      {ALIGNS.map(([mode, label]) => (
        <button
          key={mode}
          className="ms-btn ms-btn--sm"
          disabled={selectedNodes.length < 2}
          onClick={() => alignSelection(mode)}
          title={label}
        >
          {label}
        </button>
      ))}
      <button className="ms-btn ms-btn--sm" disabled={selectedNodes.length < 3} onClick={() => distributeSelection('h')}>
        水平等距
      </button>
      <button className="ms-btn ms-btn--sm" disabled={selectedNodes.length < 3} onClick={() => distributeSelection('v')}>
        垂直等距
      </button>

      <span className="ms-selection-bar__sep" />

      <button className="ms-btn ms-btn--sm" onClick={duplicateSelection} disabled={!selectedNodes.length}>
        复制
      </button>
      <button className="ms-btn ms-btn--sm" onClick={showOnlySelected} disabled={!selectedNodes.length} title="只显示选中元素">
        只显示这些
      </button>
      <button className="ms-btn ms-btn--sm ms-btn--danger" onClick={deleteSelection}>
        删除
      </button>
      <button className="ms-icon-btn" onClick={clearSelection} title="取消选择 (Esc)">
        ✕
      </button>
    </div>
  )
}
