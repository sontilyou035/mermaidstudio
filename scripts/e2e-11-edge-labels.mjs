const APP = process.env.MS_BASE || 'http://127.0.0.1:5274'

// 第十一轮：连线标签规范（十种类型）
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
await send('Page.navigate', { url: APP + '/' }); await sleep(5500)

/* ---------- 打字规则：按起终点前缀推荐类型 ---------- */
const rules = await ev(`(async () => {
  const mod = window.__ms
  const cases = [
    ['r', 'a'], ['r', 'p'], ['p', 'p'], ['p', 'm'], ['m', 'p'], ['j', 'p'],
    ['p', 't'], ['a', 't'], ['t', 't'], ['p', 'x'], ['a', 'p'], ['r', 't'],
  ]
  return {
    result: cases.map(([s, t]) => s + '→' + t + ' = ' + mod.suggestEdgeType(s, t)),
    list: mod.CANONICAL_EDGE_TYPES,
  }
})()`)
const expect = {
  'r→a': '操作', 'r→p': '操作', 'p→p': '同步', 'p→m': 'MQ', 'm→p': 'MQ', 'j→p': '定时',
  'p→t': '写', 'a→t': '写', 't→t': '关联', 'p→x': '调用外部', 'a→p': '下一步', 'r→t': '下一步',
}
const bad = rules.result.filter((r) => {
  const [pair, t] = r.split(' = ')
  return expect[pair] !== t
})
check('十种类型列表正确', rules.list.length === 10 && rules.list.join(',') === '操作,下一步,同步,MQ,定时,写,读,配置,关联,调用外部', rules.list.join(','))
check('推荐规则符合约定表', bad.length === 0, JSON.stringify(bad.length ? bad : rules.result))

/* ---------- 新建连线默认带规范标签 ---------- */
const created = await ev(`(() => {
  const s = window.__ms.store.getState()
  s.newDoc()
  const add = (b, x, y, l) => window.__ms.store.getState().addNodeFromBlock(b, { x, y }, l)
  const role = add('builtin.role.8', 60, 40, '顾客')
  const proc = add('builtin.process', 300, 40, '生成订单')
  const proc2 = add('builtin.process', 560, 40, '扣减库存')
  const cron = add('builtin.cron', 60, 220, '超时关单')
  const mq = add('builtin.mq', 300, 220, 'PAY_SUCCESS')
  const tbl = add('builtin.table', 560, 220, 'order_data')
  const ext = add('builtin.subject.0', 800, 220, '供应商')
  const st = () => window.__ms.store.getState()
  st().onConnect({ source: role, target: proc, sourceHandle: 'right', targetHandle: 'left' })
  st().onConnect({ source: proc, target: proc2, sourceHandle: 'right', targetHandle: 'left' })
  st().onConnect({ source: cron, target: proc, sourceHandle: 'top', targetHandle: 'bottom' })
  st().onConnect({ source: proc2, target: mq, sourceHandle: 'bottom', targetHandle: 'top' })
  st().onConnect({ source: mq, target: proc, sourceHandle: 'top', targetHandle: 'bottom' })
  st().onConnect({ source: proc, target: tbl, sourceHandle: 'bottom', targetHandle: 'top' })
  st().onConnect({ source: proc2, target: ext, sourceHandle: 'right', targetHandle: 'left' })
  const after = window.__ms.store.getState()
  return {
    labels: after.doc.edges.map(e => e.data.label),
    types: after.doc.edges.map(e => e.data.type),
    issues: window.__ms.store.getState().edgeLabelIssues().length,
    code: after.currentMermaid(),
  }
})()`)
check(
  '新建的每条连线默认空白（不带类型 / 标签）',
  created.labels.every((l) => !l) && created.types.every((t) => !t),
  JSON.stringify({ labels: created.labels, types: created.types }),
)
check('空白连线会被标成「不合规」（提示去补全）', created.issues === created.labels.length, `issues=${created.issues}/${created.labels.length}`)
check(
  'Mermaid 里不会凭空出现 |标签|',
  !created.code.split('\n').filter((l) => l.includes('-->')).some((l) => /\|[^|]+\|/.test(l)),
  created.code.split('\n').filter((l) => l.includes('-->')).slice(0, 3).join(' | '),
)

