const APP = process.env.MS_BASE || 'http://127.0.0.1:5274'
const CDP_PORT = 9333

async function getTarget() {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)
      const list = await res.json()
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
      if (page) return page
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 300))
  }
  throw new Error('找不到 Chrome 调试目标')
}

const target = await getTarget()
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  ws.onopen = resolve
  ws.onerror = reject
})

let id = 0
const pending = new Map()
const consoleErrors = []
const exceptions = []

ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data)
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id)
    pending.delete(msg.id)
    if (msg.error) reject(new Error(JSON.stringify(msg.error)))
    else resolve(msg.result)
    return
  }
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    consoleErrors.push(msg.params.args.map((a) => a.value ?? a.description ?? a.type).join(' '))
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    exceptions.push(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text)
  }
}

function send(method, params = {}) {
  const msgId = ++id
  ws.send(JSON.stringify({ id: msgId, method, params }))
  return new Promise((resolve, reject) => pending.set(msgId, { resolve, reject }))
}

async function evaluate(expression) {
  const res = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  })
  if (res.exceptionDetails) {
    throw new Error(res.exceptionDetails.exception?.description ?? res.exceptionDetails.text)
  }
  return res.result.value
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

await send('Runtime.enable')
await send('Page.enable')
await send('Page.navigate', { url: APP + '/' })
await sleep(4500)
await evaluate(`(() => { Object.keys(localStorage).filter(k => k.startsWith('mermaid-studio:')).forEach(k => localStorage.removeItem(k)); return true })()`)
await send('Page.navigate', { url: APP + '/' })
await sleep(4500)

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

/* ---------- 夹具 ----------
 * 可见表：orders(焦点) — order_items(1 跳) — coupons(2 跳) — audit_log(3 跳)
 * 隐藏表：shipping（图层里关掉）
 * 分组：交易（orders 属于它，但分组框不画）
 * 注释：note（没有连线，不画）
 * 连线：2 条合规、1 条虚线待确认、1 条标签不合规
 */

const fixture = await evaluate(`(() => {
  const s = () => window.__ms.store.getState()
  s().newDoc()
  const orders = s().addNodeFromBlock('builtin.table', { x: 0, y: 0 }, 'orders')
  const items = s().addNodeFromBlock('builtin.table', { x: 0, y: 200 }, 'order_items')
  const coupons = s().addNodeFromBlock('builtin.table', { x: 0, y: 400 }, 'coupons')
  const audit = s().addNodeFromBlock('builtin.table', { x: 0, y: 600 }, 'audit_log')
  const shipping = s().addNodeFromBlock('builtin.table', { x: 400, y: 0 }, 'shipping')
  const group = s().addNodeFromBlock('builtin.group', { x: 0, y: 800 }, '交易')
  const note = s().addNodeFromBlock('builtin.note', { x: 600, y: 600 }, '注释')

  s().setNodeField(orders, 'columns', 'id: bigint\\nuser_id: bigint\\namount: decimal')
  s().setNodeField(items, 'columns', 'id: bigint\\norder_id: bigint\\nprice: decimal')
  s().setNodeField(coupons, 'columns', 'id: bigint\\ncode: varchar')
  s().setNodeField(audit, 'columns', 'id: bigint\\naction: varchar')
  s().updateNodeData(orders, { groupId: group })

  s().onConnect({ source: orders, target: items, sourceHandle: null, targetHandle: null })
  s().onConnect({ source: items, target: coupons, sourceHandle: null, targetHandle: null })
  s().onConnect({ source: coupons, target: audit, sourceHandle: null, targetHandle: null })

  const edges = s().doc.edges
  s().setEdgeLabelType(edges[0].id, '关联', 'user_id')
  s().setEdgeLabelType(edges[1].id, '关联')
  s().updateEdgeData(edges[1].id, { lineStyle: 'dashed' })
  // 第三条故意不设置标签：图谱要把它标成不合规

  s().toggleNodeHidden(shipping)
  s().saveNow()

  return {
    ids: { orders, items, coupons, audit, shipping, group, note },
    nodes: s().doc.nodes.length,
    edges: s().doc.edges.length,
    hidden: s().doc.nodes.find(n => n.id === shipping)?.hidden,
  }
})()`)
check('夹具就绪（7 节点 / 3 连线 / 1 隐藏）', fixture.nodes === 7 && fixture.edges === 3 && fixture.hidden === true, JSON.stringify(fixture))

