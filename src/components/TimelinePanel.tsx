import { useMemo, useRef, useState } from 'react'
import { useStore } from '../store'
import { allBlocks, download } from '../blocks/registry'
import { tableUsage } from '../lib/timeline'

function fmt(ms: number): string {
  const s = Math.max(0, ms) / 1000
  return `${s.toFixed(1)}s`
}

/** 时间轴（剧本回放）面板：甘特视图 + 审阅视图 */
export function TimelinePanel() {
  const timeline = useStore((s) => s.doc.timeline)
  const open = useStore((s) => s.timelineOpen)
  const player = useStore((s) => s.player)
  const doc = useStore((s) => s.doc)
  const nodes = useStore((s) => s.doc.nodes)
  const customBlocks = useStore((s) => s.customBlocks)
  const setTimelineOpen = useStore((s) => s.setTimelineOpen)
  const importScenario = useStore((s) => s.importScenario)
  const playTimeline = useStore((s) => s.playTimeline)
  const pauseTimeline = useStore((s) => s.pauseTimeline)
  const replayTimeline = useStore((s) => s.replayTimeline)
  const resetTimeline = useStore((s) => s.resetTimeline)
  const seekTimeline = useStore((s) => s.seekTimeline)
  const setPlaybackSpeed = useStore((s) => s.setPlaybackSpeed)
  const toggleCoreTable = useStore((s) => s.toggleCoreTable)
  const bindScenarioTable = useStore((s) => s.bindScenarioTable)
  const removeScenarioEvent = useStore((s) => s.removeScenarioEvent)
  const restoreScenarioEvent = useStore((s) => s.restoreScenarioEvent)
  const scenarioJson = useStore((s) => s.scenarioJson)

  const fileRef = useRef<HTMLInputElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const [view, setView] = useState<'timeline' | 'review'>('timeline')

  const tableNodes = useMemo(() => {
    const ids = new Set(allBlocks(customBlocks).filter((b) => b.layout === 'table').map((b) => b.id))
    return nodes.filter((n) => !n.data.isSubgraph && ids.has(n.data.blockId))
  }, [nodes, customBlocks])

  const usage = useMemo(() => (timeline ? tableUsage(timeline) : []), [timeline])
  const removed = useMemo(() => new Set(timeline?.removedEventIds ?? []), [timeline])
  const keptEvents = timeline ? timeline.events.filter((e) => !removed.has(e.id)) : []
  const keptChanges = keptEvents.reduce((n, e) => n + e.changes.length, 0)
  const coreCount = timeline?.coreTables.length ?? 0
  const activeEvents = keptEvents.filter((e) => e.startMs <= player.cursorMs)
  const total = timeline?.totalMs ?? 1
  const pct = Math.min(100, ((player.cursorMs / total) * 100) || 0)

  const onImportClick = () => fileRef.current?.click()
  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      const text = await file.text()
      importScenario(JSON.parse(text))
    } catch (err) {
      useStore.getState().toast(`剧本 JSON 解析失败：${(err as Error).message}`, 'error')
    }
  }

  const startScrub = (e: React.MouseEvent) => {
    if (!timeline) return
    e.preventDefault()
    pauseTimeline()
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect) return
    const seek = (clientX: number) => {
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
      seekTimeline(ratio * timeline.totalMs)
    }
    seek(e.clientX)
    const move = (ev: MouseEvent) => seek(ev.clientX)
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  const firstEvent = keptEvents[0]

  return (
    <div className={`ms-timeline${open ? ' is-open' : ''}`} data-el="T01">
      <div className="ms-timeline__bar">
        <button className="ms-timeline__fold" data-el="T02" onClick={() => setTimelineOpen(!open)} title={open ? '收起时间轴' : '展开时间轴'}>
          {open ? '▾' : '▸'}
        </button>
        <span className="ms-timeline__title">🎬 时间轴</span>
        {timeline ? (
          <>
            <span className="ms-timeline__group" data-el="T03">
              <button className="ms-btn ms-btn--sm" onClick={() => (player.playing ? pauseTimeline() : playTimeline())}>
                {player.playing ? '⏸ 暂停' : '▶ 播放'}
              </button>
              <button className="ms-btn ms-btn--sm" onClick={() => replayTimeline()} title="从头播放">
                ↺ 重播
              </button>
              <button className="ms-btn ms-btn--sm" onClick={() => resetTimeline()} title="回到未回放状态（表节点恢复 字段: 类型）">
                ⏹ 重置
              </button>
            </span>
            <span className="ms-timeline__speed" data-el="T04">
              {[0.5, 1, 2].map((s) => (
                <button
                  key={s}
                  className={`ms-timeline__speedbtn${player.speed === s ? ' is-active' : ''}`}
                  onClick={() => setPlaybackSpeed(s)}
                >
                  {s}×
                </button>
              ))}
            </span>
            <span className="ms-timeline__clock" data-el="T05">
              {fmt(player.cursorMs)} / {fmt(timeline.totalMs)}
            </span>
            <span className="ms-timeline__spacer" />
            <div className="ms-timeline__tabs" data-el="T06">
              <button className={`ms-timeline__tab${view === 'timeline' ? ' is-active' : ''}`} onClick={() => setView('timeline')}>
                时间轴
              </button>
              <button className={`ms-timeline__tab${view === 'review' ? ' is-active' : ''}`} onClick={() => setView('review')}>
                审阅
              </button>
            </div>
          </>
        ) : (
          <span className="ms-timeline__empty">还没有剧本</span>
        )}
        <button className="ms-btn ms-btn--sm" data-el="T07" onClick={onImportClick} title="导入原始事件 JSON（delta 或快照两种格式都支持）">
          ⤒ 导入剧本
        </button>
        {timeline ? (
          <button
            className="ms-btn ms-btn--sm"
            data-el="T08"
            onClick={() => download(`${doc.name || 'scenario'}.scenario.json`, scenarioJson(), 'application/json')}
            title="导出核心表剧本（只含人工保留的变更，可直接再导入）"
          >
            ⤓ 导出剧本
          </button>
        ) : null}
        <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={onFile} />
      </div>

      {open && timeline ? (
        view === 'timeline' ? (
          <div className="ms-gantt" data-el="T09">
            <div className="ms-gantt__labels">
              {timeline.events.map((ev) => (
                <div
                  key={ev.id}
                  className={`ms-gantt__label${removed.has(ev.id) ? ' is-removed' : ''}`}
                  onClick={() => !removed.has(ev.id) && seekTimeline(ev.startMs)}
                  title={removed.has(ev.id) ? '已删除的事件（导出时不含）' : `跳到 ${fmt(ev.startMs)}`}
                >
                  {ev.name}
                </div>
              ))}
            </div>
            <div className="ms-gantt__trackwrap" onMouseDown={startScrub}>
              <div className="ms-gantt__ruler">
                {[0, 0.25, 0.5, 0.75, 1].map((r) => (
                  <span key={r} className="ms-gantt__tick" style={{ left: `${r * 100}%` }}>
                    {fmt(timeline.totalMs * r)}
                  </span>
                ))}
              </div>
              <div className="ms-gantt__rows" ref={trackRef}>
                {timeline.events.map((ev) => (
                  <div key={ev.id} className={`ms-gantt__row${ev.startMs <= player.cursorMs ? ' is-past' : ''}`}>
                    {removed.has(ev.id) ? null : (
                      <div
                        className={`ms-gantt__bar${ev.startMs <= player.cursorMs ? ' is-done' : ''}`}
                        style={{
                          left: `${(ev.startMs / timeline.totalMs) * 100}%`,
                          width: `${Math.max(1.5, (ev.durationMs / timeline.totalMs) * 100)}%`,
                        }}
                        title={`${ev.name}（${fmt(ev.startMs)}–${fmt(ev.startMs + ev.durationMs)}，${ev.changes.length} 条变更）`}
                        onMouseDown={(e) => {
                          e.stopPropagation()
                          pauseTimeline()
                          seekTimeline(ev.startMs)
                        }}
                      />
                    )}
                  </div>
                ))}
                <div className="ms-gantt__playhead" style={{ left: `${pct}%` }} />
              </div>
            </div>
            <div className="ms-gantt__aside" data-el="T10">
              <span>
                {keptEvents.length} 事件 · {keptChanges} 变更
              </span>
              <span>
                {coreCount}/{tableNodes.length} 张核心表
              </span>
              {firstEvent ? <span className="ms-timeline__hint">点条跳转 · 点轨道拖动播放头</span> : null}
            </div>
          </div>
        ) : (
          <div className="ms-review">
            <div className="ms-review__col" data-el="T11">
              <div className="ms-review__head">
                核心表 <span className="ms-review__count">{coreCount}/{usage.length} 张</span>
              </div>
              {usage.length === 0 ? <div className="ms-review__empty">剧本里还没有任何表变更</div> : null}
              {usage.map((u) => {
                const core = !!u.nodeId && timeline.coreTables.includes(u.nodeId)
                return (
                  <div key={u.table} className={`ms-review__row${removed.size && !u.nodeId ? ' is-unmatched' : ''}`}>
                    {u.nodeId ? (
                      <input type="checkbox" checked={core} onChange={() => u.nodeId && toggleCoreTable(u.nodeId)} title="取消勾选 = 这张表不导出、不回放" />
                    ) : (
                      <span className="ms-review__warn" title="剧本里的表名对不上画布节点，请手动绑定">⚠</span>
                    )}
                    <span className="ms-review__name">{u.table}</span>
                    <span className="ms-review__meta">
                      {u.changes} 变更 · {u.events} 事件
                    </span>
                    {!u.nodeId ? (
                      <select
                        className="ms-review__bind"
                        defaultValue=""
                        onChange={(e) => e.target.value && bindScenarioTable(u.table, e.target.value)}
                      >
                        <option value="">绑定到…</option>
                        {tableNodes.map((n) => (
                          <option key={n.id} value={n.id}>
                            {n.data.label}
                          </option>
                        ))}
                      </select>
                    ) : null}
                  </div>
                )
              })}
            </div>
            <div className="ms-review__col" data-el="T12">
              <div className="ms-review__head">
                事件 <span className="ms-review__count">{keptEvents.length}/{timeline.events.length} 条</span>
              </div>
              {timeline.events.map((ev) => {
                const dead = removed.has(ev.id)
                return (
                  <div key={ev.id} className={`ms-review__row${dead ? ' is-removed' : ''}`}>
                    <span className="ms-review__name">{ev.name}</span>
                    <span className="ms-review__meta">
                      {fmt(ev.startMs)}–{fmt(ev.startMs + ev.durationMs)} · {ev.changes.length} 条
                    </span>
                    {dead ? (
                      <button className="ms-btn ms-btn--sm" onClick={() => restoreScenarioEvent(ev.id)}>
                        恢复
                      </button>
                    ) : (
                      <button className="ms-btn ms-btn--sm" onClick={() => removeScenarioEvent(ev.id)} title="删除这条事件（可再恢复 / 撤销）">
                        ✕
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )
      ) : null}

      {open && !timeline ? (
        <div className="ms-timeline__hintblock" data-el="T13">
          导入一份原始事件 JSON（<code>{'{ "events": [{ "name": "…", "startMs": 0, "durationMs": 800, "changes": [{ "table": "orders", "field": "id", "value": "1234" }] }] }'}</code>），
          自动匹配画布上的数据表节点；再在「审阅」里删减掉非核心表，最后「导出剧本」。
        </div>
      ) : null}
    </div>
  )
}
