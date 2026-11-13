// 部署验收：针对「构建产物 + 静态服务」跑一遍（不是 dev server）
// 用法：node scripts/check-build.mjs [http://127.0.0.1:5273]
const APP = process.argv[2] || process.env.MS_BASE || 'http://127.0.0.1:5273'
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
  throw new Error('找不到 Chrome 调试目标（先启动带 --remote-debugging-port=9333 的 Chrome）')
}

const target = await getTarget()
const ws = new WebSocket(target.webSocketDebuggerUrl)
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
const check = (n, ok, d = '') => { out.push([n, ok]); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ` — ${d}` : ''}`) }

console.log(`针对 ${APP} 验收构建产物\n`)
await send('Runtime.enable'); await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1560, height: 940, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: `${APP}/` })
await sleep(5000)
// 清掉上一次验收留下的数据，保证每次都是从示例图开始
await ev(`(() => { Object.keys(localStorage).filter(k => k.startsWith('mermaid-studio:')).forEach(k => localStorage.removeItem(k)); return true })()`)
await send('Page.navigate', { url: `${APP}/` })
await sleep(5000)

const assets = await ev(`(() => {
  const scripts = [...document.querySelectorAll('script[src]')].map(s => s.getAttribute('src'))
  const links = [...document.querySelectorAll('link[rel=stylesheet]')].map(l => l.getAttribute('href'))
  return { scripts, links }
})()`)
check('加载的是打包产物（不是 /src 源码）', assets.scripts.every((s) => !String(s).startsWith('/src')) && assets.scripts.some((s) => /assets\/.*\.js$/.test(String(s))), JSON.stringify(assets.scripts))

const mounted = await ev(`!!document.querySelector('.ms-topbar') && !!document.querySelector('.react-flow')`)
check('应用挂载（顶栏 + 画布）', mounted === true)

const palette = await ev(`document.querySelectorAll('.ms-block-item').length`)
check('调色板 38 个内置节点块', palette === 38, `块数=${palette}`)

const canvas = await ev(`({ nodes: document.querySelectorAll('.react-flow__node').length, edges: document.querySelectorAll('.react-flow__edge').length })`)
check('示例图渲染到画布', canvas.nodes === 7 && canvas.edges === 6, JSON.stringify(canvas))

// 加一个节点 + 连线 + 导出 Mermaid（覆盖动态 import 的 mermaid 分包）
const flow = await ev(`(async () => {
  const s = window.__ms.store.getState()
  const a = s.addNodeFromBlock('builtin.redis', { x: 760, y: 460 }, '缓存')
  const b = window.__ms.store.getState().addNodeFromBlock('builtin.process', { x: 760, y: 660 }, '落库')
  window.__ms.store.getState().onConnect({ source: a, target: b, sourceHandle: 'bottom', targetHandle: 'top' })
  await new Promise(r => setTimeout(r, 500))
  const st = window.__ms.store.getState()
  return { nodes: st.doc.nodes.length, code: st.currentMermaid().slice(0, 200) }
})()`)
check('可以在生产构建里新增节点并连线', flow.nodes === 9 && flow.code.includes('flowchart'), flow.code.split('\n')[0])

const preview = await ev(`(async () => {
  window.__ms.store.getState().setRightTab('preview')
  for (let i = 0; i < 15; i++) {
    await new Promise(r => setTimeout(r, 800))
    if (document.querySelectorAll('.ms-preview svg').length) break
  }
  return {
    svg: document.querySelectorAll('.ms-preview svg').length,
    alert: document.querySelector('.ms-alert--error')?.textContent?.slice(0, 100) ?? null,
  }
})()`)
check('Mermaid 预览能渲染（动态分包可用）', preview.svg > 0 && !preview.alert, JSON.stringify(preview))

const save = await ev(`(async () => {
  window.__ms.store.getState().setRightTab('files')
  await new Promise(r => setTimeout(r, 600))
  const saved = window.__ms.store.getState().exportAllData()
  const parsed = JSON.parse(saved)
  return { docs: parsed.documents.length, blocks: parsed.customBlocks.length, bytes: saved.length }
})()`)
check('全量备份可用', save.docs >= 1 && save.bytes > 1000, JSON.stringify(save))

const dialog = await ev(`(async () => {
  window.__ms.store.getState().openSaveDialog()
  await new Promise(r => setTimeout(r, 700))
  const open = !!document.querySelector('.ms-modal__panel--save')
  window.__ms.store.getState().closeSaveDialog()
  return { open, format: (window.__ms.store.getState().settings.includeStyles !== undefined) }
})()`)
check('保存弹框能打开', dialog.open === true)

const persist = await ev(`(async () => {
  window.__ms.store.getState().saveNow()
  await new Promise(r => setTimeout(r, 300))
  const key = 'mermaid-studio:doc:' + window.__ms.store.getState().doc.id
  return { inStorage: !!localStorage.getItem(key) }
})()`)
check('数据能写进 localStorage', persist.inStorage === true)

console.log('\n控制台错误:', errors.length ? errors.join('\n') : '(无)')
const failed = out.filter(([, ok]) => !ok).length
console.log(`\n构建产物验收：${out.length - failed}/${out.length} 通过`)
ws.close()
process.exit(failed || errors.length ? 1 : 0)