// 按检查器的「推荐」手动补一遍（后面的断言靠类型定位边）
const SUGGEST = ['操作', '同步', '定时', 'MQ', 'MQ', '写', '下一步']
const filled = await ev(`(async () => {
  const st = window.__ms.store.getState()
  const types = ${JSON.stringify(SUGGEST)}
  st.doc.edges.forEach((e, i) => window.__ms.store.getState().setEdgeLabelType(e.id, types[i], ''))
  await new Promise((r) => setTimeout(r, 300))
  const after = window.__ms.store.getState()
  return {
    labels: after.doc.edges.map((e) => e.data.label),
    types: after.doc.edges.map((e) => e.data.type),
    issues: after.edgeLabelIssues().length,
    code: after.currentMermaid(),
  }
})()`)
check(
  '手动按推荐补全后类型正确（r→p 操作 / p→p 同步 / j→p 定时 / p→m MQ / p→t 写 / 其余下一步）',
  filled.labels.join('|') === '操作|同步|定时|MQ|MQ|写|下一步' && filled.issues === 0,
  filled.labels.join('|'),
)
check(
  'Mermaid 里带 |标签|',
  filled.code.includes('|操作|') && filled.code.includes('|同步|') && filled.code.includes('|定时|'),
  filled.code.split('\n').filter((l) => l.includes('-->')).slice(0, 3).join(' | '),
)

/* ---------- 类型 + 说明 两段式 ---------- */
const twoPart = await ev(`(() => {
  const st = window.__ms.store.getState()
  const tableEdge = st.doc.edges.find(e => e.data.type === '写')
  window.__ms.store.getState().setEdgeLabelType(tableEdge.id, '写', 'order_data')
  const after = window.__ms.store.getState()
  const e = after.doc.edges.find(x => x.id === tableEdge.id)
  const t2 = after.doc.edges.find(x => x.data.type === '定时')
  window.__ms.store.getState().setEdgeLabelType(t2.id, '定时', '0 3 * * *')
  const st3 = window.__ms.store.getState()
  return {
    label: e.data.label, type: e.data.type, note: e.data.note,
    label2: st3.doc.edges.find(x => x.id === t2.id).data.label,
    code: st3.currentMermaid(),
  }
})()`)
check('类型 + 说明 → `类型: 说明`', twoPart.label === '写: order_data' && twoPart.type === '写' && twoPart.note === 'order_data', JSON.stringify(twoPart))
check('说明为空时只输出类型', twoPart.label2 === '定时: 0 3 * * *', twoPart.label2)
check('Mermaid 里两段式标签正确', twoPart.code.includes('|写: order_data|') && twoPart.code.includes('|定时: 0 3 * * *|'))

/* ---------- 不合规标签能被识别 + 一键补全 ---------- */
const fix = await ev(`(async () => {
  const st = window.__ms.store.getState()
  const first = st.doc.edges[0]
  // 模拟历史数据 / 别人给的 mmd：直接把自由文本标签写进文档
  window.__ms.store.setState({
    doc: {
      ...window.__ms.store.getState().doc,
      edges: window.__ms.store.getState().doc.edges.map((e) =>
        e.id === first.id ? { ...e, data: { ...e.data, label: '是', type: '', note: '' }, label: '是' } : e,
      ),
    },
  })
  await new Promise(r => setTimeout(r, 900))
  const issues = window.__ms.store.getState().edgeLabelIssues()
  const fixed = window.__ms.store.getState().normalizeEdgeLabels()
  const st3 = window.__ms.store.getState()
  const e = st3.doc.edges.find(x => x.id === first.id)
  return {
    issueCount: issues.length, issueLabel: issues[0]?.label, suggestion: issues[0]?.suggestion,
    fixed, newLabel: e.data.label, newType: e.data.type,
    remaining: window.__ms.store.getState().edgeLabelIssues().length,
  }
})()`)
check('自由文本标签被判定为不合规', fix.issueCount === 1 && fix.issueLabel === '是', JSON.stringify(fix))
check('一键补全保留原文字当说明', fix.fixed === 1 && fix.newLabel === '操作: 是' && fix.newType === '操作', JSON.stringify(fix))
check('补全后不再有不合规项', fix.remaining === 0)