await sleep(400)
const posBefore = await evaluate(`JSON.stringify(window.__ms.store.getState().doc.nodes.map(n => [n.id, n.position.x, n.position.y]))`)

/* ---------- 切到关系图谱 ---------- */

await evaluate(`document.querySelector('[data-view="graph"]').click()`)
await sleep(700)

const mounted = await evaluate(`(() => ({
  graph: !!document.querySelector('.ms-canvas--graph'),
  flows: document.querySelectorAll('.react-flow').length,
  dots: document.querySelectorAll('.ms-gdot').length,
  mode: window.__ms.store.getState().settings.viewMode,
}))()`)
check('切到关系图谱（流程图卸载，只剩一个画布）', mounted.graph === true && mounted.flows === 1, JSON.stringify(mounted))
check('视图模式写进 settings', mounted.mode === 'graph', `mode=${mounted.mode}`)
check('只画实体表：4 个点', mounted.dots === 4, `dots=${mounted.dots}`)

await sleep(700)
const opened = await evaluate(`(() => {
  const canvas = document.querySelector('.ms-canvas--graph').getBoundingClientRect()
  const focus = document.querySelector('.ms-gdot.is-focus')
  if (!focus) return { focus: 0 }
  const dot = focus.querySelector('.ms-gdot__dot').getBoundingClientRect()
  return {
    focus: document.querySelectorAll('.ms-gdot.is-focus').length,
    id: focus.getAttribute('data-id'),
    dx: Math.round(dot.left + dot.width / 2 - (canvas.left + canvas.width / 2)),
    dy: Math.round(dot.top + dot.height / 2 - (canvas.top + canvas.height / 2)),
  }
})()`)
check(
  '打开图谱就有一个焦点（度数最高的表），并且落在圆心',
  opened.focus === 1 && opened.id === fixture.ids.items && Math.abs(opened.dx) <= 80 && Math.abs(opened.dy) <= 80,
  JSON.stringify(opened),
)

const visible = await evaluate(`(() => {
  const ids = [...document.querySelectorAll('.ms-gdot')].map(el => el.getAttribute('data-id'))
  return {
    ids,
    groupBox: !!document.querySelector('[data-id="' + ${JSON.stringify(fixture.ids.group)} + '"]'),
    shipping: ids.includes(${JSON.stringify(fixture.ids.shipping)}),
    note: ids.includes(${JSON.stringify(fixture.ids.note)}),
  }
})()`)
check(
  '分组框 / 隐藏表 / 无连线注释都不进图',
  visible.groupBox === false && visible.shipping === false && visible.note === false && visible.ids.length === 4,
  JSON.stringify(visible),
)

/* ---------- 拖动节点：移动的是这个点，不是画布，也不写文档 ---------- */

const dragStart = await evaluate(`(() => {
  const dot = document.querySelector('.ms-gdot[data-id="' + ${JSON.stringify(fixture.ids.coupons)} + '"] .ms-gdot__dot').getBoundingClientRect()
  const other = document.querySelector('.ms-gdot[data-id="' + ${JSON.stringify(fixture.ids.audit)} + '"]').getBoundingClientRect()
  return {
    x: Math.round(dot.left + dot.width / 2),
    y: Math.round(dot.top + dot.height / 2),
    otherX: Math.round(other.x),
    doc: JSON.stringify(window.__ms.store.getState().doc.nodes.map((n) => [n.id, n.position.x, n.position.y])),
    focus: document.querySelector('.ms-gdot.is-focus')?.getAttribute('data-id') ?? null,
  }
})()`)
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: dragStart.x, y: dragStart.y })
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: dragStart.x, y: dragStart.y, button: 'left', clickCount: 1, buttons: 1 })
for (const k of [1, 2, 3, 4]) {
  await send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: dragStart.x + k * 25,
    y: dragStart.y + k * 15,
    button: 'left',
    buttons: 1,
  })
  await sleep(30)
}
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: dragStart.x + 100, y: dragStart.y + 60, button: 'left', clickCount: 1, buttons: 0 })
await sleep(500)

