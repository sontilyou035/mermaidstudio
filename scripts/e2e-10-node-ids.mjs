const APP = process.env.MS_BASE || 'http://127.0.0.1:5274'

// 第十轮：节点 ID 语义化生成 + 人工重命名
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
const check = (n, ok, d = '') => { out.push([n, ok]); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ` — ${d}` : ''}`) }

await send('Runtime.enable'); await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1560, height: 940, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: APP + '/' }); await sleep(5000)
await ev(`(() => { Object.keys(localStorage).filter(k=>k.startsWith('mermaid-studio:')).forEach(k=>localStorage.removeItem(k)); return 1 })()`)
await send('Page.reload'); await sleep(5500)

/* ---------- 2. 按类型 + 中文标签自动生成 ID ---------- */
const gen = await ev(`(() => {
  const s = window.__ms.store.getState()
  s.newDoc()
  const add = (b, l) => window.__ms.store.getState().addNodeFromBlock(b, { x: 60, y: 60 }, l)
  const ids = {
    role: add('builtin.role.8', '顾客'),
    action: add('builtin.manual', '结算'),
    process: add('builtin.process', '生成订单'),
    table: add('builtin.table', 'order_data'),
    job: add('builtin.cron', '超时关单'),
    mq: add('builtin.mq', 'PAY_SUCCESS'),
    subject: add('builtin.subject.0', '供应商'),
    redis: add('builtin.redis', '购物车缓存'),
    external: add('builtin.api', '财务对账接口'),
    decision: add('builtin.decision', '库存是否充足'),
  }
  // 先连几条线，后面验证「改名后连线不断」
  const st0 = () => window.__ms.store.getState()
  st0().onConnect({ source: ids.process, target: ids.action, sourceHandle: 'bottom', targetHandle: 'top' })
  st0().onConnect({ source: ids.action, target: ids.mq, sourceHandle: 'bottom', targetHandle: 'top' })
  st0().onConnect({ source: ids.role, target: ids.process, sourceHandle: 'bottom', targetHandle: 'top' })

  // 分组
  window.__ms.store.getState().selectOnly([ids.process, ids.action])
  window.__ms.store.getState().groupSelection()
  const group = window.__ms.store.getState().doc.nodes.find(n => n.data.isSubgraph).id
  const st = window.__ms.store.getState()
  return {
    ids: { ...ids, group },
    labels: Object.fromEntries(Object.entries({ ...ids, group }).map(([k, v]) => [k, st.doc.nodes.find(n => n.id === v)?.data.label])),
  }
})()`)
const prefixOf = (x) => String(x).split('_')[0]
const shapesOk = (x) => /\_[a-z0-9]+$/.test(x) && x.includes('_')
check('角色 → r_ 前缀', prefixOf(gen.ids.role) === 'r' && gen.ids.role.startsWith('r_customer_'), gen.ids.role)
check('人工操作 → a_ 前缀（结算=checkout）', prefixOf(gen.ids.action) === 'a' && gen.ids.action.startsWith('a_checkout_'), gen.ids.action)
check('系统处理 → p_ 前缀（生成订单=create_order）', prefixOf(gen.ids.process) === 'p' && gen.ids.process.startsWith('p_create_order_'), gen.ids.process)
check('数据表 → t_ + 真实表名', prefixOf(gen.ids.table) === 't' && gen.ids.table.startsWith('t_order_data_'), gen.ids.table)
check('定时任务 → j_ 前缀（超时关单）', prefixOf(gen.ids.job) === 'j' && gen.ids.job.startsWith('j_close_timeout_'), gen.ids.job)
check('MQ → m_ 前缀（PAY_SUCCESS）', prefixOf(gen.ids.mq) === 'm' && gen.ids.mq.startsWith('m_pay_success_'), gen.ids.mq)
check('主体 → f_ 前缀（供应商=supplier）', prefixOf(gen.ids.subject) === 'f' && gen.ids.subject.startsWith('f_supplier_'), gen.ids.subject)
check('Redis → rd_ 前缀（避开角色的 r_）', prefixOf(gen.ids.redis) === 'rd' && gen.ids.redis.startsWith('rd_'), gen.ids.redis)
check('外部系统/接口 → api_ / x_ 可用', gen.ids.external.startsWith('api_'), gen.ids.external)
check('判断 → c_ 前缀', prefixOf(gen.ids.decision) === 'c', gen.ids.decision)
check('分组 → d_ 前缀', prefixOf(gen.ids.group) === 'd', gen.ids.group)
check('尾部随机后缀长度 5 且各不相同', new Set(Object.values(gen.ids)).size === Object.keys(gen.ids).length && Object.values(gen.ids).every((v) => /_[a-z0-9]{5}$/.test(v)), JSON.stringify(Object.values(gen.ids)))

/* ---------- 生成的 ID 直接出现在导出的 Mermaid 里 ---------- */
const code = await ev(`(() => window.__ms.store.getState().currentMermaid())()`)
check('Mermaid 里节点就用这些 ID', code.includes(`${gen.ids.process}[`) && code.includes(`${gen.ids.role}(`) && code.includes(`${gen.ids.mq}[`), code.split('\n').slice(0, 3).join(' | '))

/* ---------- 1. 检查器里人工改 ID ---------- */
const idField = await ev(`(async () => {
  const target = ${JSON.stringify(gen.ids.process)}
  window.__ms.store.getState().selectOnly([target])
  window.__ms.store.getState().setRightTab('inspector')
  await new Promise(r => setTimeout(r, 700))
  const rows = [...document.querySelectorAll('.ms-right .ms-row')]
  const idRow = rows.find(r => r.querySelector('.ms-row__label')?.textContent === 'ID')
  const input = idRow?.querySelector('input.ms-input--id')
  if (input) {
    input.focus()
    input.select()
  }
  return { hasLabel: !!idRow, hasInput: !!input, before: input?.value ?? null, focused: document.activeElement === input }
})()`)
await send('Input.insertText', { text: 'a_checkout_demo1' })
await sleep(200)
for (const type of ['keyDown', 'keyUp']) {
  await send('Input.dispatchKeyEvent', { type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 })
}
await sleep(700)
const rename = await ev(`(() => {
  const st = window.__ms.store.getState()
  const node = st.doc.nodes.find(n => n.data.label === '生成订单')
  const code = st.currentMermaid()
  return {
    after: node?.id,
    inMermaid: code.includes('a_checkout_demo1'),
    oldGone: !code.includes(${JSON.stringify(gen.ids.process)}),
    edges: st.doc.edges.filter(e => e.source === node?.id || e.target === node?.id).length,
  }
})()`)
rename.hasLabel = idField.hasLabel
rename.hasInput = idField.hasInput
rename.before = idField.before
check('检查器里有 ID 输入框', rename.hasLabel === true && rename.hasInput === true && /^p_create_order_/.test(rename.before || ''), JSON.stringify(rename))
check('可以人工改成 a_checkout_demo1', rename.after === 'a_checkout_demo1', rename.after)
check('改名后 Mermaid 用新 ID、旧 ID 消失', rename.inMermaid === true && rename.oldGone === true)

/* ---------- 改名后连线 / 分组引用不丢 ---------- */
const refs = await ev(`(() => {
  const s = window.__ms.store.getState()
  const a = 'a_checkout_demo1'
  const edges = s.doc.edges.filter(e => e.source === a || e.target === a)
  const group = s.doc.nodes.find(n => n.data.isSubgraph)
  const members = s.doc.nodes.filter(n => n.data.groupId === group?.id).map(n => n.id)
  const code = s.currentMermaid()
  return {
    edges: edges.length,
    edgesResolve: edges.every(e => s.doc.nodes.some(n => n.id === e.source) && s.doc.nodes.some(n => n.id === e.target)),
    members,
    subgraphLine: code.split('\\n').find(l => l.startsWith('subgraph')) || '',
    memberInside: code.includes('a_checkout_demo1'),
  }
})()`)
check('改名后连线仍然连得上', refs.edges > 0 && refs.edgesResolve === true, JSON.stringify(refs))
check('改名后分组归属正常', refs.members.includes('a_checkout_demo1') && refs.memberInside === true, JSON.stringify(refs))

/* ---------- 重名保护 + 非法字符清洗 ---------- */
const guard = await ev(`(() => {
  const s = window.__ms.store.getState()
  const other = s.doc.nodes.find(n => !n.data.isSubgraph && n.id !== 'a_checkout_demo1')
  const ok = window.__ms.store.getState().renameNodeId('a_checkout_demo1', other.id)
  const afterDup = window.__ms.store.getState().doc.nodes.find(n => n.data.label === '生成订单')?.id
  const okInvalid = window.__ms.store.getState().renameNodeId('a_checkout_demo1', '3 非法-id!')
  const afterInvalid = window.__ms.store.getState().doc.nodes.find(n => n.data.label === '生成订单')?.id
  return { dupRejected: ok === false, afterDup, cleaned: okInvalid, afterInvalid }
})()`)
check('ID 重名会被拒绝', guard.dupRejected === true && guard.afterDup === 'a_checkout_demo1', JSON.stringify(guard))
check('非法字符会被清洗成合法 ID', guard.afterInvalid === 'n_3_id', guard.afterInvalid)

/* ---------- 按名称重新生成 ---------- */
const regen = await ev(`(async () => {
  const s = window.__ms.store.getState()
  const node = s.doc.nodes.find(n => n.data.label === '生成订单')
  window.__ms.store.getState().selectOnly([node.id])
  await new Promise(r => setTimeout(r, 500))
  const btn = [...document.querySelectorAll('.ms-right button')].find(b => b.textContent.includes('按名称生成'))
  btn?.click()
  await new Promise(r => setTimeout(r, 600))
  const after = window.__ms.store.getState().doc.nodes.find(n => n.data.label === '生成订单')?.id
  return { hasBtn: !!btn, after }
})()`)
check('「按名称生成」能重新生成语义 ID', regen.hasBtn && regen.after.startsWith('p_create_order_'), regen.after)

/* ---------- 撤销能还原 ID ---------- */
const undo = await ev(`(() => {
  window.__ms.store.getState().undo()
  const st = window.__ms.store.getState()
  const node = st.doc.nodes.find(n => n.data.label === '生成订单')
  return { id: node?.id }
})()`)
check('撤销能还原上一次 ID 改动', undo.id !== regen.after, JSON.stringify(undo))

/* ---------- 导出再导入，ID 保持不变 ---------- */
const roundTrip = await ev(`(() => {
  const before = window.__ms.store.getState().doc.nodes.map(n => n.id).sort()
  const code = window.__ms.store.getState().currentMermaid()
  const res = window.__ms.store.getState().importMermaid(code)
  const after = window.__ms.store.getState().doc.nodes.map(n => n.id).sort()
  return { ok: res.ok, same: JSON.stringify(before) === JSON.stringify(after), before, after }
})()`)
check('导出再导入后节点 ID 完全不变', roundTrip.ok && roundTrip.same === true, JSON.stringify({ before: roundTrip.before.slice(0, 4), after: roundTrip.after.slice(0, 4) }))

console.log('\n异常/错误:', errors.length ? errors.join('\n') : '(无)')
const failed = out.filter(([, ok]) => !ok).length
console.log(`结果：${out.length - failed}/${out.length} 通过`)
ws.close()
process.exit(failed || errors.length ? 1 : 0)
