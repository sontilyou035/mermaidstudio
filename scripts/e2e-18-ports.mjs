const APP = process.env.MS_BASE || 'http://127.0.0.1:5273'

// 第十八轮：连接口默认分配（上进下出 / 左进右出）+ 人工可调
const list = await (await fetch('http://127.0.0.1:9333/json/list')).json()
const page = list.find((t) => t.type === 'page')
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((r) => (ws.onopen = r))
let id = 0
const pending = new Map()
const errors = []
ws.onmessage = (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m)
    pending.delete(m.id)
  }
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text)
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map((a) => a.value ?? a.description).join(' '))
}
const send = (method, params = {}) => {
  const i = ++id
  ws.send(JSON.stringify({ id: i, method, params }))
  return new Promise((r) => pending.set(i, r))
}
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description)
  return r.result?.result?.value
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const out = []
const check = (n, ok, d = '') => {
  out.push([n, ok])
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ` — ${d}` : ''}`)
}

await send('Runtime.enable')
await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1560, height: 940, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: APP + '/' })
await sleep(3500)
await ev(`(() => { Object.keys(localStorage).filter(k=>k.startsWith('mermaid-studio:')).forEach(k=>localStorage.removeItem(k)); return 1 })()`)
await send('Page.reload')
await sleep(3500)

check('调试接口可用', (await ev(`!!(window.__ms && window.__ms.store)`)) === true)

/**
 * 量一条边在画布上的真实起止点（flow 坐标系），
 * 和节点自己的 position/尺寸对比，判断连线是从哪条边出去的。
 */
const probe = `(() => {
  const st = window.__ms.store.getState()
  const nodes = new Map(st.doc.nodes.map((n) => [n.id, n]))
  const read = (edgeId) => {
    const el = document.querySelector('.react-flow__edge[data-id="' + edgeId + '"] .react-flow__edge-path')
    if (!el) return null
    const d = el.getAttribute('d') || ''
    const nums = d.match(/-?\\d+(?:\\.\\d+)?/g)
    if (!nums || nums.length < 4) return null
    return { start: { x: +nums[0], y: +nums[1] }, end: { x: +nums[nums.length - 2], y: +nums[nums.length - 1] } }
  }
  const side = (node, p) => {
    if (!node || !p) return '?'
    const { x, y } = node.position
    const { width: w, height: h } = node.data
    // 端口是挂在边框上、略微探出节点外的，所以留 12px 余量
    const near = (a, b) => Math.abs(a - b) <= 12
    if (near(p.y, y + h) && near(p.x, x + w / 2)) return 'bottom'
    if (near(p.y, y) && near(p.x, x + w / 2)) return 'top'
    if (near(p.x, x + w) && near(p.y, y + h / 2)) return 'right'
    if (near(p.x, x) && near(p.y, y + h / 2)) return 'left'
    return 'other(' + Math.round(p.x) + ',' + Math.round(p.y) + ')'
  }
  return st.doc.edges.map((e) => {
    const g = read(e.id)
    return {
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle ?? null,
      targetHandle: e.targetHandle ?? null,
      mode: e.data && e.data.handleMode,
      outSide: g ? side(nodes.get(e.source), g.start) : 'no-path',
      inSide: g ? side(nodes.get(e.target), g.end) : 'no-path',
    }
  })
})()`

/* ---------- 1. TB 导入：下出上入 ---------- */
await ev(`window.__ms.store.getState().importMermaid('flowchart TB\\n  A[开始] --> B[处理]\\n  B --> C[判断]')`)
await sleep(900)
let rows = await ev(probe)
check('解析出 2 条连线', rows.length === 2, JSON.stringify(rows.map((r) => [r.source, r.target])))
check(
  'TB：端口记为 下出 / 上入',
  rows.every((r) => r.sourceHandle === 'bottom' && r.targetHandle === 'top'),
  JSON.stringify(rows.map((r) => `${r.sourceHandle}/${r.targetHandle}`)),
)
check(
  'TB：实际从底边出去、落到顶边',
  rows.every((r) => r.outSide === 'bottom' && r.inSide === 'top'),
  JSON.stringify(rows.map((r) => `${r.outSide}->${r.inSide}`)),
)

/* ---------- 2. 切到 LR：右出左入 ---------- */
await ev(`window.__ms.store.getState().setDirection('LR')`)
await sleep(900)
rows = await ev(probe)
check(
  'LR：端口翻成 右出 / 左入',
  rows.every((r) => r.sourceHandle === 'right' && r.targetHandle === 'left'),
  JSON.stringify(rows.map((r) => `${r.sourceHandle}/${r.targetHandle}`)),
)
check(
  'LR：实际从右边出去、落到左边',
  rows.every((r) => r.outSide === 'right' && r.inSide === 'left'),
  JSON.stringify(rows.map((r) => `${r.outSide}->${r.inSide}`)),
)

/* ---------- 3. 人工改端口 ---------- */
const firstId = rows[0].id
await ev(`window.__ms.store.getState().setEdgeHandle('${firstId}', 'source', 'left')`)
await sleep(700)
rows = await ev(probe)
check('人工把出口改成 left', rows[0].sourceHandle === 'left' && rows[0].mode === 'manual', JSON.stringify(rows[0]))
check('渲染跟着人工端口走', rows[0].outSide === 'left', rows[0].outSide)

await ev(`window.__ms.store.getState().setDirection('TB')`)
await sleep(800)
rows = await ev(probe)
check('切方向不覆盖人工端口', rows[0].sourceHandle === 'left' && rows[0].outSide === 'left', JSON.stringify(rows[0]))
check(
  '其它自动边仍随方向走（下出上入）',
  rows.slice(1).every((r) => r.sourceHandle === 'bottom' && r.inSide === 'top'),
  JSON.stringify(rows.slice(1).map((r) => `${r.sourceHandle}/${r.outSide}`)),
)

/* ---------- 4. 恢复自动 ---------- */
await ev(`window.__ms.store.getState().resetEdgeHandles()`)
await sleep(700)
rows = await ev(probe)
check(
  '「全部按方向重设」只动自动边',
  rows[0].sourceHandle === 'left' && rows[1].sourceHandle === 'bottom',
  JSON.stringify(rows.map((r) => `${r.sourceHandle}/${r.mode}`)),
)

await ev(`window.__ms.store.getState().resetEdgeHandles('${firstId}')`)
await sleep(700)
rows = await ev(probe)
check('恢复自动后回到 bottom', rows[0].sourceHandle === 'bottom' && rows[0].mode === 'auto' && rows[0].outSide === 'bottom', JSON.stringify(rows[0]))

/* ---------- 5. 导出不携带端口信息 ---------- */
const code = await ev(`window.__ms.store.getState().currentMermaid(false)`)
check('导出的 Mermaid 不含端口字段', !/bottom|sourceHandle|targetHandle|handleMode/.test(code), code.split('\n').slice(0, 2).join(' | '))

/* ---------- 5b. 选中连线后，两端节点的连接头要看得见 ---------- */
await ev(`window.__ms.store.getState().selectEdge(window.__ms.store.getState().doc.edges[0].id)`)
await sleep(500)
const pinned = await ev(`(() => {
  const st = window.__ms.store.getState()
  const e = st.doc.edges.find((x) => x.selected)
  const nodeEl = (nid) => document.querySelector('.react-flow__node[data-id="' + nid + '"]')
  const handle = (nid, hid) =>
    nodeEl(nid)?.querySelector('.ms-handle[data-handleid="' + hid + '"]') ?? null
  const opacity = (el) => (el ? getComputedStyle(el).opacity : null)
  const other = st.doc.nodes.find((n) => n.id !== e.source && n.id !== e.target && !n.data.isSubgraph)
  const otherHandle = other ? nodeEl(other.id)?.querySelector('.ms-handle') : null
  const z = (el) => {
    const v = el ? getComputedStyle(el).zIndex : 'auto'
    return v === 'auto' ? 0 : Number(v)
  }
  return {
    sourceNotUsed: opacity(nodeEl(e.source)?.querySelector('.ms-handle:not(.is-used)')),
    sourceUsed: opacity(handle(e.source, e.sourceHandle)),
    targetUsed: opacity(handle(e.target, e.targetHandle)),
    usedClass: !!handle(e.source, e.sourceHandle)?.classList.contains('is-used'),
    otherOpacity: opacity(otherHandle),
    srcZ: z(nodeEl(e.source)),
    otherZ: other ? z(nodeEl(other.id)) : null,
  }
})()`)
check(
  '选中连线后两端节点的连接头可见',
  Number(pinned.sourceUsed) > 0 && Number(pinned.targetUsed) > 0 && Number(pinned.sourceNotUsed) > 0,
  JSON.stringify(pinned),
)
check('连线实际用到的那个连接头被高亮（is-used）', pinned.usedClass === true, String(pinned.usedClass))
check('没被选中的节点连接头仍然隐藏', pinned.otherOpacity === '0', String(pinned.otherOpacity))
check('端点节点被抬到普通节点之上（图层）', pinned.otherZ !== null && pinned.srcZ > pinned.otherZ, JSON.stringify({ srcZ: pinned.srcZ, otherZ: pinned.otherZ }))

await ev(`window.__ms.store.getState().clearSelection()`)
await sleep(400)
const unpinned = await ev(`(() => {
  const st = window.__ms.store.getState()
  const n = st.doc.nodes.find((x) => !x.data.isSubgraph)
  const el = document.querySelector('.react-flow__node[data-id="' + n.id + '"] .ms-handle')
  return el ? getComputedStyle(el).opacity : null
})()`)
check('取消选中后连接头重新隐藏', unpinned === '0', String(unpinned))

/* ---------- 6. 老文档（边没有端口）打开时自动补齐 ---------- */
await ev(`window.__ms.store.getState().saveNow()`)
const seeded = await ev(`(() => {
  const st = window.__ms.store.getState()
  const key = 'mermaid-studio:doc:' + st.doc.id
  const doc = JSON.parse(localStorage.getItem(key))
  doc.direction = 'TB'
  doc.edges = doc.edges.map((e) => { delete e.sourceHandle; delete e.targetHandle; if (e.data) delete e.data.handleMode; return e })
  localStorage.setItem(key, JSON.stringify(doc))
  return doc.edges.length
})()`)
await send('Page.reload')
await sleep(4000)
rows = await ev(probe)
check(
  `老文档 ${seeded} 条边打开后补上默认端口`,
  rows.length === seeded && rows.every((r) => r.sourceHandle === 'bottom' && r.targetHandle === 'top'),
  JSON.stringify(rows.map((r) => `${r.sourceHandle}/${r.targetHandle}`)),
)
check(
  '老文档的连线渲染也修好了',
  rows.every((r) => r.outSide === 'bottom' && r.inSide === 'top'),
  JSON.stringify(rows.map((r) => `${r.outSide}->${r.inSide}`)),
)

/* ---------- 汇总 ---------- */
const failed = out.filter(([, ok]) => !ok).length
console.log('\n--- 控制台错误 ---')
console.log(errors.length ? errors.join('\n') : '(无)')
console.log(`\n结果：${out.length - failed}/${out.length} 通过，控制台错误 ${errors.length}`)
ws.close()
process.exit(failed || errors.length ? 1 : 0)
