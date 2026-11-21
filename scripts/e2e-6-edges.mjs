const APP = process.env.MS_BASE || 'http://127.0.0.1:5274'

// 第六轮：连线编辑 / 拖入默认选中 / 去掉重置按钮
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
const mouse = (type, x, y, extra = {}) =>
  send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1, ...extra })
async function drag(a, b, steps = 12) {
  await mouse('mousePressed', a.x, a.y)
  for (let i = 1; i <= steps; i++) { await mouse('mouseMoved', a.x + (b.x - a.x) * i / steps, a.y + (b.y - a.y) * i / steps); await sleep(28) }
  await mouse('mouseReleased', b.x, b.y)
  await sleep(350)
}
async function dblclick(p) {
  await mouse('mousePressed', p.x, p.y, { clickCount: 1 })
  await mouse('mouseReleased', p.x, p.y, { clickCount: 1 })
  await mouse('mousePressed', p.x, p.y, { clickCount: 2 })
  await mouse('mouseReleased', p.x, p.y, { clickCount: 2 })
  await sleep(400)
}
const out = []
const check = (n, ok, d = '') => { out.push([n, ok]); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ` — ${d}` : ''}`) }

await send('Runtime.enable'); await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1560, height: 940, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: APP + '/' }); await sleep(5000)
await ev(`(() => { Object.keys(localStorage).filter(k=>k.startsWith('mermaid-studio:')).forEach(k=>localStorage.removeItem(k)); return 1 })()`)
await send('Page.reload'); await sleep(5500)

/* ---------- 2. 拖入节点块默认选中 ---------- */
const dropSelect = await ev(`(async () => {
  const before = new Set(window.__ms.store.getState().doc.nodes.map((n) => n.id))
  const pane = document.querySelector('.react-flow__pane')
  const dt = new DataTransfer()
  dt.setData('application/mermaid-block', 'builtin.process')
  const r = pane.getBoundingClientRect()
  pane.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, clientX: r.left + 700, clientY: r.top + 600, dataTransfer: dt }))
  await new Promise(res => setTimeout(res, 500))
  const s = window.__ms.store.getState()
  // 落点之后节点会按「从上到下」重排，所以不能假设新节点一定在数组末尾
  const added = s.doc.nodes.find((n) => !before.has(n.id)) ?? s.doc.nodes[s.doc.nodes.length - 1]
  return {
    id: added.id, selected: !!added.selected,
    selectedCount: s.doc.nodes.filter(n => n.selected).length,
    tab: s.rightTab,
    ringInDom: !!document.querySelector('[data-id="' + added.id + '"] .ms-node.is-selected'),
    resizeHandles: document.querySelectorAll('[data-id="' + added.id + '"] .react-flow__resize-control').length,
  }
})()`)
check('拖入节点块后默认被选中', dropSelect.selected === true && dropSelect.selectedCount === 1, JSON.stringify(dropSelect))
check('选中状态在画布上可见（选中框 + 缩放手柄）', dropSelect.ringInDom && dropSelect.resizeHandles > 0)
check('拖入后自动切到检查器', dropSelect.tab === 'inspector', dropSelect.tab)

// 点击调色板添加也选中
const clickSelect = await ev(`(async () => {
  const items = [...document.querySelectorAll('.ms-block-item')]
  const item = items.find(e => e.textContent.includes('数据库'))
  item.click()
  await new Promise(res => setTimeout(res, 500))
  const s = window.__ms.store.getState()
  return { selected: s.doc.nodes.filter(n => n.selected).length, label: s.doc.nodes.find(n => n.selected)?.data.label }
})()`)
check('点击调色板添加也会选中新节点', clickSelect.selected === 1 && clickSelect.label === '数据库', JSON.stringify(clickSelect))

/* ---------- 3. 去掉颜色重置按钮 ---------- */
const noReset = await ev(`(async () => {
  window.__ms.store.getState().setRightTab('inspector')
  await new Promise(r => setTimeout(r, 500))
  const rows = [...document.querySelectorAll('.ms-right .ms-row')]
  const pick = (name) => rows.find(r => r.querySelector('.ms-row__label')?.textContent === name)
  return {
    fillButtons: [...(pick('填充')?.querySelectorAll('button') ?? [])].map(b => b.textContent.trim()),
    strokeButtons: [...(pick('边框')?.querySelectorAll('button') ?? [])].map(b => b.textContent.trim()),
    textButtons: [...(pick('文字')?.querySelectorAll('button') ?? [])].map(b => b.textContent.trim()),
    anyReset: [...document.querySelectorAll('.ms-right button')].some(b => b.textContent.trim() === '重置'),
  }
})()`)
check('颜色行只剩「无」按钮，没有重置', !noReset.anyReset && noReset.fillButtons.join() === '无' && noReset.strokeButtons.join() === '无' && noReset.textButtons.join() === '无', JSON.stringify(noReset))

/* ---------- 1. 连线：单击选中 / 双击改标签 / 跟随节点移动与缩放 ---------- */
// 用一张干净的图：两个节点一条长连线，避免被节点遮挡
const fixture = await ev(`(() => {
  window.__ms.store.getState().newDoc()
  const a = window.__ms.store.getState().addNodeFromBlock('builtin.start', { x: 60, y: 60 }, 'A')
  const b = window.__ms.store.getState().addNodeFromBlock('builtin.process', { x: 620, y: 430 }, 'B')
  window.__ms.store.getState().onConnect({ source: a, target: b, sourceHandle: 'right', targetHandle: 'top' })
  window.__ms.store.getState().clearSelection()
  return { a, b, edges: window.__ms.store.getState().doc.edges.length }
})()`)
check('准备一张两个节点的测试图', fixture.edges === 1, JSON.stringify(fixture))
await sleep(700)

const freePoint = await ev(`(() => {
  const s = window.__ms.store.getState()
  const e = s.doc.edges[0]
  const path = document.querySelector('.react-flow__edge[data-id="' + e.id + '"] .react-flow__edge-path')
  for (let t = 0.1; t <= 0.9; t += 0.02) {
    const p = path.getPointAtLength(path.getTotalLength() * t)
    const sc = new DOMPoint(p.x, p.y).matrixTransform(path.getScreenCTM())
    const top = document.elementFromPoint(sc.x, sc.y)
    const cls = typeof top?.className === 'string' ? top.className : ''
    if (cls.includes('react-flow__edge') || cls.includes('ms-edge-label')) return { x: sc.x, y: sc.y, t: +t.toFixed(2), top: cls.split(' ')[0] }
  }
  return null
})()`)
check('连线上有可点击的空白点', !!freePoint, JSON.stringify(freePoint))

// 单击选中
await mouse('mousePressed', freePoint.x, freePoint.y)
await mouse('mouseReleased', freePoint.x, freePoint.y)
await sleep(400)
const clickSel = await ev(`(() => {
  const s = window.__ms.store.getState()
  return {
    selectedEdges: s.doc.edges.filter(e => e.selected).length,
    selectedNodes: s.doc.nodes.filter(n => n.selected).length,
    inspectorHasEdge: (document.querySelector('.ms-right')?.innerText || '').includes('连线'),
  }
})()`)
check('单击连线即可选中并可在检查器里编辑', clickSel.selectedEdges === 1 && clickSel.selectedNodes === 0 && clickSel.inspectorHasEdge, JSON.stringify({ ...clickSel, freePoint }))

// 双击改标签（新连线默认空白，这里先给个类型，验证「类型: 说明」的拆解）
await ev(`(() => { const s = window.__ms.store.getState(); s.setEdgeLabelType(s.doc.edges[0].id, '下一步', ''); return 1 })()`)
await sleep(300)
await dblclick(freePoint)
const editing = await ev(`(async () => {
  const input = document.querySelector('.ms-edge-label-input')
  if (!input) return { open: false }
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setter.call(input, '是')
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  await new Promise(r => setTimeout(r, 500))
  const s = window.__ms.store.getState()
  // 标签规范：类型必填，输入的文字作为「说明」
  return { open: true, label: s.doc.edges[0].data.label, type: s.doc.edges[0].data.type, note: s.doc.edges[0].data.note,
           inDom: document.querySelector('.ms-edge-label')?.textContent,
           inMermaid: s.currentMermaid().includes('|下一步: 是|') }
})()`)
check('双击连线弹出标签输入框', editing.open === true, JSON.stringify(editing))
check(
  '回车后标签写入模型 / 画面 / Mermaid（类型: 说明）',
  editing.label === '下一步: 是' && editing.inDom === '下一步: 是' && editing.inMermaid === true,
  JSON.stringify(editing),
)

// 缩放起点节点 → 端点仍精确贴住连接口
const sizeBefore = await ev(`(() => { const s = window.__ms.store.getState(); const A = s.doc.nodes.find(n => n.id === ${JSON.stringify(fixture.a)}); return { w: A.data.width, h: A.data.height } })()`)
const handle = await ev(`(async () => {
  window.__ms.store.getState().selectOnly([${JSON.stringify(fixture.a)}])
  await new Promise(r => setTimeout(r, 500))
  const hs = [...document.querySelectorAll('.react-flow__node[data-id="' + ${JSON.stringify(fixture.a)} + '"] .ms-resize-handle')]
  const t = hs.find(h => h.className.includes('bottom') && h.className.includes('right'))
  const r = t.getBoundingClientRect()
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
})()`)
await drag(handle, { x: handle.x + 100, y: handle.y + 70 })

const endpointCheck = `(() => {
  const s = window.__ms.store.getState()
  const e = s.doc.edges[0]
  const A = s.doc.nodes.find(n => n.id === e.source)
  const path = document.querySelector('.react-flow__edge[data-id="' + e.id + '"] .react-flow__edge-path')
  const nums = (path.getAttribute('d') || '').slice(1).split(/[ ,]+/).map(parseFloat)
  const ctm = path.getScreenCTM().inverse()
  const handles = [...document.querySelectorAll('[data-id="' + A.id + '"] .react-flow__handle')].map(h => {
    const r = h.getBoundingClientRect()
    const f = new DOMPoint(r.x + r.width / 2, r.y + r.height / 2).matrixTransform(ctm)
    return { side: h.className.match(/handle-(top|right|bottom|left)/)?.[1], dist: Math.hypot(f.x - nums[0], f.y - nums[1]) }
  }).sort((a, b) => a.dist - b.dist)
  return { size: { w: A.data.width, h: A.data.height }, start: [nums[0], nums[1]], nearest: handles[0] }
})()`
const afterResize = await ev(endpointCheck)
check(
  '节点缩放后连线端点仍贴住连接口',
  afterResize.size.w > sizeBefore.w + 50 && afterResize.nearest.dist < 6,
  `尺寸 ${sizeBefore.w}→${afterResize.size.w} · 最近连接口 ${afterResize.nearest.side} 偏差 ${afterResize.nearest.dist.toFixed(2)}px`,
)

// 移动节点 → 连线跟随
const nodePos = await ev(`(() => {
  const r = document.querySelector('[data-id="' + ${JSON.stringify(fixture.a)} + '"]').getBoundingClientRect()
  return { x: r.x + r.width / 2, y: r.y + 12 }
})()`)
const startBefore = afterResize.start
await drag(nodePos, { x: nodePos.x + 60, y: nodePos.y + 50 })
const afterMove = await ev(endpointCheck)
check(
  '移动节点后连线跟随且端点吸附连接口',
  Math.abs(afterMove.start[0] - startBefore[0]) > 20 && afterMove.nearest.dist < 6,
  JSON.stringify({ startBefore, afterMove }),
)

// 新连线带端口信息
const newEdge = await ev(`(() => {
  const s = window.__ms.store.getState()
  window.__ms.store.getState().onConnect({ source: ${JSON.stringify(fixture.b)}, target: ${JSON.stringify(fixture.a)}, sourceHandle: 'bottom', targetHandle: 'left' })
  const e = window.__ms.store.getState().doc.edges.slice(-1)[0]
  return { sourceHandle: e.sourceHandle, targetHandle: e.targetHandle, count: window.__ms.store.getState().doc.edges.length }
})()`)
check('新建连线带端口信息', newEdge.sourceHandle === 'bottom' && newEdge.targetHandle === 'left', JSON.stringify(newEdge))

/* ---------- 手动拐点：连线走向可编辑 ---------- */
const wpSetup = await ev(`(async () => {
  const st = () => window.__ms.store.getState()
  st().newDoc()
  await new Promise((r) => setTimeout(r, 300))
  const a = st().addNodeFromBlock('builtin.start', { x: 260, y: 120 }, 'A')
  const b = st().addNodeFromBlock('builtin.process', { x: 260, y: 360 }, 'B')
  st().onConnect({ source: a, target: b, sourceHandle: 'bottom', targetHandle: 'top' })
  await new Promise((r) => setTimeout(r, 500))
  const e = st().doc.edges[0]
  st().selectEdge(e.id)
  await new Promise((r) => setTimeout(r, 500))
  const add = document.querySelector('.ms-edge-waypoint-add')
  const r = add?.getBoundingClientRect()
  return {
    edge: e.id,
    hasAdd: !!add,
    addAt: r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null,
    path: document.querySelector('.react-flow__edge-path')?.getAttribute('d') ?? '',
  }
})()`)
check('选中连线后出现「＋」走位手柄', wpSetup.hasAdd === true && !!wpSetup.addAt, JSON.stringify({ hasAdd: wpSetup.hasAdd }))

// 从 ＋ 拖出一个拐点（落在画布内）
await drag(wpSetup.addAt, { x: wpSetup.addAt.x + 170, y: wpSetup.addAt.y })
const wpAdded = await ev(`(() => {
  const st = window.__ms.store.getState()
  const e = st.doc.edges[0]
  const dot = document.querySelector('.ms-edge-waypoint')
  return {
    waypoints: e.data.waypoints ?? null,
    dots: document.querySelectorAll('.ms-edge-waypoint').length,
    dotAt: dot ? (() => { const r = dot.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })() : null,
    path: document.querySelector('.react-flow__edge-path')?.getAttribute('d') ?? '',
    inspector: (document.querySelector('.ms-right')?.innerText || ''),
  }
})()`)
check(
  '拖「＋」能加一个拐点，连线按折线走',
  wpAdded.waypoints?.length === 1 && wpAdded.dots === 1 && wpAdded.path !== wpSetup.path && wpAdded.path.includes('Q'),
  JSON.stringify({ waypoints: wpAdded.waypoints, path: wpAdded.path.slice(0, 60) }),
)
check('检查器里能看到拐点数量', /拐点/.test(wpAdded.inspector) && wpAdded.inspector.includes('1 个'), wpAdded.inspector.split('\n').find((l) => l.includes('拐点')) ?? '')

// 拖拐点改走向
const beforeDrag = wpAdded.waypoints[0]
const dotCenter = await ev(`(() => { const d = document.querySelector('.ms-edge-waypoint'); const r = d.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`)
await drag(dotCenter, { x: dotCenter.x - 60, y: dotCenter.y + 60 })
const wpMoved = await ev(`(() => { const e = window.__ms.store.getState().doc.edges[0]; return { waypoints: e.data.waypoints ?? [] } })()`)
check(
  '拖动拐点能改连线走向',
  wpMoved.waypoints.length === 1 &&
    (Math.abs(wpMoved.waypoints[0].x - beforeDrag.x) > 20 || Math.abs(wpMoved.waypoints[0].y - beforeDrag.y) > 20),
  JSON.stringify({ before: beforeDrag, after: wpMoved.waypoints[0] }),
)

// 每个「段」都有自己的「＋」：有 1 个拐点时应该出现 2 个
const multiAdd = await ev(`(() => {
  const hs = [...document.querySelectorAll('.ms-edge-waypoint-add')].map((h) => {
    const r = h.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })
  return { count: hs.length, hs }
})()`)
check('有 1 个拐点时，两段各有一个「＋」（可继续加）', multiAdd.count === 2, JSON.stringify({ count: multiAdd.count }))

const beforeSecond = await ev(`(() => (window.__ms.store.getState().doc.edges[0].data.waypoints ?? []).length)()`)
await drag(multiAdd.hs[0], { x: multiAdd.hs[0].x - 110, y: multiAdd.hs[0].y + 10 })
const afterSecond = await ev(`(() => {
  const wps = window.__ms.store.getState().doc.edges[0].data.waypoints ?? []
  return { count: wps.length, dots: document.querySelectorAll('.ms-edge-waypoint').length, adds: document.querySelectorAll('.ms-edge-waypoint-add').length }
})()`)
check(
  '从另一段再拖一个「＋」能加第二个拐点',
  beforeSecond === 1 && afterSecond.count === 2 && afterSecond.dots === 2 && afterSecond.adds === 3,
  JSON.stringify({ beforeSecond, ...afterSecond }),
)

// 拐点与标签同坐标时，拐点要盖在标签上面（能拖，不会被遮住）
const overlap = await ev(`(async () => {
  const st = () => window.__ms.store.getState()
  const e = st().doc.edges[0]
  const label = document.querySelector('.ms-edge-label-wrap')
  const lr = label.getBoundingClientRect()
  const cx = lr.left + lr.width / 2
  const cy = lr.top + lr.height / 2
  // 内联样式是 translate(-50%, -50%) translate(Xpx, Ypx)，取后两个数字就是画布坐标
  const nums = (label.style.transform.match(/-?[\\d.]+/g) || []).map(Number)
  const flow = nums.length >= 4 ? { x: nums[nums.length - 2], y: nums[nums.length - 1] } : null
  st().updateEdgeData(e.id, { waypoints: [flow] })
  await new Promise((r) => setTimeout(r, 400))
  const dot = document.querySelector('.ms-edge-waypoint')
  const dr = dot?.getBoundingClientRect()
  const hits = document.elementsFromPoint(cx, cy).slice(0, 3).map((el) => el.className)
  return {
    flow,
    same: dr ? Math.abs(dr.left + dr.width / 2 - cx) < 2 && Math.abs(dr.top + dr.height / 2 - cy) < 2 : false,
    topIsWaypoint: (hits[0] || '').includes('ms-edge-waypoint'),
    hits,
    dot: dr ? { x: dr.left + dr.width / 2, y: dr.top + dr.height / 2 } : null,
  }
})()`)
check(
  '拐点和标签同坐标时，拐点在最上层（可命中）',
  overlap.same === true && overlap.topIsWaypoint === true,
  JSON.stringify({ same: overlap.same, hits: overlap.hits }),
)
if (overlap.dot) {
  await drag(overlap.dot, { x: overlap.dot.x + 130, y: overlap.dot.y })
  const afterOverlapDrag = await ev(`(() => ({ wps: window.__ms.store.getState().doc.edges[0].data.waypoints ?? [] }))()`)
  check(
    '被标签压着的拐点也能拖动',
    afterOverlapDrag.wps.length === 1 && Math.abs(afterOverlapDrag.wps[0].x - overlap.flow.x) > 40,
    JSON.stringify({ before: overlap.flow, after: afterOverlapDrag.wps[0] }),
  )
}

// 检查器「清除拐点」
const cleared = await ev(`(async () => {
  const st = () => window.__ms.store.getState()
  const btn = [...document.querySelectorAll('.ms-right button')].find((b) => b.textContent.includes('清除拐点'))
  btn?.click()
  await new Promise((r) => setTimeout(r, 400))
  return { waypoints: st().doc.edges[0].data.waypoints ?? [], dots: document.querySelectorAll('.ms-edge-waypoint').length }
})()`)
check('检查器可以一键清除拐点', cleared.waypoints.length === 0 && cleared.dots === 0, JSON.stringify(cleared))

// 再拖一个拐点，用真实双击删掉
const addAgain = await ev(`(() => { const a = document.querySelector('.ms-edge-waypoint-add'); const r = a?.getBoundingClientRect(); return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null })()`)
await drag(addAgain, { x: addAgain.x + 120, y: addAgain.y - 20 })
const dot2 = await ev(`(() => { const d = document.querySelector('.ms-edge-waypoint'); const r = d?.getBoundingClientRect(); return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null })()`)
await dblclick(dot2)
const wpDeleted = await ev(`(() => ({ waypoints: window.__ms.store.getState().doc.edges[0].data.waypoints ?? [], dots: document.querySelectorAll('.ms-edge-waypoint').length }))()`)
check('双击拐点可以删掉它', wpDeleted.waypoints.length === 0 && wpDeleted.dots === 0, JSON.stringify(wpDeleted))

// 直角：所有线段都是横/竖的（含拖动节点之后）
const ortho = await ev(`(async () => {
  const st = () => window.__ms.store.getState()
  const readPath = () => document.querySelector('.react-flow__edge-path')?.getAttribute('d') ?? ''
  const axisAligned = () => {
    const d = readPath()
    const nums = (d.match(/-?\\d+(?:\\.\\d+)?/g) || []).map(Number)
    const pts = []
    for (let i = 0; i + 1 < nums.length; i += 2) pts.push({ x: nums[i], y: nums[i + 1] })
    const bad = []
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]
      const b = pts[i]
      if (Math.abs(a.x - b.x) > 0.6 && Math.abs(a.y - b.y) > 0.6) bad.push([a, b])
    }
    return { points: pts.length, bad }
  }
  const e = st().doc.edges[0]
  // 放一个和两端都不对齐的拐点，逼出直角路由
  st().updateEdgeData(e.id, { waypoints: [{ x: 520, y: 300 }] })
  await new Promise((r) => setTimeout(r, 400))
  const before = axisAligned()
  const beforeD = readPath()

  // 把目标节点拖到别处（程序化位移，等价于拖拽结束后的位置）
  const tgt = st().doc.edges[0].target
  st().onNodesChange([{ id: tgt, type: 'position', position: { x: 620, y: 520 }, dragging: false }])
  await new Promise((r) => setTimeout(r, 600))
  const after = axisAligned()
  const afterD = readPath()
  return { before, after, changed: beforeD !== afterD }
})()`)
check(
  '有拐点时连线保持直角（没有斜线段）',
  ortho.before.bad.length === 0 && ortho.before.points >= 6,
  JSON.stringify({ points: ortho.before.points, bad: ortho.before.bad.slice(0, 2) }),
)
check(
  '拖动节点后依然自动重排成直角',
  ortho.changed === true && ortho.after.bad.length === 0,
  JSON.stringify({ changed: ortho.changed, points: ortho.after.points, bad: ortho.after.bad.slice(0, 2) }),
)

// 拐点不写进 Mermaid
const wpCode = await ev(`(() => {
  const st = () => window.__ms.store.getState()
  st().elected
  return st().currentMermaid(false)
})()`)
check('拐点只存在画布数据里，不写进 Mermaid', !/waypoint/i.test(wpCode) && wpCode.split('\n').filter((l) => l.includes('-->')).length === 1, wpCode.split('\n').slice(1, 3).join(' | '))

console.log('\n异常/错误:', errors.length ? errors.join('\n') : '(无)')
const failed = out.filter(([, ok]) => !ok).length
console.log(`结果：${out.length - failed}/${out.length} 通过`)
ws.close()
process.exit(failed || errors.length ? 1 : 0)