/* ---------- 检查器里的类型下拉 ---------- */
const ui = await ev(`(async () => {
  const st = window.__ms.store.getState()
  const e = st.doc.edges.find(x => x.data.type === '写')
  window.__ms.store.getState().selectOnly([])
  window.__ms.store.setState({ doc: { ...window.__ms.store.getState().doc, edges: window.__ms.store.getState().doc.edges.map(x => ({ ...x, selected: x.id === e.id })) } })
  window.__ms.store.getState().setRightTab('inspector')
  await new Promise(r => setTimeout(r, 700))
  const rows = [...document.querySelectorAll('.ms-right .ms-row')]
  const typeRow = rows.find(r => r.querySelector('.ms-row__label')?.textContent === '类型')
  const select = typeRow?.querySelector('select')
  const options = select ? [...select.options].map(o => o.value) : []
  const noteRow = rows.find(r => r.querySelector('.ms-row__label')?.textContent === '说明')
  const noteInput = noteRow?.querySelector('input')
  const preview = document.querySelector('.ms-edge-label-preview')?.textContent ?? ''
  // 通过下拉改成「读」
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set
  setter.call(select, '读')
  select.dispatchEvent(new Event('change', { bubbles: true }))
  await new Promise(r => setTimeout(r, 600))
  const after = window.__ms.store.getState().doc.edges.find(x => x.id === e.id)
  return { hasSelect: !!select, options, hasNote: !!noteInput, noteValue: noteInput?.value, preview, afterLabel: after.data.label, afterType: after.data.type }
})()`)
check('检查器里有类型下拉（只含十种 + 未设置）', ui.hasSelect && ui.options.join(',') === ',操作,下一步,同步,MQ,定时,写,读,配置,关联,调用外部', ui.options.join(','))
check('说明输入框与标签预览', ui.hasNote && ui.noteValue === 'order_data' && ui.preview.includes('写: order_data'), JSON.stringify({ note: ui.noteValue, preview: ui.preview }))
check('下拉切换成「读」即时生效', ui.afterType === '读' && ui.afterLabel === '读: order_data', JSON.stringify({ t: ui.afterType, l: ui.afterLabel }))

/* ---------- 导入 mmd：拆出类型与说明 ---------- */
const roundTrip = await ev(`(() => {
  const code = window.__ms.store.getState().currentMermaid()
  const res = window.__ms.store.getState().importMermaid(code)
  const st = window.__ms.store.getState()
  const types = st.doc.edges.map(e => e.data.type)
  const labels = st.doc.edges.map(e => e.data.label)
  const issues = window.__ms.store.getState().edgeLabelIssues().length
  const notes = st.doc.edges.map(e => e.data.note).filter(Boolean)
  return { ok: res.ok, types, labels, issues, notes }
})()`)
check('导出再导入后类型与说明都还原', roundTrip.ok && roundTrip.issues === 0 && roundTrip.types.every(Boolean) && roundTrip.notes.includes('order_data'), JSON.stringify(roundTrip))
check('别名会归一化（外部调用 → 调用外部）', (await ev(`(async () => {
  const mod = window.__ms
  return [mod.normalizeEdgeType('外部调用'), mod.normalizeEdgeType('sync'), mod.normalizeEdgeType('随便写的')].join('|')
})()`)) === '调用外部|同步|')

console.log('\n异常/错误:', errors.length ? errors.join('\n') : '(无)')
const failed = out.filter(([, ok]) => !ok).length
console.log(`结果：${out.length - failed}/${out.length} 通过`)
ws.close()
process.exit(failed || errors.length ? 1 : 0)
