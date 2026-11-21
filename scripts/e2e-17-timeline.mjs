// 验收：时间轴（剧本回放）——导入 / 值覆盖层 / 连线闪烁 / 播放锁定 / 裁剪 / 导出
import { readFileSync } from 'node:fs'
const APP = process.env.MS_BASE || 'http://127.0.0.1:5273'
const demoMmd = readFileSync(new URL('../docs/demo-diagram.mmd', import.meta.url), 'utf8')
const demoScenario = readFileSync(new URL('../docs/demo-scenario.json', import.meta.url), 'utf8')
const list = await (await fetch('http://127.0.0.1:9333/json/list')).json()
const page = list.find((t) => t.type === 'page')
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((r) => (ws.onopen = r))
let id = 0; const pending = new Map(); const errors = []
ws.onmessage = (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return }
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text)
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map((a) => a.value ?? a.description).join(' '))
}
const send = (method, params = {}) => { const i = ++id; ws.send(JSON.stringify({ id: i, method, params })); return new Promise((r) => pending.set(i, r)) }
const ev = async (x) => { const r = await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? 'eval error'); return r.result?.result?.value }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const out = []; const check = (n, ok, d = '') => { out.push([n, ok]); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ` — ${d}` : ''}`) }

await send('Runtime.enable'); await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1560, height: 940, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: `${APP}/` }); await sleep(5000)
await ev(`(() => { Object.keys(localStorage).filter(k=>k.startsWith('mermaid-studio:')).forEach(k=>localStorage.removeItem(k)); return 1 })()`)
await send('Page.reload'); await sleep(5500)

/* ---------- 准备：两张数据表 + 一条连线 ---------- */
const setup = await ev(`(async () => {
  const st = window.__ms.store.getState()
  st.newDoc()
  const s = window.__ms.store.getState()
  const a = s.addNodeFromBlock('builtin.table', { x: 120, y: 80 }, 'orders')
  const b = s.addNodeFromBlock('builtin.table', { x: 560, y: 80 }, 'users')
  window.__ms.store.getState().setNodeField(a, 'columns', 'id: bigint\\nstatus: varchar')
  window.__ms.store.getState().setNodeField(b, 'columns', 'id: bigint\\nname: varchar')
  await new Promise(r => setTimeout(r, 300))
  window.__ms.store.getState().onConnect({ source: a, target: b, sourceHandle: 'right', targetHandle: 'left' })
  await new Promise(r => setTimeout(r, 400))
  const st2 = window.__ms.store.getState()
  return { a, b, nodes: st2.doc.nodes.length, edges: st2.doc.edges.length, edgeId: st2.doc.edges[0]?.id }
})()`)
check('准备两张数据表 + 一条连线', setup.nodes === 2 && setup.edges === 1, JSON.stringify(setup))

/* ---------- 导入剧本 ---------- */
const imp = await ev(`(() => {
  const raw = {
    kind: 'mermaid-studio-scenario', version: 1,
    events: [
      { name: '打开订单页', startMs: 0, durationMs: 800, changes: [{ table: 'orders', field: 'status', value: 'paid' }] },
      { name: '创建用户', startMs: 1200, durationMs: 600, changes: [
        { table: 'users', field: 'id', value: '42' },
        { table: 'users', field: 'name', value: '李四' },
      ] },
      { name: '未知表事件', startMs: 2000, durationMs: 500, changes: [{ table: 'ghost', field: 'x', value: '1' }] },
    ],
  }
  const report = window.__ms.store.getState().importScenario(raw)
  const tl = window.__ms.store.getState().doc.timeline
  return { report, totalMs: tl?.totalMs, events: tl?.events.length, core: tl?.coreTables, eventIds: tl?.events.map(e => e.id) }
})()`)
check('导入剧本：3 个事件 / 4 条变更', imp.report.ok && imp.report.eventCount === 3 && imp.report.changeCount === 4, JSON.stringify(imp.report))
check('表匹配：orders / users 命中，ghost 未匹配', JSON.stringify(imp.report.matchedTables.sort()) === JSON.stringify(['orders', 'users']) && JSON.stringify(imp.report.unmatchedTables) === JSON.stringify(['ghost']), JSON.stringify({ m: imp.report.matchedTables, u: imp.report.unmatchedTables }))
check('核心表默认=已匹配的表', imp.core.length === 2, JSON.stringify(imp.core))

/* ---------- 未回放时：表节点显示 字段: 类型 ---------- */
const idle = await ev(`(() => {
  const rows = [...document.querySelectorAll('[data-id="${setup.a}"] .ms-table__row')].map(r => r.textContent)
  const valueMode = document.querySelector('[data-id="${setup.a}"] .ms-table__row.is-value-mode')
  return { rows, valueMode: !!valueMode, hasRun: window.__ms.store.getState().player.hasRun }
})()`)
check('未回放：表节点仍是 字段: 类型', idle.rows.join('|').includes('bigint') && idle.valueMode === false && idle.hasRun === false, JSON.stringify(idle.rows))

/* ---------- 拖动播放头到 1300ms：值覆盖层生效 ---------- */
const seek = await ev(`(async () => {
  window.__ms.store.getState().seekTimeline(1300)
  await new Promise(r => setTimeout(r, 300))
  const pick = (nid) => [...document.querySelectorAll('[data-id="' + nid + '"] .ms-table__row')].map(r => r.textContent.replace(/\\s+/g, ' ').trim())
  const st = window.__ms.store.getState()
  return { orders: pick('${setup.a}'), users: pick('${setup.b}'), hasRun: st.player.hasRun, cursor: st.player.cursorMs }
})()`)
check('回放中：表节点显示 字段: 值', seek.orders.join('|').includes('paid') && seek.users.join('|').includes('42') && seek.users.join('|').includes('李四'), JSON.stringify({ orders: seek.orders, users: seek.users }))
check('字段值没有写回文档（columns 仍是类型）', await ev(`(() => {
  const n = window.__ms.store.getState().doc.nodes.find(n => n.id === '${setup.a}')
  return /bigint/.test(n.data.values.columns)
})()`))

/* ---------- 播放：光标前进 + 连线闪烁 + 编辑锁定 ---------- */
const play = await ev(`(async () => {
  const st = window.__ms.store.getState()
  st.resetTimeline()
  st.playTimeline()
  await new Promise(r => setTimeout(r, 420))
  const mid = window.__ms.store.getState()
  const blinkDom = !!document.querySelector('.react-flow__edge-path.ms-edge--blink')
  const blinkKeys = Object.keys(mid.player.blink)
  // 播放中双击不该进入编辑
  const head = document.querySelector('[data-id="${setup.a}"] .ms-table__head')
  head?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
  await new Promise(r => setTimeout(r, 150))
  const editing = !!document.querySelector('[data-id="${setup.a}"] .ms-node__input, [data-id="${setup.a}"] .ms-table__editor')
  window.__ms.store.getState().pauseTimeline()
  return { cursor: mid.player.cursorMs, playing: mid.player.playing, blinkDom, blinkKeys, editing }
})()`)
check('播放：播放头前进', play.cursor > 0 && play.playing === true, JSON.stringify({ cursor: Math.round(play.cursor), playing: play.playing }))
check('播放：事件触发连线闪烁', play.blinkDom === true && play.blinkKeys.length > 0, JSON.stringify({ dom: play.blinkDom, keys: play.blinkKeys }))
check('播放期间锁定双击编辑', play.editing === false, String(play.editing))

/* ---------- 重置：回到 字段: 类型 ---------- */
const reset = await ev(`(async () => {
  window.__ms.store.getState().resetTimeline()
  await new Promise(r => setTimeout(r, 250))
  const rows = [...document.querySelectorAll('[data-id="${setup.a}"] .ms-table__row')].map(r => r.textContent.replace(/\\s+/g, ' ').trim())
  return { rows, hasRun: window.__ms.store.getState().player.hasRun }
})()`)
check('重置后恢复 字段: 类型', reset.rows.join('|').includes('bigint') && reset.hasRun === false, JSON.stringify(reset.rows))

/* ---------- 裁剪：取消核心表 + 删除事件；导出只含保留内容 ---------- */
const prune = await ev(`(async () => {
  window.__ms.store.getState().toggleCoreTable('${setup.b}')
  const coreAfterToggle = window.__ms.store.getState().doc.timeline.coreTables.length
  // 删除「未知表事件」（ghost）
  const ghostId = window.__ms.store.getState().doc.timeline.events.find(e => e.name === '未知表事件').id
  window.__ms.store.getState().removeScenarioEvent(ghostId)
  const json = window.__ms.store.getState().scenarioJson()
  const parsed = JSON.parse(json)
  return {
    coreAfterToggle,
    jsonHasOrderEvent: parsed.events.some(e => e.name === '打开订单页'),
    jsonHasUsers: JSON.stringify(parsed).includes('"users"'),
    jsonHasGhost: JSON.stringify(parsed).includes('ghost'),
    events: parsed.events.length,
    changes: parsed.events.reduce((n, e) => n + e.changes.length, 0),
    totalMs: parsed.totalMs,
    ghostId,
  }
})()`)
check('取消核心表后核心表数减少', prune.coreAfterToggle === 1, String(prune.coreAfterToggle))
check('保留的事件（orders）仍被导出', prune.jsonHasOrderEvent === true, JSON.stringify({ events: prune.events }))
check('非核心表（users）的变更被过滤', prune.jsonHasUsers === false)
check('删除的事件与未绑定表都不导出', prune.jsonHasGhost === false && prune.events === 1 && prune.changes === 1, JSON.stringify({ events: prune.events, changes: prune.changes }))
check('导出仍是合法剧本 JSON（可再导入）', prune.events >= 1 && prune.changes >= 1 && prune.totalMs > 0, JSON.stringify({ events: prune.events, changes: prune.changes }))

/* ---------- 导出按钮 + 恢复事件 ---------- */
const ui = await ev(`(async () => {
  const btns = [...document.querySelectorAll('.ms-timeline__bar .ms-btn')].map(b => b.textContent.trim())
  window.__ms.store.getState().restoreScenarioEvent('${prune.ghostId}')
  const removed = window.__ms.store.getState().doc.timeline.removedEventIds.length
  return { btns, removed }
})()`)
check('面板有导入 / 导出剧本按钮', ui.btns.some((b) => b.includes('导入剧本')) && ui.btns.some((b) => b.includes('导出剧本')), JSON.stringify(ui.btns))
check('删除的事件可以恢复', ui.removed === 0, String(ui.removed))

/* ---------- 快照格式导入（diff 成变更） ---------- */
const snap = await ev(`(async () => {
  const raw = {
    events: [
      { name: '初始化', startMs: 0, durationMs: 500, tables: [{ table: 'orders', values: { id: '1', status: 'new' } }] },
      { name: '更新', startMs: 600, durationMs: 500, tables: [{ table: 'orders', values: { id: '1', status: 'paid' } }] },
    ],
  }
  const report = window.__ms.store.getState().importScenario(raw)
  const tl = window.__ms.store.getState().doc.timeline
  return { ok: report.ok, changes: report.changeCount, secondChanges: tl.events[1].changes.length }
})()`)
check('快照格式导入：逐字段 diff 成变更', snap.ok && snap.changes === 3 && snap.secondChanges === 1, JSON.stringify(snap))

/* ---------- 仓库自带的 demo 文件 ---------- */
const demo = await ev(`(async () => {
  window.__ms.store.getState().newDoc()
  const imp = window.__ms.store.getState().importMermaid(${JSON.stringify(demoMmd)})
  await new Promise(r => setTimeout(r, 900))
  const report = window.__ms.store.getState().importScenario(JSON.parse(${JSON.stringify(demoScenario)}))
  await new Promise(r => setTimeout(r, 400))
  const st = window.__ms.store.getState()
  return {
    importOk: imp.ok,
    tables: st.doc.nodes.map(n => n.data.label),
    matched: report.matchedTables.length,
    unmatched: report.unmatchedTables.length,
    events: report.eventCount,
    changes: report.changeCount,
  }
})()`)
check('demo 图：7 张数据表全部导入', demo.importOk && demo.tables.length === 7 && demo.tables.includes('order_items'), JSON.stringify(demo.tables))
check('demo 剧本：7 事件 / 17 条变更且全部匹配', demo.matched === 7 && demo.unmatched === 0 && demo.events === 7 && demo.changes === 17, JSON.stringify(demo))

/* ---------- 元素编号（T01–T13）：文档 / 代码 / DOM 三方一致 ---------- */
const docMd = readFileSync(new URL('../docs/ui-elements.md', import.meta.url), 'utf8')
const srcTsx = readFileSync(new URL('../src/components/TimelinePanel.tsx', import.meta.url), 'utf8')
const mdIds = [...new Set(docMd.match(/T\d{2}/g) ?? [])].sort()
const srcIds = [...new Set([...srcTsx.matchAll(/data-el="(T\d{2})"/g)].map((m) => m[1]))].sort()
check('编号目录与代码标记一致（13 个）', JSON.stringify(mdIds) === JSON.stringify(srcIds) && srcIds.length === 13, JSON.stringify(srcIds))

const domTimeline = await ev(`(async () => {
  window.__ms.store.getState().newDoc()
  window.__ms.store.getState().importMermaid(${JSON.stringify(demoMmd)})
  await new Promise(r => setTimeout(r, 900))
  window.__ms.store.getState().importScenario(JSON.parse(${JSON.stringify(demoScenario)}))
  await new Promise(r => setTimeout(r, 500))
  const ids = [...document.querySelectorAll('[data-el]')].map((el) => el.getAttribute('data-el'))
  return ids.sort()
})()`)
check('时间轴视图露出 T01–T10（不含审阅/空状态）',
  JSON.stringify(domTimeline) === JSON.stringify(['T01','T02','T03','T04','T05','T06','T07','T08','T09','T10']),
  JSON.stringify(domTimeline))

const align = await ev(`(() => {
  const labels = [...document.querySelectorAll('.ms-gantt__label')]
  const rows = [...document.querySelectorAll('.ms-gantt__row')]
  const byId = labels.map((l, i) => ({ label: l.textContent.trim(), top: l.getBoundingClientRect().top }))
  const rowTops = rows.map((r) => r.getBoundingClientRect().top)
  return { count: rows.length, aligned: rowTops.every((t, i) => Math.abs(t - byId[i].top) < 3), tops: byId.map(b => Math.round(b.top)) }
})()`)
check('甘特条与左侧事件名逐行对齐', align.count === 7 && align.aligned === true, JSON.stringify(align))

const domReview = await ev(`(async () => {
  const tabs = document.querySelectorAll('.ms-timeline__tab')
  tabs[1]?.click()
  await new Promise(r => setTimeout(r, 300))
  const ids = [...document.querySelectorAll('[data-el]')].map((el) => el.getAttribute('data-el'))
  return ids.sort()
})()`)
check('审阅视图露出 T11 / T12 且甘特区隐藏',
  domReview.includes('T11') && domReview.includes('T12') && !domReview.includes('T09'),
  JSON.stringify(domReview))

const domEmpty = await ev(`(async () => {
  const tabs = document.querySelectorAll('.ms-timeline__tab')
  tabs[0]?.click()
  window.__ms.store.getState().newDoc()
  window.__ms.store.getState().setTimelineOpen(true)
  await new Promise(r => setTimeout(r, 400))
  return [...document.querySelectorAll('[data-el]')].map((el) => el.getAttribute('data-el')).sort()
})()`)
check('未导入剧本时露出空状态 T13，且无播放控制',
  domEmpty.includes('T01') && domEmpty.includes('T13') && !domEmpty.includes('T03'),
  JSON.stringify(domEmpty))

const unique = await ev(`(() => {
  const ids = [...document.querySelectorAll('[data-el]')].map((el) => el.getAttribute('data-el'))
  return { total: ids.length, unique: new Set(ids).size }
})()`)
check('同一界面内编号不重复', unique.total === unique.unique, JSON.stringify(unique))

console.log('\n异常/错误:', errors.length ? errors.join('\n') : '(无)')
const failed = out.filter(([, ok]) => !ok).length
console.log(`时间轴验收：${out.length - failed}/${out.length} 通过`)
ws.close()
process.exit(failed || errors.length ? 1 : 0)