const dragged = await evaluate(`(() => {
  const dot = document.querySelector('.ms-gdot[data-id="' + ${JSON.stringify(fixture.ids.coupons)} + '"] .ms-gdot__dot').getBoundingClientRect()
  const other = document.querySelector('.ms-gdot[data-id="' + ${JSON.stringify(fixture.ids.audit)} + '"]').getBoundingClientRect()
  return {
    x: Math.round(dot.left + dot.width / 2),
    y: Math.round(dot.top + dot.height / 2),
    otherX: Math.round(other.x),
    doc: JSON.stringify(window.__ms.store.getState().doc.nodes.map((n) => [n.id, n.position.x, n.position.y])),
    focus: document.querySelector('.ms-gdot.is-focus')?.getAttribute('data-id') ?? null,
  }
})()`)
check(
  '拖动节点只移动这个点（画布不平移、焦点不变）',
  // 拖动激活会吃掉第一步位移（真实鼠标步长很小，肉眼无感），所以给 ±30 容差
  Math.abs(dragged.x - dragStart.x - 100) <= 30 &&
    Math.abs(dragged.y - dragStart.y - 60) <= 30 &&
    dragged.otherX === dragStart.otherX &&
    dragged.focus === dragStart.focus,
  JSON.stringify({ dx: dragged.x - dragStart.x, dy: dragged.y - dragStart.y, otherSame: dragged.otherX === dragStart.otherX }),
)
check('拖动节点不写回文档坐标', dragged.doc === dragStart.doc)

const edgeMarks = await evaluate(`(() => ({
  dashed: document.querySelectorAll('.ms-gedge.is-dashed').length,
  warn: document.querySelectorAll('.ms-gedge.is-warn').length,
  arrows: document.querySelectorAll('.ms-gedge__arrow').length,
  groups: [...new Set([...document.querySelectorAll('.ms-gdot')].map(el => el.getAttribute('data-group')))],
}))()`)
check('虚线 = 待确认项、不合规标签标 ⚠、方向画箭头', edgeMarks.dashed === 1 && edgeMarks.warn === 1 && edgeMarks.arrows === 3, JSON.stringify(edgeMarks))

/* ---------- 聚焦与跳数 ---------- */

await evaluate(`document.querySelector('.ms-gdot[data-id="' + ${JSON.stringify(fixture.ids.orders)} + '"] .ms-gdot__body').click()`)
await sleep(300)

const focus = await evaluate(`(() => ({
  focus: document.querySelectorAll('.ms-gdot.is-focus').length,
  dim: document.querySelectorAll('.ms-gdot.is-dim').length,
  near: document.querySelectorAll('.ms-gdot:not(.is-dim)').length,
  selected: window.__ms.store.getState().doc.nodes.filter(n => n.selected).map(n => n.id),
}))()`)
check('单击聚焦：1 个焦点、2 跳以外压暗', focus.focus === 1 && focus.dim === 2 && focus.near === 2, JSON.stringify(focus))
check('聚焦同步检查器选中', focus.selected.length === 1 && focus.selected[0] === fixture.ids.orders, JSON.stringify(focus.selected))

await sleep(900)
const centered = await evaluate(`(() => {
  const canvas = document.querySelector('.ms-canvas--graph').getBoundingClientRect()
  const dot = document.querySelector('.ms-gdot[data-id="' + ${JSON.stringify(fixture.ids.orders)} + '"] .ms-gdot__dot').getBoundingClientRect()
  return {
    dx: Math.round(dot.left + dot.width / 2 - (canvas.left + canvas.width / 2)),
    dy: Math.round(dot.top + dot.height / 2 - (canvas.top + canvas.height / 2)),
    labelBelow: document.querySelector('.ms-gdot[data-id="' + ${JSON.stringify(fixture.ids.orders)} + '"] .ms-gdot__label').getBoundingClientRect().top
      >= dot.top + dot.height - 1,
  }
})()`)
check(
  '焦点被摆到圆心（±80px），名字在圆点下面',
  Math.abs(centered.dx) <= 80 && Math.abs(centered.dy) <= 80 && centered.labelBelow === true,
  JSON.stringify(centered),
)

await evaluate(`document.querySelector('[data-depth="2"]').click()`)
await sleep(300)
const depth2 = await evaluate(`(() => ({
  dim: document.querySelectorAll('.ms-gdot.is-dim').length,
  near: document.querySelectorAll('.ms-gdot:not(.is-dim)').length,
}))()`)
check('切到 2 跳：压暗的变少、亮的变多', depth2.dim === 1 && depth2.near === 3, `1 跳 dim=${focus.dim} → 2 跳 dim=${depth2.dim}`)

