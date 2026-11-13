// 验收：① 处理节点是 Onevra 卡片样式 ② 默认箭头 / 空格变手型
const APP = process.env.MS_BASE || 'http://127.0.0.1:5273'
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
const ev = async (x) => { const r = await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description); return r.result?.result?.value }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const out = []; const check = (n, ok, d = '') => { out.push([n, ok]); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ` — ${d}` : ''}`) }

await send('Runtime.enable'); await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1560, height: 940, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: `${APP}/` }); await sleep(5000)
await ev(`(() => { Object.keys(localStorage).filter(k=>k.startsWith('mermaid-studio:')).forEach(k=>localStorage.removeItem(k)); return 1 })()`)
await send('Page.navigate', { url: `${APP}/` }); await sleep(5500)

/* ---------- ① 处理节点 = 卡片 ---------- */
const card = await ev(`(async () => {
  const s = window.__ms.store.getState()
  s.newDoc()
  const nid = window.__ms.store.getState().addNodeFromBlock('builtin.process', { x: 200, y: 160 }, '生成订单')
  window.__ms.store.getState().setNodeField(nid, 'status', 'in progress')
  window.__ms.store.getState().setNodeField(nid, 'fn', 'order_create')
  await new Promise(r => setTimeout(r, 600))
  window.__ms.store.getState().updateNodeData(nid, { label: '生成订单' })
  await new Promise(r => setTimeout(r, 400))
  const el = document.querySelector('[data-id="' + nid + '"]')
  const cardEl = el?.querySelector('.ms-card')
  const tile = el?.querySelector('.ms-card__tile')
  const title = el?.querySelector('.ms-card__title')
  const cs = cardEl ? getComputedStyle(cardEl) : null
  const ttl = title ? getComputedStyle(title) : null
  return {
    hasCard: !!cardEl, hasTile: !!tile, hasTitle: !!title,
    radius: cs?.borderRadius, border: cs?.borderTopWidth, shadow: cs?.boxShadow !== 'none',
    bg: cs?.backgroundColor,
    titleWeight: ttl?.fontWeight, titleText: title?.textContent,
    descs: [...(el?.querySelectorAll('.ms-card__desc') ?? [])].map((d) => d.textContent),
    descSize: (() => { const d = el?.querySelector('.ms-card__desc'); return d ? getComputedStyle(d).fontSize : null })(),
    descWeight: (() => { const d = el?.querySelector('.ms-card__desc'); return d ? getComputedStyle(d).fontWeight : null })(),
    textAlign: (() => { const b = el?.querySelector('.ms-card__body'); return b ? getComputedStyle(b).textAlign : null })(),
    shapeSvgLeft: !!el?.querySelector('svg.shape-frame'),
    handleCount: el?.querySelectorAll('.ms-handle').length ?? 0,
    handleOpacity: (() => { const h = el?.querySelector('.ms-handle'); return h ? getComputedStyle(h).opacity : null })(),
    center: (() => { const r = el?.getBoundingClientRect(); return r ? { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) } : null })(),
    nid,
    mermaidLine: window.__ms.store.getState().currentMermaid().split('\\n').find(l => l.includes('生成订单')) || '',
  }
})()`)
check('处理节点渲染成卡片（.ms-card）', card.hasCard === true && card.shapeSvgLeft === false)
check('卡片：14 圆角 + 1px 软描边 + 投影', card.radius === '14px' && cards(card.border) <= 1.5 && card.shadow, JSON.stringify({ r: card.radius, b: card.border, shadow: card.shadow }))
check('卡片底用 surface（不是语义填充色）', card.bg === 'rgb(254, 254, 253)', card.bg)
check('卡片不带图标块（齿轮已去掉）', card.hasTile === false, 'tile=' + String(card.hasTile))
check('标题 600 字重 + 正确文本', card.titleWeight === '600' && card.titleText === '生成订单', JSON.stringify({ w: card.titleWeight, t: card.titleText }))
check('两行 topic：状态 + 函数名', JSON.stringify(card.descs) === JSON.stringify(['in progress', 'order_create']), JSON.stringify(card.descs))
check('topic 比标题更小更细（10px / 400）', card.descSize === '10px' && card.descWeight === '400', JSON.stringify({ size: card.descSize, weight: card.descWeight }))
check('卡片内容居中', card.textAlign === 'center', String(card.textAlign))
check('Mermaid 输出带两行小字（<br/>）', card.mermaidLine.includes('生成订单<br/>in progress<br/>order_create'), card.mermaidLine)


/* ---------- ①b 卡片节点的连接点：默认隐藏，悬停才出现 ---------- */
check('卡片默认藏住 4 个连接点', card.handleCount === 4 && card.handleOpacity === '0', JSON.stringify({ n: card.handleCount, op: card.handleOpacity }))
if (card.center && card.nid) {
  const handleOpacity = () =>
    ev(`(() => {
      const el = document.querySelector('[data-id="${card.nid}"]')
      const h = el?.querySelector('.ms-handle')
      return h ? getComputedStyle(h).opacity : null
    })()`)
  // 连接点的显隐走 CSS 过渡，等它落定再断言，别跟动画抢时间
  const waitOpacity = async (want) => {
    for (let i = 0; i < 14; i++) {
      const op = await handleOpacity()
      if (want === 'zero' ? op === '0' : Number(op) >= 0.85) return op
      await sleep(120)
    }
    return handleOpacity()
  }
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: card.center.x, y: card.center.y })
  const hov = await waitOpacity('visible')
  check('鼠标悬停卡片后连接点出现', Number(hov) >= 0.85, JSON.stringify({ op: hov }))
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5 })
  const left = await waitOpacity('zero')
  check('鼠标移开后连接点重新隐藏', left === '0', String(left))
}

/* ---------- ①c 双击编辑：光标落到文字末尾，不整段选中 ---------- */
const edit = await ev(`(async () => {
  const el = document.querySelector('[data-id="${card.nid}"] .ms-card')
  el?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
  await new Promise(r => setTimeout(r, 350))
  const input = document.querySelector('.ms-card__body .ms-node__input')
  const active = document.activeElement
  const r = input ? { focused: active === input, start: input.selectionStart, end: input.selectionEnd, len: input.value.length } : null
  input?.blur()
  return r
})()`)
check('双击后输入框获得焦点', !!edit && edit.focused === true, JSON.stringify(edit))
check('双击后光标在文字末尾（不是全选覆盖）', !!edit && edit.start === edit.len && edit.end === edit.len, JSON.stringify(edit))

/* ---------- ①d 编辑时划字选区，不能拖动整个节点 ---------- */
const dragPrep = await ev(`(async () => {
  const el = document.querySelector('[data-id="${card.nid}"] .ms-card')
  el?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
  await new Promise(r => setTimeout(r, 350))
  const input = document.querySelector('.ms-card__body .ms-node__input')
  if (!input) return null
  input.focus()
  input.setSelectionRange(0, 0)
  const r = input.getBoundingClientRect()
  const node = window.__ms.store.getState().doc.nodes.find(n => n.id === '${card.nid}')
  return { x: Math.round(r.x + 6), y: Math.round(r.y + r.height / 2), pos: node ? { x: node.position.x, y: node.position.y } : null, len: input.value.length }
})()`)
if (dragPrep) {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: dragPrep.x, y: dragPrep.y, button: 'left', buttons: 1, clickCount: 1 })
  for (const dx of [8, 20, 36, 52]) await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: dragPrep.x + dx, y: dragPrep.y, button: 'left', buttons: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: dragPrep.x + 52, y: dragPrep.y, button: 'left', buttons: 0, clickCount: 1 })
  await sleep(320)
  const dragAfter = await ev(`(() => {
    const input = document.querySelector('.ms-card__body .ms-node__input')
    const node = window.__ms.store.getState().doc.nodes.find(n => n.id === '${card.nid}')
    const res = { pos: node ? { x: node.position.x, y: node.position.y } : null, sel: input ? [input.selectionStart, input.selectionEnd] : null }
    input?.blur()
    return res
  })()`)
  check('编辑时鼠标划字不拖动节点', JSON.stringify(dragAfter.pos) === JSON.stringify(dragPrep.pos),
    JSON.stringify({ before: dragPrep.pos, after: dragAfter.pos }))
  check('划字真的选中了文字', !!dragAfter.sel && dragAfter.sel[0] !== dragAfter.sel[1], JSON.stringify(dragAfter.sel))
}

/* ---------- ② 光标：默认箭头，空格变手型 ---------- */
const cursor = await ev(`(async () => {
  const pane = document.querySelector('.react-flow__pane')
  const get = () => getComputedStyle(pane).cursor
  const before = get()
  window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true }))
  await new Promise(r => setTimeout(r, 120))
  const holding = get()
  const cls = document.body.classList.contains('ms-space-pan')
  window.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', code: 'Space', bubbles: true }))
  await new Promise(r => setTimeout(r, 120))
  const released = get()
  // 在输入框里按空格不该触发
  const input = document.createElement('input')
  document.body.appendChild(input)
  input.focus()
  input.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true }))
  await new Promise(r => setTimeout(r, 100))
  const inInput = document.body.classList.contains('ms-space-pan')
  input.remove()
  document.body.classList.remove('ms-space-pan')
  return { before, holding, released, cls, inInput }
})()`)
check('默认是普通箭头光标', cursor.before === 'default', cursor.before)
check('按住空格变成手型（grab）', cursor.holding === 'grab' && cursor.cls === true, JSON.stringify(cursor))
check('松开空格恢复箭头', cursor.released === 'default', cursor.released)
check('在输入框里按空格不切手型', cursor.inInput === false)

// 真实键盘事件也验一次
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 })
await sleep(150)
const real = await ev(`getComputedStyle(document.querySelector('.react-flow__pane')).cursor`)
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 })
await sleep(150)
const realAfter = await ev(`getComputedStyle(document.querySelector('.react-flow__pane')).cursor`)
check('真实按键：空格按下→grab，松开→default', real === 'grab' && realAfter === 'default', JSON.stringify({ real, realAfter }))


/* 导入：三行标签能还原 状态 + 函数名 */
const round = await ev(`(async () => {
  const NL = String.fromCharCode(10)
  const res = window.__ms.store.getState().importMermaid(['flowchart TB', '  p_demo["下单<br/>done<br/>order_create"]:::process'].join(NL))
  await new Promise(r => setTimeout(r, 500))
  const n = window.__ms.store.getState().doc.nodes.find(x => x.data.label === '下单')
  return { ok: res.ok, label: n?.data.label, status: n?.data.values?.status, fn: n?.data.values?.fn }
})()`)
check('导入 <br/> 三行标签还原状态与函数名', round.ok === true && round.status === 'done' && round.fn === 'order_create', JSON.stringify(round))

console.log('\n控制台错误:', errors.length ? errors.join('\n') : '(无)')
const failed = out.filter(([, ok]) => !ok).length
console.log(`验收：${out.length - failed}/${out.length} 通过`)

function cards(v) { return parseFloat(v) }
ws.close()
process.exit(failed || errors.length ? 1 : 0)
