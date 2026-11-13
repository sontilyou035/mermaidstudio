// 针对「换成 pele」的专项验收（跑在构建产物 5273 上）
const APP = process.argv[2] || 'http://127.0.0.1:5273'
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
const out = []
const check = (n, ok, d = '') => { out.push([n, ok]); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ` — ${d}` : ''}`) }

await send('Runtime.enable'); await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1560, height: 940, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: `${APP}/` }); await sleep(5000)
await ev(`(() => { Object.keys(localStorage).filter(k=>k.startsWith('mermaid-studio:')).forEach(k=>localStorage.removeItem(k)); return 1 })()`)
await send('Page.navigate', { url: `${APP}/` }); await sleep(5500)

const engine = await ev(`window.__ms.store.getState().settings.renderEngine`)
check('默认渲染引擎是 pele', engine === 'pele', engine)

// 造一张覆盖各种语法的图
await ev(`(() => {
  const s = window.__ms.store.getState()
  s.newDoc()
  const add = (b, x, y, l) => window.__ms.store.getState().addNodeFromBlock(b, { x, y }, l)
  const a = add('builtin.role.8', 60, 60, '顾客')
  const b = add('builtin.process', 60, 220, '生成订单')
  const c = add('builtin.mq', 360, 220, 'PAY_SUCCESS')
  const d = add('builtin.table', 360, 400, 'order_data')
  const st = () => window.__ms.store.getState()
  st().onConnect({ source: a, target: b, sourceHandle: 'bottom', targetHandle: 'top' })
  st().onConnect({ source: b, target: c, sourceHandle: 'right', targetHandle: 'left' })
  st().onConnect({ source: b, target: d, sourceHandle: 'bottom', targetHandle: 'top' })
  const last = window.__ms.store.getState().doc.edges.slice(-1)[0]
  window.__ms.store.getState().setEdgeLabelType(last.id, '写', 'order_data')
  window.__ms.store.getState().selectOnly([b, d])
  window.__ms.store.getState().groupSelection()
  return 1
})()`)
await sleep(700)

const preview = await ev(`(async () => {
  const t0 = performance.now()
  window.__ms.store.getState().setRightTab('preview')
  for (let i = 0; i < 400; i++) {
    await new Promise(r => setTimeout(r, 20))
    const svg = document.querySelector('.ms-preview svg')
    if (svg) {
      const txt = svg.textContent
      return {
        ms: Math.round(performance.now() - t0),
        isPele: svg.classList.contains('pele'),
        hasRoleLabel: txt.includes('顾客'),
        hasEdgeLabel: txt.includes('写: order_data'),
        hasSubgraph: txt.includes('分组'),
        hasClassColor: svg.outerHTML.includes('e0e7ff'),
        bytes: svg.outerHTML.length,
        meta: document.querySelector('.ms-render-meta')?.textContent ?? '',
      }
    }
  }
  return null
})()`)
check('预览用 pele 渲染（svg.pele）', preview?.isPele === true, JSON.stringify({ isPele: preview?.isPele, ms: preview?.ms }))
check('pele 渲染保真：节点 / 边标签 / 分组 / classDef 颜色', preview?.hasRoleLabel && preview?.hasEdgeLabel && preview?.hasSubgraph && preview?.hasClassColor, JSON.stringify(preview))
check('预览面板显示引擎与耗时', /pele/.test(preview?.meta ?? '') && /\d+\s*ms/.test(preview?.meta ?? ''), preview?.meta)
check('pele SVG 明显更小（< 30KB）', (preview?.bytes ?? 1e9) < 30000, `${preview?.bytes} B`)

// 再渲一次：改标签后计重渲时间
const rerender = await ev(`(async () => {
  const s = window.__ms.store.getState()
  const n = s.doc.nodes.find(x => !x.data.isSubgraph)
  const t0 = performance.now()
  window.__ms.store.getState().updateNodeData(n.id, { label: n.data.label + '·' })
  for (let i = 0; i < 400; i++) {
    await new Promise(r => setTimeout(r, 10))
    if (document.querySelector('.ms-preview svg')?.textContent.includes('·')) return Math.round(performance.now() - t0)
  }
  return -1
})()`)
check('二次渲染很快（含 160ms 防抖，< 400ms）', rerender > 0 && rerender < 400, `${rerender} ms`)

// 深色主题：pele 用 CSS 变量，不重渲
const dark = await ev(`(async () => {
  document.documentElement.dataset.theme = 'dark'
  window.__ms.store.setState({ settings: { ...window.__ms.store.getState().settings, theme: 'dark' } })
  await new Promise(r => setTimeout(r, 300))
  const svg = document.querySelector('.ms-preview svg')
  const cs = getComputedStyle(document.documentElement)
  return { bgVar: cs.getPropertyValue('--pele-bg').trim(), fgVar: cs.getPropertyValue('--pele-fg').trim(), stillPele: !!svg?.classList.contains('pele') }
})()`)
const DARK_BGS = ['#0b1120', '#211f1c'] // cool / warm 两套皮肤的深色底
check('深色主题下 pele 变量生效且未重建 DOM', DARK_BGS.includes(dark.bgVar) && dark.stillPele, JSON.stringify(dark))
await ev(`(async () => { document.documentElement.dataset.theme = 'light'; window.__ms.store.setState({ settings: { ...window.__ms.store.getState().settings, theme: 'light' } }); return 1 })()`)

// 导出 SVG：点应用自己的导出按钮，检查产物自带主题
const exported = await ev(`(async () => {
  let captured = null
  const origCreate = URL.createObjectURL
  const origClick = HTMLAnchorElement.prototype.click
  URL.createObjectURL = (blob) => { captured = blob; return origCreate.call(URL, blob) }
  HTMLAnchorElement.prototype.click = function () {}
  window.__ms.store.getState().setRightTab('files')
  await new Promise(r => setTimeout(r, 700))
  const btn = [...document.querySelectorAll('.ms-right button')].find(b => b.textContent.includes('导出 SVG'))
  btn?.click()
  for (let i = 0; i < 100; i++) { await new Promise(r => setTimeout(r, 50)); if (captured) break }
  URL.createObjectURL = origCreate
  HTMLAnchorElement.prototype.click = origClick
  const text = captured ? await captured.text() : ''
  return { hasBtn: !!btn, bytes: text.length, hasStyle: text.includes('--pele-bg'), isSvg: text.includes('<svg'), isPele: text.includes('class="pele') }
})()`)
check('「导出 SVG」产物自带主题变量（可独立打开）', exported.hasBtn && exported.isSvg && exported.hasStyle && exported.bytes > 1000, JSON.stringify(exported))
check('导出的 SVG 也是 pele 渲染的', exported.isPele === true)

// 切回 mermaid.js 也能工作（先回到预览标签页）
const mermaidMode = await ev(`(async () => {
  window.__ms.store.getState().setRightTab('preview')
  for (let i = 0; i < 60; i++) { await new Promise(r => setTimeout(r, 50)); if (document.querySelector('.ms-preview svg')) break }
  window.__ms.store.getState().updateSettings({ renderEngine: 'mermaid' })
  let ok = false
  for (let i = 0; i < 200; i++) {
    await new Promise(r => setTimeout(r, 50))
    const svg = document.querySelector('.ms-preview svg')
    if (svg && !svg.classList.contains('pele')) { ok = true; break }
  }
  const meta = document.querySelector('.ms-render-meta')?.textContent ?? ''
  window.__ms.store.getState().updateSettings({ renderEngine: 'pele' })
  return { isMermaid: ok, meta }
})()`)
check('切到 mermaid.js 也能正常渲染', mermaidMode.isMermaid === true && /mermaid/.test(mermaidMode.meta), mermaidMode.meta)

console.log('\n控制台错误:', errors.length ? errors.join('\n') : '(无)')
const failed = out.filter(([, ok]) => !ok).length
console.log(`pele 专项验收：${out.length - failed}/${out.length} 通过`)
ws.close()
process.exit(failed || errors.length ? 1 : 0)