await evaluate(`document.querySelector('.react-flow__pane').click()`)
await sleep(300)
const cleared = await evaluate(`(() => ({
  dim: document.querySelectorAll('.ms-gdot.is-dim').length,
  focus: document.querySelectorAll('.ms-gdot.is-focus').length,
}))()`)
check('点空白清掉聚焦', cleared.dim === 0 && cleared.focus === 0, JSON.stringify(cleared))

/* ---------- 双击回流程图 ---------- */

const targetPoint = await evaluate(`(() => {
  const el = document.querySelector('.ms-gdot[data-id="' + ${JSON.stringify(fixture.ids.coupons)} + '"] .ms-gdot__label')
  const r = el.getBoundingClientRect()
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
})()`)
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: targetPoint.x, y: targetPoint.y })
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: targetPoint.x, y: targetPoint.y, button: 'left', clickCount: 1, buttons: 1 })
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: targetPoint.x, y: targetPoint.y, button: 'left', clickCount: 1, buttons: 0 })
await sleep(120)
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: targetPoint.x, y: targetPoint.y, button: 'left', clickCount: 2, buttons: 1 })
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: targetPoint.x, y: targetPoint.y, button: 'left', clickCount: 2, buttons: 0 })
await sleep(1400)

const back = await evaluate(`(() => ({
  graph: !!document.querySelector('.ms-canvas--graph'),
  flowNodes: document.querySelectorAll('.react-flow__node').length,
  mode: window.__ms.store.getState().settings.viewMode,
  selected: window.__ms.store.getState().doc.nodes.filter(n => n.selected).map(n => n.id),
}))()`)
check('双击回到流程图', back.graph === false && back.mode === 'flow' && back.flowNodes === 6, JSON.stringify(back))
check('回到流程图后定位到那张表', back.selected.length === 1 && back.selected[0] === fixture.ids.coupons, JSON.stringify(back.selected))

const posAfter = await evaluate(`JSON.stringify(window.__ms.store.getState().doc.nodes.map(n => [n.id, n.position.x, n.position.y]))`)
check('图谱没有写回任何坐标', posBefore === posAfter, posBefore === posAfter ? '' : `${posBefore} → ${posAfter}`)

const stillHidden = await evaluate(
  `window.__ms.store.getState().doc.nodes.find(n => n.id === ${JSON.stringify(fixture.ids.shipping)})?.hidden`,
)
check('隐藏状态没有被图谱改写', stillHidden === true, `hidden=${stillHidden}`)

/* ---------- 持久化 ---------- */

const persisted = await evaluate(`(() => {
  window.__ms.store.getState().saveNow()
  const settings = JSON.parse(localStorage.getItem('mermaid-studio:settings') || '{}')
  const docKey = 'mermaid-studio:doc:' + window.__ms.store.getState().doc.id
  const doc = JSON.parse(localStorage.getItem(docKey) || '{}')
  return { viewMode: settings.viewMode, docHasViewMode: 'viewMode' in doc, docNodes: (doc.nodes || []).length }
})()`)
check('视图模式记在全局 settings', persisted.viewMode === 'flow', JSON.stringify(persisted))
check('工程文档里没有 viewMode 字段', persisted.docHasViewMode === false, JSON.stringify(persisted))

await evaluate(`document.querySelector('[data-view="graph"]').click()`)
await sleep(500)
await send('Page.navigate', { url: APP + '/' })
await sleep(4000)

const afterReload = await evaluate(`(() => ({
  mode: window.__ms.store.getState().settings.viewMode,
  graph: !!document.querySelector('.ms-canvas--graph'),
  dots: document.querySelectorAll('.ms-gdot').length,
}))()`)
check('刷新后仍停在关系图谱', afterReload.mode === 'graph' && afterReload.graph === true && afterReload.dots === 4, JSON.stringify(afterReload))

console.log('\n--- 控制台错误 ---')
console.log(consoleErrors.length ? consoleErrors.join('\n') : '(无)')
console.log('--- 未捕获异常 ---')
console.log(exceptions.length ? exceptions.join('\n') : '(无)')

const failed = results.filter((r) => !r.ok)
console.log(`\n结果：${results.length - failed.length}/${results.length} 通过，控制台错误 ${consoleErrors.length}，异常 ${exceptions.length}`)

ws.close()
process.exit(failed.length || exceptions.length || consoleErrors.length ? 1 : 0)
