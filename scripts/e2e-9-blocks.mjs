const APP = process.env.MS_BASE || 'http://127.0.0.1:5274'

// 第九轮：工程栏「定时任务 / MQ」+ 数据栏「Redis（JSON 结构）」
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

/* ---------- 1. 工程栏两个新节点块 ---------- */
const palette = await ev(`(() => {
  const sections = [...document.querySelectorAll('.ms-group')].map(g => ({
    title: g.querySelector('.ms-group__title')?.textContent.replace(/[0-9]+$/, '').trim(),
    items: [...g.querySelectorAll('.ms-block-item__name')].map(e => e.textContent.trim()),
  }))
  const find = (t) => sections.find(s => s.title === t)?.items ?? []
  const blocks = window.__ms.store.getState().blocks()
  return {
    engineering: find('工程'),
    data: find('数据'),
    cron: blocks.find(b => b.id === 'builtin.cron'),
    mq: blocks.find(b => b.id === 'builtin.mq'),
    redis: blocks.find(b => b.id === 'builtin.redis'),
    total: document.querySelectorAll('.ms-block-item').length,
  }
})()`)
check('工程栏新增「定时任务」', palette.engineering.some((n) => n.includes('定时任务')), JSON.stringify(palette.engineering))
check('工程栏新增「MQ」', palette.engineering.some((n) => n.includes('MQ')), JSON.stringify(palette.engineering))
check('数据栏新增「Redis」', palette.data.some((n) => n.includes('Redis')), JSON.stringify(palette.data))
check('定时任务用 job 语义类', palette.cron?.className === 'job' && palette.cron?.shape === 'hexagon', JSON.stringify({ cls: palette.cron?.className, shape: palette.cron?.shape }))
check('MQ 用 mq 语义类', palette.mq?.className === 'mq', palette.mq?.className)
check('内置块总数 35 → 38', palette.total === 38, `总数=${palette.total}`)

/* ---------- Redis：JSON 结构渲染 ---------- */
const redis = await ev(`(async () => {
  const s = window.__ms.store.getState()
  s.newDoc()
  const rid = window.__ms.store.getState().addNodeFromBlock('builtin.redis', { x: 120, y: 120 }, '用户会话')
  await new Promise(r => setTimeout(r, 800))
  const node = window.__ms.store.getState().doc.nodes.find(n => n.id === rid)
  const el = document.querySelector('[data-id="' + rid + '"]')
  return {
    id: rid,
    layout: window.__ms.store.getState().blocks().find(b => b.id === node.data.blockId)?.layout,
    height: node.data.height,
    key: node.data.values.key,
    jsonLines: node.data.values.json.split('\\n').length,
    hasJsonBox: !!el?.querySelector('.ms-json'),
    headText: el?.querySelector('.ms-json__head')?.innerText.replace(/\\s+/g, ' ').trim(),
    codeText: el?.querySelector('.ms-json__code')?.innerText.replace(/\\s+/g, ' ').trim(),
    rendered: Math.round(el.getBoundingClientRect().height),
    codeEl: !!el?.querySelector('.ms-json__code'),
  }
})()`)
check('Redis 块用 json 渲染方式', redis.layout === 'json' && redis.hasJsonBox === true, JSON.stringify({ layout: redis.layout, box: redis.hasJsonBox }))
check('表头显示节点名 + Key', (redis.headText || '').includes('用户会话') && (redis.headText || '').includes('user:1001'), redis.headText)
check('JSON 结构按原文渲染（多行）', (redis.codeText || '').includes('"type": "hash"') && (redis.codeText || '').includes('"level": "VIP"'), redis.codeText)
check('高度按 JSON 行数自动算', redis.jsonLines === 8 && Math.abs(redis.height - (34 + 8 * 16 + 18)) < 1, JSON.stringify({ lines: redis.jsonLines, height: redis.height }))

/* ---------- 改 JSON 内容 → 高度跟着变 ---------- */
const resize = await ev(`(async () => {
  const s = window.__ms.store.getState()
  const node = s.doc.nodes[0]
  window.__ms.store.getState().setNodeField(node.id, 'json', '{\\n  "type": "string",\\n  "ttl": "60s"\\n}')
  await new Promise(r => setTimeout(r, 500))
  const after = window.__ms.store.getState().doc.nodes[0]
  const el = document.querySelector('[data-id="' + node.id + '"]')
  return { height: after.data.height, rendered: Math.round(el.getBoundingClientRect().height), lines: el.querySelectorAll('.ms-json__code').length ? el.querySelector('.ms-json__code').innerText.split('\\n').length : 0 }
})()`)
check('改 JSON 后高度自动收缩', resize.lines === 4 && resize.height < redis.height, JSON.stringify(resize))

