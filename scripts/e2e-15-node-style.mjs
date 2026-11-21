// 节点样式（Onevra 风）验收
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
await send('Page.reload'); await sleep(5500)

await ev(`(async () => {
  window.__ms.store.getState().addNodeFromBlock('builtin.api', { x: 60, y: 520 }, '接口节点')
  window.__ms.store.getState().clearSelection()
  await new Promise(r => setTimeout(r, 700))
  return 1
})()`)

const style = await ev(`(() => {
  const node = document.querySelector('.react-flow__node')
  const cardEl = node?.querySelector('.ms-card')
  const cs = cardEl ? getComputedStyle(cardEl) : null
  return {
    hasCard: !!cardEl,
    shadow: cs?.boxShadow ?? '',
    hasShadow: !!cs && cs.boxShadow !== 'none',
    radius: cs?.borderRadius ?? '',
    borderWidth: cs?.borderTopWidth ?? '',
    ring: !!document.querySelector('.ms-node__ring'),
    cardCount: document.querySelectorAll('.react-flow__node .ms-card').length,
    shapeSvgCount: document.querySelectorAll('.react-flow__node svg.shape-frame').length,
    labelRadius: (() => { const l = document.querySelector('.ms-edge-label'); return l ? getComputedStyle(l).borderRadius : null })(),
    labelBorder: (() => { const l = document.querySelector('.ms-edge-label'); return l ? getComputedStyle(l).borderTopWidth : null })(),
  }
})()`)
check('所有节点都渲染成卡片（不再有形状 SVG）', style.hasCard === true && style.shapeSvgCount === 0 && style.cardCount >= 5,
  JSON.stringify({ card: style.cardCount, svg: style.shapeSvgCount }))
check('卡片带柔和投影（box-shadow）', style.hasShadow === true, style.shadow.slice(0, 70))
check('卡片 14 圆角 + 1px 软描边', style.radius === '14px' && parseFloat(style.borderWidth) <= 1.5,
  JSON.stringify({ r: style.radius, b: style.borderWidth }))
check('未选中时不显示外环', style.ring === false)

// 选中一个节点 → 外环出现，卡片自身描边不被染成主色
const ring = await ev(`(async () => {
  const s = window.__ms.store.getState()
  const n = s.doc.nodes[0]
  window.__ms.store.getState().selectOnly([n.id])
  await new Promise(r => setTimeout(r, 500))
  const el = document.querySelector('.ms-node__ring')
  const cs = el ? getComputedStyle(el) : null
  const cardEl = document.querySelector('[data-id="' + n.id + '"] .ms-card')
  const cardBorder = cardEl ? getComputedStyle(cardEl).borderTopColor : null
  return { hasRing: !!el, border: cs?.borderTopWidth, color: cs?.borderTopColor, radius: cs?.borderRadius, cardBorder }
})()`)
check('选中时出现外环', ring.hasRing === true && parseFloat(ring.border) >= 1.5, JSON.stringify({ border: ring.border, radius: ring.radius }))
check('外环用主色半透明（不是纯色）', (ring.color ?? '').includes('rgba'), ring.color)
check('选中不把卡片描边染成主色', ring.cardBorder !== 'rgb(189, 72, 27)', String(ring.cardBorder))

// 表格 / JSON 卡片节点
const card = await ev(`(async () => {
  const s = window.__ms.store.getState()
  const t = s.addNodeFromBlock('builtin.table', { x: 80, y: 620 }, 'order_data')
  const r = window.__ms.store.getState().addNodeFromBlock('builtin.redis', { x: 400, y: 620 }, '缓存')
  await new Promise(res => setTimeout(res, 600))
  const tEl = document.querySelector('[data-id="' + t + '"] .ms-table')
  const rEl = document.querySelector('[data-id="' + r + '"] .ms-json')
  const cs1 = tEl ? getComputedStyle(tEl) : null
  const cs2 = rEl ? getComputedStyle(rEl) : null
  const hasShadow = (v) => !!v && v !== 'none'
  return { tableRadius: cs1?.borderRadius, tableShadow: hasShadow(cs1?.boxShadow), tableBorder: cs1?.borderTopWidth,
           jsonRadius: cs2?.borderRadius, jsonShadow: hasShadow(cs2?.boxShadow), jsonBorder: cs2?.borderTopWidth }
})()`)
check('表格节点：14 圆角 + 投影 + 细描边', card.tableRadius === '14px' && card.tableShadow && parseFloat(card.tableBorder) <= 1.5, JSON.stringify(card).slice(0, 120))
check('Redis 节点：14 圆角 + 投影 + 细描边', card.jsonRadius === '14px' && card.jsonShadow && parseFloat(card.jsonBorder) <= 1.5, JSON.stringify({ r: card.jsonRadius, b: card.jsonBorder }))

// 连线标签：药丸 + 1px 描边
check('连线标签是药丸形（999px）+ 1px 描边', style.labelRadius === '999px' && style.labelBorder === '1px', JSON.stringify({ r: style.labelRadius, b: style.labelBorder }))

// 深色 / 冷色皮肤下的投影同样存在
const dark = await ev(`(async () => {
  window.__ms.store.getState().setTheme('dark')
  await new Promise(r => setTimeout(r, 400))
  const cardEl = document.querySelector('.react-flow__node .ms-card')
  const shadow = cardEl ? getComputedStyle(cardEl).boxShadow : ''
  window.__ms.store.getState().setTheme('light')
  return { hasShadow: !!shadow && shadow !== 'none' }
})()`)
check('深色主题下投影仍然生效', dark.hasShadow === true)

console.log('\n控制台错误:', errors.length ? errors.join('\n') : '(无)')
const failed = out.filter(([, ok]) => !ok).length
console.log(`节点样式验收：${out.length - failed}/${out.length} 通过`)
ws.close()
process.exit(failed || errors.length ? 1 : 0)
