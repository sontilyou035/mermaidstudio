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
  const res = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (res.exceptionDetails) {
    throw new Error(res.exceptionDetails.exception?.description ?? res.exceptionDetails.text)
  }
  return res.result.value
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const state = () =>
  evaluate(`(() => {
    const s = window.__ms.store.getState()
    return { id: s.doc.id, name: s.doc.name, nodes: s.doc.nodes.length, docs: s.index.order.length, mode: (performance.getEntriesByType('navigation')[0] || {}).type }
  })()`)

await send('Runtime.enable')
await send('Page.enable')

/* ---------- 1. 冷启动：本地什么都没有 → 示例图 ---------- */
await send('Page.navigate', { url: APP + '/' })
await sleep(4500)
await evaluate(`(() => { localStorage.clear(); sessionStorage.clear(); return true })()`)
await send('Page.reload')
await sleep(4500)
const cold = await state()
const coldCheck = cold.nodes === 7 && cold.mode === 'reload'
console.log(`${coldCheck ? 'PASS' : 'FAIL'}  冷启动（无本地数据）给示例图 — ${JSON.stringify(cold)}`)

/* ---------- 2. 建两张图，从"打开"进第一张，刷新要还是第一张 ---------- */
const made = await evaluate(`(() => {
  const s = () => window.__ms.store.getState()
  s().newDoc()
  s().addNodeFromBlock('builtin.table', { x: 100, y: 100 }, '表A')
  s().saveNow()
  const a = s().doc.id
  s().newDoc()
  s().addNodeFromBlock('builtin.table', { x: 200, y: 200 }, '表B')
  s().saveNow()
  const b = s().doc.id
  // 模拟从保存侧栏打开 A（不会写 index.active，只有会话知道）
  s().openDoc(a)
  return { a, b, current: s().doc.id, docs: s().index.order.length, nodes: s().doc.nodes.length }
})()`)
const opened = made.current === made.a && made.nodes === 1 && made.docs === 2
console.log(`${opened ? 'PASS' : 'FAIL'}  从侧栏打开文件 A — ${JSON.stringify(made)}`)

await send('Page.reload')
await sleep(4500)
const afterReload = await state()
const reloadOk = afterReload.mode === 'reload' && afterReload.id === made.a && afterReload.nodes === 1
console.log(`${reloadOk ? 'PASS' : 'FAIL'}  刷新后仍是刚才打开的文件 A — ${JSON.stringify(afterReload)}`)

/* ---------- 3. 新开链接（没有会话）→ 新建模式 ---------- */
await evaluate(`(() => { sessionStorage.clear(); return true })()`)
await send('Page.navigate', { url: APP + '/' })
await sleep(4500)
const fresh = await state()
const freshOk =
  fresh.mode === 'navigate' &&
  fresh.id !== made.a &&
  fresh.id !== made.b &&
  fresh.nodes === 0 &&
  fresh.name === '未命名图表' &&
  fresh.docs === 2
console.log(`${freshOk ? 'PASS' : 'FAIL'}  新开链接是新建模式（且不丢失已存的两张图）— ${JSON.stringify(fresh)}`)

console.log('\n--- 控制台错误 ---')
console.log(consoleErrors.length ? consoleErrors.join('\n') : '(无)')
console.log('--- 未捕获异常 ---')
console.log(exceptions.length ? exceptions.join('\n') : '(无)')

const passed = [coldCheck, opened, reloadOk, freshOk].filter(Boolean).length
console.log(`\n结果：${passed}/4 通过，控制台错误 ${consoleErrors.length}，异常 ${exceptions.length}`)
ws.close()
process.exit(passed === 4 && consoleErrors.length === 0 && exceptions.length === 0 ? 0 : 1)