/* ---------- 检查器里的 JSON 格式化 + 校验 ---------- */
const tools = await ev(`(async () => {
  const s = window.__ms.store.getState()
  const node = s.doc.nodes[0]
  window.__ms.store.getState().selectOnly([node.id])
  window.__ms.store.getState().setRightTab('inspector')
  window.__ms.store.getState().setNodeField(node.id, 'json', '{"type":"hash","ttl":"7d","fields":{"a":1}}')
  await new Promise(r => setTimeout(r, 600))
  const statusBefore = document.querySelector('.ms-right .ms-json-status')?.textContent ?? ''
  const btn = [...document.querySelectorAll('.ms-right button')].find(b => b.textContent.includes('格式化 JSON'))
  btn?.click()
  await new Promise(r => setTimeout(r, 500))
  const formatted = window.__ms.store.getState().doc.nodes[0].data.values.json
  // 再写一段坏 JSON，看校验提示
  window.__ms.store.getState().setNodeField(node.id, 'json', '{"type": "hash",,}')
  await new Promise(r => setTimeout(r, 500))
  const statusBad = document.querySelector('.ms-right .ms-json-status')?.textContent ?? ''
  const badBtn = [...document.querySelectorAll('.ms-right button')].find(b => b.textContent.includes('格式化 JSON'))
  return { statusBefore, formatted, statusBad, disabledWhenBad: badBtn?.disabled === true }
})()`)
check('检查器有「格式化 JSON」按钮', tools.statusBefore.includes('JSON 合法'), tools.statusBefore)
check('格式化后变成两空格缩进', tools.formatted === '{\n  "type": "hash",\n  "ttl": "7d",\n  "fields": {\n    "a": 1\n  }\n}', JSON.stringify(tools.formatted))
check('JSON 不合法时给出提示并禁用格式化', tools.statusBad.includes('JSON 不合法') && tools.disabledWhenBad === true, JSON.stringify(tools))

/* ---------- Mermaid 输出 ---------- */
const code = await ev(`(() => {
  const s = window.__ms.store.getState()
  window.__ms.store.getState().setNodeField(window.__ms.store.getState().doc.nodes[0].id, 'json', '{\\n  "type": "hash",\\n  "ttl": "7d"\\n}')
  const c = window.__ms.store.getState().currentMermaid()
  const line = c.split('\\n').find(l => l.includes('用户会话')) || ''
  return { line, all: c }
})()`)
check('Mermaid 标签里带 Key 与 JSON', code.line.includes('user:1001') && code.line.includes('&quot;type&quot;') && code.line.includes('<br/>'), code.line.slice(0, 200))

/* ---------- 定时任务 / MQ 也能正常用 ---------- */
const others = await ev(`(() => {
  const s = window.__ms.store.getState()
  const cid = window.__ms.store.getState().addNodeFromBlock('builtin.cron', { x: 520, y: 120 }, '每日对账')
  const mid = window.__ms.store.getState().addNodeFromBlock('builtin.mq', { x: 520, y: 320 }, '订单事件')
  const st = window.__ms.store.getState()
  const c = st.currentMermaid()
  return {
    cronLine: c.split('\\n').find(l => l.includes('每日对账')) || '',
    mqLine: c.split('\\n').find(l => l.includes('订单事件')) || '',
    cronFields: st.doc.nodes.find(n => n.id === cid).data.values,
    mqFields: st.doc.nodes.find(n => n.id === mid).data.values,
    classDefs: c.split('\\n').filter(l => l.startsWith('classDef')),
  }
})()`)
check('定时任务渲染 cron 表达式', others.cronLine.includes('0 3 * * *') && others.cronLine.includes(':::job'), others.cronLine)
check('MQ 渲染 topic 并挂 mq 类', others.mqLine.includes('order.created') && others.mqLine.includes(':::mq'), others.mqLine)
check('两个块都有可用字段', others.cronFields.cron === '0 3 * * *' && others.mqFields.topic === 'order.created', JSON.stringify([others.cronFields, others.mqFields]))

/* ---------- 导入回来仍然认得 ---------- */
const roundTrip = await ev(`(() => {
  const code = window.__ms.store.getState().currentMermaid()
  const res = window.__ms.store.getState().importMermaid(code)
  const st = window.__ms.store.getState()
  const blocks = st.blocks()
  const find = (label) => st.doc.nodes.find(n => n.data.label === label)
  const redisNode = find('用户会话')
  const cronNode = find('每日对账')
  const mqNode = find('订单事件')
  const blockOf = (n) => (n ? blocks.find(b => b.id === n.data.blockId) : null)
  return {
    ok: res.ok,
    labels: st.doc.nodes.map(n => n.data.label),
    redisBlock: blockOf(redisNode)?.name ?? null,
    redisJson: redisNode?.data.values.json ?? null,
    cronBlock: blockOf(cronNode)?.name ?? null,
    cronField: cronNode?.data.values.cron ?? null,
    mqBlock: blockOf(mqNode)?.name ?? null,
    mqTopic: mqNode?.data.values.topic ?? null,
    redisHeight: redisNode?.data.height ?? 0,
  }
})()`)
check('导入后 Redis / 定时任务 / MQ 都还原成原节点块', roundTrip.redisBlock === 'Redis' && roundTrip.cronBlock === '定时任务' && roundTrip.mqBlock === 'MQ', JSON.stringify(roundTrip))
check('导入后字段也被还原（JSON / cron / topic）', (roundTrip.redisJson || '').includes('"type": "hash"') && roundTrip.cronField === '0 3 * * *' && roundTrip.mqTopic === 'order.created', JSON.stringify({ json: roundTrip.redisJson, cron: roundTrip.cronField, topic: roundTrip.mqTopic }))
check('导入后 Redis 节点高度按 JSON 重算', roundTrip.redisHeight > 110, `height=${roundTrip.redisHeight}`)

console.log('\n异常/错误:', errors.length ? errors.join('\n') : '(无)')
const failed = out.filter(([, ok]) => !ok).length
console.log(`结果：${out.length - failed}/${out.length} 通过`)
ws.close()
process.exit(failed || errors.length ? 1 : 0)
