const APP = process.env.MS_BASE || 'http://127.0.0.1:5274'

// 第七轮：按住 Option/Alt 拖拽复制节点
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
const ALT = 1 // CDP modifiers 位掩码：1 = Alt
const mouse = (type, x, y, extra = {}) =>
  send('Input.dispatchMouseEvent', {
    type,
    x,
    y,
    button: type === 'mouseMoved' ? 'none' : 'left',
    buttons: type === 'mouseReleased' ? 0 : 1,
    clickCount: 1,
    ...extra,
  })
async function drag(a, b, { alt = false, steps = 12 } = {}) {
  const mods = alt ? ALT : 0
  await mouse('mousePressed', a.x, a.y, { modifiers: mods })
  for (let i = 1; i <= steps; i++) {
    await mouse('mouseMoved', a.x + (b.x - a.x) * i / steps, a.y + (b.y - a.y) * i / steps, { modifiers: mods })
    await sleep(28)
  }
  await mouse('mouseReleased', b.x, b.y, { modifiers: mods })
  await sleep(450)
}
const out = []
const check = (n, ok, d = '') => { out.push([n, ok]); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ` — ${d}` : ''}`) }

await send('Runtime.enable'); await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1560, height: 940, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: APP + '/' }); await sleep(5000)
await ev(`(() => { Object.keys(localStorage).filter(k=>k.startsWith('mermaid-studio:')).forEach(k=>localStorage.removeItem(k)); return 1 })()`)
await send('Page.navigate', { url: APP + '/' }); await sleep(5500)

/* ---------- 普通拖拽仍然只是移动，不复制 ---------- */
const before = await ev(`(() => {
  const s = window.__ms.store.getState()
  const n = s.doc.nodes[1]
  const r = document.querySelector('[data-id="' + n.id + '"]').getBoundingClientRect()
  return { id: n.id, label: n.data.label, pos: n.position, nodes: s.doc.nodes.length, edges: s.doc.edges.length,
           point: { x: r.x + r.width / 2, y: r.y + r.height / 2 },
           zoom: (() => { const t = document.querySelector('.react-flow__viewport').style.transform; return t.includes('scale(') ? parseFloat(t.split('scale(')[1]) : 1 })() }
})()`)
// 屏幕位移要除以画布缩放才是节点在流坐标里的位移
const screenDx = 120
const screenDy = 90
// 步数多一点：React Flow 从第一次 mousemove 起算位移，粗步长会少吃一步
await drag(before.point, { x: before.point.x + screenDx, y: before.point.y + screenDy }, { steps: 30 })
const afterPlain = await ev(`(() => {
  const s = window.__ms.store.getState()
  const n = s.doc.nodes.find(x => x.id === ${JSON.stringify(before.id)})
  return { nodes: s.doc.nodes.length, pos: n.position,
           dx: n.position.x - ${before.pos.x}, dy: n.position.y - ${before.pos.y} }
})()`)
const expectDx = screenDx / before.zoom
const expectDy = screenDy / before.zoom
check(
  '普通拖拽只移动、不复制',
  afterPlain.nodes === before.nodes &&
    Math.abs(afterPlain.dx - expectDx) < screenDx / 30 + 4 &&
    Math.abs(afterPlain.dy - expectDy) < screenDy / 30 + 4,
  `zoom=${before.zoom.toFixed(2)} 位移 ${afterPlain.dx.toFixed(1)},${afterPlain.dy.toFixed(1)} 期望 ${expectDx.toFixed(1)},${expectDy.toFixed(1)}`,
)

/* ---------- Alt 拖拽复制 ---------- */
const origin = await ev(`(() => {
  const s = window.__ms.store.getState()
  const n = s.doc.nodes.find(x => x.id === ${JSON.stringify(before.id)})
  const r = document.querySelector('[data-id="' + n.id + '"]').getBoundingClientRect()
  const edges = s.doc.edges.filter(e => e.source === n.id || e.target === n.id).length
  return { id: n.id, pos: { ...n.position }, label: n.data.label, edges,
           point: { x: r.x + r.width / 2, y: r.y + r.height / 2 } }
})()`)
await drag(origin.point, { x: origin.point.x + 150, y: origin.point.y - 120 }, { alt: true })

const dup = await ev(`(() => {
  const s = window.__ms.store.getState()
  const o = s.doc.nodes.find(x => x.id === ${JSON.stringify(origin.id)})
  const copies = s.doc.nodes.filter(x => x.id !== ${JSON.stringify(origin.id)} && x.data.label === ${JSON.stringify(origin.label)})
  const copy = copies[copies.length - 1]
  const copyEdges = copy ? s.doc.edges.filter(e => e.source === copy.id || e.target === copy.id).length : -1
  return {
    total: s.doc.nodes.length, edgeTotal: s.doc.edges.length,
    originPos: o.position, originEdges: s.doc.edges.filter(e => e.source === o.id || e.target === o.id).length,
    copyId: copy?.id ?? null, copyPos: copy?.position ?? null, copyEdges,
    copySelected: !!copy?.selected, originSelected: !!o.selected,
    copyInDom: copy ? !!document.querySelector('[data-id="' + copy.id + '"]') : false,
    toast: document.querySelector('.ms-toast')?.textContent ?? null,
  }
})()`)
check('Alt 拖拽新增了一个副本', dup.total === before.nodes + 1 && !!dup.copyId, JSON.stringify({ total: dup.total, copyId: dup.copyId }))
check('原件留在原地没动', Math.round(dup.originPos.x) === Math.round(origin.pos.x) && Math.round(dup.originPos.y) === Math.round(origin.pos.y), JSON.stringify([origin.pos, dup.originPos]))
check('副本落在拖到的位置', dup.copyPos && Math.abs(dup.copyPos.x - origin.pos.x) > 60 && Math.abs(dup.copyPos.y - origin.pos.y) > 60, JSON.stringify(dup.copyPos))
check('原件仍保留原有连线', dup.originEdges === origin.edges && dup.edgeTotal === before.edges, JSON.stringify({ originEdges: dup.originEdges, expect: origin.edges, edgeTotal: dup.edgeTotal }))
check('副本不带连线（与复制按钮行为一致）', dup.copyEdges === 0, `copyEdges=${dup.copyEdges}`)
check('副本被选中、原件取消选中', dup.copySelected === true && dup.originSelected === false, JSON.stringify({ copySelected: dup.copySelected, originSelected: dup.originSelected }))
check('副本渲染到画布上', dup.copyInDom === true)
check('有复制成功的提示', (dup.toast || '').includes('已复制'), dup.toast)

/* ---------- 内容一致（同一个节点块、同样的字段值） ---------- */
const content = await ev(`(() => {
  const s = window.__ms.store.getState()
  const o = s.doc.nodes.find(x => x.id === ${JSON.stringify(origin.id)})
  const c = s.doc.nodes.find(x => x.id === ${JSON.stringify(dup.copyId)})
  return { blockSame: o.data.blockId === c.data.blockId, labelSame: o.data.label === c.data.label, shapeSame: o.data.shape === c.data.shape, fillSame: o.data.fill === c.data.fill, sizeSame: o.data.width === c.data.width && o.data.height === c.data.height }
})()`)
check('副本内容与原节点一致（块/文本/形状/配色/尺寸）', Object.values(content).every(Boolean), JSON.stringify(content))

/* ---------- 撤销：一次性回到复制前 ---------- */
const undo = await ev(`(() => {
  window.__ms.store.getState().undo()
  const s = window.__ms.store.getState()
  return { nodes: s.doc.nodes.length, edges: s.doc.edges.length, hasCopy: s.doc.nodes.some(n => n.id === ${JSON.stringify(dup.copyId)}) }
})()`)
check('撤销后副本消失、节点数还原', undo.nodes === before.nodes && undo.hasCopy === false, JSON.stringify(undo))

/* ---------- 只按 Alt 点一下（没拖动）不应产生副本 ---------- */
const clickOnly = await ev(`(() => {
  const s = window.__ms.store.getState()
  const n = s.doc.nodes.find(x => x.id === ${JSON.stringify(origin.id)})
  const r = document.querySelector('[data-id="' + n.id + '"]').getBoundingClientRect()
  return { nodes: s.doc.nodes.length, point: { x: r.x + r.width / 2, y: r.y + r.height / 2 } }
})()`)
await mouse('mousePressed', clickOnly.point.x, clickOnly.point.y, { modifiers: ALT })
await mouse('mouseReleased', clickOnly.point.x, clickOnly.point.y, { modifiers: ALT })
await sleep(500)
const afterClick = await ev(`window.__ms.store.getState().doc.nodes.length`)
check('只按住 Alt 点一下不会产生副本', afterClick === clickOnly.nodes, `节点数 ${clickOnly.nodes} -> ${afterClick}`)

/* ---------- 多选一起 Alt 拖拽 ---------- */
const multi = await ev(`(() => {
  const s = window.__ms.store.getState()
  const ids = s.doc.nodes.slice(0, 2).map(n => n.id)
  window.__ms.store.getState().selectOnly(ids)
  const r = document.querySelector('[data-id="' + ids[0] + '"]').getBoundingClientRect()
  return { ids, nodes: s.doc.nodes.length, point: { x: r.x + r.width / 2, y: r.y + r.height / 2 } }
})()`)
await drag(multi.point, { x: multi.point.x + 60, y: multi.point.y + 220 }, { alt: true })
const afterMulti = await ev(`(() => {
  const s = window.__ms.store.getState()
  const selected = s.doc.nodes.filter(n => n.selected)
  const moved = ${JSON.stringify(multi.ids)}.map(id => s.doc.nodes.find(n => n.id === id).position)
  return { nodes: s.doc.nodes.length, selectedCount: selected.length, moved }
})()`)
check('多选时 Alt 拖拽复制整组', afterMulti.nodes === multi.nodes + 2 && afterMulti.selectedCount === 2, JSON.stringify(afterMulti))

/* ---------- 分组节点 Alt 拖拽：组内节点不跟着走 ---------- */
const groupCase = await ev(`(async () => {
  const s = window.__ms.store.getState()
  const ids = s.doc.nodes.filter(n => !n.data.isSubgraph).slice(0, 2).map(n => n.id)
  window.__ms.store.getState().selectOnly(ids)
  window.__ms.store.getState().groupSelection()
  const st = window.__ms.store.getState()
  const g = st.doc.nodes.find(n => n.data.isSubgraph)
  window.__ms.store.getState().selectOnly([g.id])
  // 等分组节点渲染完成
  let el = null
  for (let i = 0; i < 20 && !el; i++) {
    await new Promise(res => setTimeout(res, 100))
    el = document.querySelector('[data-id="' + g.id + '"]')
  }
  const r = el.getBoundingClientRect()
  return { g: g.id, pos: { ...g.position }, members: st.doc.nodes.filter(n => n.data.groupId === g.id).map(n => ({ id: n.id, pos: { ...n.position } })),
           nodes: st.doc.nodes.length, point: { x: r.x + r.width / 2, y: r.y + 24 } }
})()`)
await drag(groupCase.point, { x: groupCase.point.x + 140, y: groupCase.point.y + 40 }, { alt: true })
const afterGroup = await ev(`(() => {
  const s = window.__ms.store.getState()
  const g = s.doc.nodes.find(n => n.id === ${JSON.stringify(groupCase.g)})
  const members = ${JSON.stringify(groupCase.members.map((m) => m.id))}.map(id => s.doc.nodes.find(n => n.id === id))
  return {
    nodes: s.doc.nodes.length,
    groupStillThere: !!g,
    groupPos: g.position,
    membersMoved: members.some((m, i) => Math.abs(m.position.x - ${JSON.stringify(groupCase.members)}[i].pos.x) > 1),
    groups: s.doc.nodes.filter(n => n.data.isSubgraph).length,
  }
})()`)
check('Alt 拖拽分组：原件留在原地', Math.abs(afterGroup.groupPos.x - groupCase.pos.x) < 1 && Math.abs(afterGroup.groupPos.y - groupCase.pos.y) < 1, JSON.stringify([groupCase.pos, afterGroup.groupPos]))
check('Alt 拖拽分组：组内节点没被带走', afterGroup.membersMoved === false)
check('Alt 拖拽分组：多出一个分组副本', afterGroup.groups === 2 && afterGroup.nodes === groupCase.nodes + 1, JSON.stringify(afterGroup))

console.log('\n异常/错误:', errors.length ? errors.join('\n') : '(无)')
const failed = out.filter(([, ok]) => !ok).length
console.log(`结果：${out.length - failed}/${out.length} 通过`)
ws.close()
process.exit(failed || errors.length ? 1 : 0)
