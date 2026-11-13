const APP = process.env.MS_BASE || 'http://127.0.0.1:5274'

// 第二轮：布局 / 交互细节 + 截图
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
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.text)
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map((a) => a.value).join(' '))
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

await send('Runtime.enable')
await send('Page.enable')
await send('Page.navigate', { url: APP + '/' })
await new Promise((r) => setTimeout(r, 5000))
await ev(`(() => { Object.keys(localStorage).filter(k=>k.startsWith('mermaid-studio:')).forEach(k=>localStorage.removeItem(k)); return 1 })()`)
await send('Page.navigate', { url: APP + '/' })
await new Promise((r) => setTimeout(r, 5000))

const out = []
const check = (n, ok, d = '') => {
  out.push([n, ok])
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ` — ${d}` : ''}`)
}

// 布局
const layout = await ev(`(() => {
  const q = s => document.querySelector(s)?.getBoundingClientRect()
  return {
    overflowX: document.documentElement.scrollWidth - window.innerWidth,
    palette: Math.round(q('.ms-palette')?.width || 0),
    right: Math.round(q('.ms-right')?.width || 0),
    canvasW: Math.round(q('.ms-canvas')?.width || 0),
    canvasH: Math.round(q('.ms-canvas')?.height || 0),
    topbarH: Math.round(q('.ms-topbar')?.height || 0),
    nodes: document.querySelectorAll('.react-flow__node').length,
    nodeSvg: document.querySelectorAll('.react-flow__node svg.shape-frame').length,
    cardNodes: document.querySelectorAll('.react-flow__node .ms-node--card').length,
    tableNodes: document.querySelectorAll('.react-flow__node .ms-node--table').length,
    jsonNodes: document.querySelectorAll('.react-flow__node .ms-node--json').length,
    handles: document.querySelectorAll('.react-flow__handle').length,
    edgeLabels: document.querySelectorAll('.ms-edge-label:not(.ms-edge-label--empty)').length,
  }
})()`)
check('没有横向溢出', layout.overflowX <= 0, JSON.stringify(layout))
check('三栏布局尺寸正确', layout.palette === 244 && layout.right === 320 && layout.canvasW > 600, JSON.stringify(layout))
check('每个节点都画出了卡片表面（表格 / JSON 用专门卡片）',
  layout.nodeSvg + layout.cardNodes + layout.tableNodes + layout.jsonNodes === layout.nodes && layout.nodeSvg === 0 && layout.cardNodes >= 5,
  JSON.stringify({ svg: layout.nodeSvg, card: layout.cardNodes, table: layout.tableNodes, json: layout.jsonNodes, nodes: layout.nodes }))
check('节点端口可连接', layout.handles === 28, `handles=${layout.handles}`)
check('连线标签渲染（是/否）', layout.edgeLabels === 2, `labels=${layout.edgeLabels}`)

// 连线：通过 store 建立连接，验证 Mermaid 输出与画布
const conn = await ev(`(() => {
  const s = window.__ms.store.getState()
  const ids = s.doc.nodes.map(n => n.id)
  const before = s.doc.edges.length
  window.__ms.store.getState().onConnect({ source: ids[3], target: ids[5], sourceHandle: 'bottom', targetHandle: 'top' })
  const st = window.__ms.store.getState()
  const e = st.doc.edges[st.doc.edges.length - 1]
  const code = st.currentMermaid()
  return { before, after: st.doc.edges.length, type: st.doc.edges[0].type, data: e.data, inCode: code.split('\\n').filter(l=>l.includes('-->')).length }
})()`)
check(
  '新建连线写入数据与 Mermaid（默认空白：无类型/无标签）',
  conn.after === conn.before + 1 && conn.type === 'ms' && conn.inCode === 7 && conn.data.type === '' && !conn.data.label,
  JSON.stringify(conn),
)

// 分组拖动联动
const groupDrag = await ev(`(() => {
  const s = window.__ms.store.getState()
  const group = { id: 'g_test', type: 'block', position: { x: 900, y: 700 }, data: { blockId: 'builtin.group', label: '测试分组', values: { id: '' }, fill: 'rgba(148,163,184,0.10)', stroke: '#94a3b8', textColor: '#475569', shape: 'group', width: 420, height: 260, isSubgraph: true } }
  const child = { id: 'c_test', type: 'block', position: { x: 960, y: 780 }, data: { blockId: 'builtin.process', label: '组内节点', values: {}, fill: '#dbeafe', stroke: '#2563eb', textColor: '#1e3a8a', shape: 'rect', width: 168, height: 56, groupId: 'g_test' } }
  window.__ms.store.setState({ doc: { ...s.doc, nodes: [...s.doc.nodes, group, child] } })
  window.__ms.store.getState().afterDragStop()
  const before = window.__ms.store.getState().doc.nodes.find(n => n.id === 'c_test').position
  window.__ms.store.getState().placeGroupMembers([{ id: 'c_test', x: before.x + 55, y: before.y + 25 }])
  const after = window.__ms.store.getState().doc.nodes.find(n => n.id === 'c_test').position
  const code = window.__ms.store.getState().currentMermaid()
  return { dx: after.x - before.x, dy: after.y - before.y,
           hasSubgraph: code.includes('subgraph g_test["测试分组"]'),
           childInside: /subgraph[\\s\\S]*组内节点[\\s\\S]*end/.test(code) }
})()`)
check('拖动分组会带动子节点', groupDrag.dx === 55 && groupDrag.dy === 25, JSON.stringify(groupDrag))
check('分组序列化为 subgraph ... end', groupDrag.hasSubgraph && groupDrag.childInside, JSON.stringify(groupDrag))

// 主题切换
const theme = await ev(`(() => {
  const before = getComputedStyle(document.body).backgroundColor
  window.__ms.store.getState().toggleTheme()
  return new Promise(res => setTimeout(() => res({ before, after: getComputedStyle(document.body).backgroundColor, attr: document.documentElement.dataset.theme }), 300))
})()`)
check('深浅色主题切换生效', theme.before !== theme.after && theme.attr === 'dark', JSON.stringify(theme))
await ev(`window.__ms.store.getState().toggleTheme()`)

// 右侧面板：标签条在面板内部，只剩四个 tab（图层 / 节点块 已收起来）
const tabs = await ev(`(async () => {
  const names = ['inspector','code','files']
  const out = {}
  for (const t of names) {
    window.__ms.store.getState().setRightTab(t)
    await new Promise(r => setTimeout(r, 400))
    out[t] = (document.querySelector('.ms-right')?.innerText || '').length
  }
  const tabs = [...document.querySelectorAll('.ms-right-tabs .ms-tab')]
  const labels = tabs.map((b) => b.textContent)
  const rects = tabs.map((b) => b.getBoundingClientRect())
  // 相邻标签的左边界差 - 各自宽度 = 间隙
  const gaps = rects.slice(1).map((r, i) => Math.round(r.left - (rects[i].left + rects[i].width)))
  const spread = Math.max(...gaps, 0)
  const aside = document.querySelector('.ms-right')?.getBoundingClientRect()
  const bar = document.querySelector('.ms-right-tabs')?.getBoundingClientRect()
  return {
    ...out,
    labels,
    inAside: !!(aside && bar && bar.left >= aside.left - 1 && bar.left < aside.right),
    gap: getComputedStyle(document.querySelector('.ms-right-tabs')).gap,
    spread: gaps.length ? spread : 0,
    topbarTabs: document.querySelectorAll('.ms-topbar .ms-tab').length,
  }
})()`)
check('三个右侧面板都有内容', ['inspector', 'code', 'files'].every((t) => tabs[t] > 8), JSON.stringify(tabs))
check('标签条挪进了右侧面板，只剩三项且间距 2px', tabs.inAside === true && tabs.labels.join(',') === '检查器,语法,保存' && tabs.topbarTabs === 0 && tabs.gap === '2px' && tabs.spread === 2, JSON.stringify({ labels: tabs.labels, gap: tabs.gap, spread: tabs.spread, inAside: tabs.inAside, topbarTabs: tabs.topbarTabs }))

// 左右栏可以手动收起（全视图）
const sidebars = await ev(`(async () => {
  const canvasW = () => Math.round(document.querySelector('.ms-canvas-col').getBoundingClientRect().width)
  const snap = () => ({
    palette: !!document.querySelector('.ms-palette'),
    right: !!document.querySelector('.ms-right'),
    railL: !!document.querySelector('.ms-rail--left'),
    railR: !!document.querySelector('.ms-rail--right'),
    canvas: canvasW(),
    overflowX: document.documentElement.scrollWidth - window.innerWidth,
  })
  const res = { base: snap() }

  document.querySelector('.ms-palette__collapse')?.click()
  await new Promise((r) => setTimeout(r, 350))
  res.leftClosed = snap()
  document.querySelector('.ms-rail--left')?.click()
  await new Promise((r) => setTimeout(r, 350))
  res.leftOpen = snap()

  document.querySelector('.ms-right-tabs__collapse')?.click()
  await new Promise((r) => setTimeout(r, 350))
  res.rightClosed = snap()
  document.querySelector('.ms-rail--right')?.click()
  await new Promise((r) => setTimeout(r, 350))
  res.rightOpen = snap()

  document.querySelector('.ms-palette__collapse')?.click()
  document.querySelector('.ms-right-tabs__collapse')?.click()
  await new Promise((r) => setTimeout(r, 350))
  res.bothClosed = snap()
  // 收回去，别影响后面的用例
  document.querySelector('.ms-rail--left')?.click()
  document.querySelector('.ms-rail--right')?.click()
  await new Promise((r) => setTimeout(r, 350))
  res.restored = snap()
  return res
})()`)
check(
  '左栏可收起：画布变宽、留出展开条',
  sidebars.base.palette && !sidebars.leftClosed.palette && sidebars.leftClosed.railL && sidebars.leftClosed.canvas > sidebars.base.canvas,
  JSON.stringify({ base: sidebars.base, leftClosed: sidebars.leftClosed }),
)
check(
  '左栏可再展开',
  sidebars.leftOpen.palette && !sidebars.leftOpen.railL && sidebars.leftOpen.canvas === sidebars.base.canvas,
  JSON.stringify(sidebars.leftOpen),
)
check(
  '右栏可收起：画布变宽、留出展开条',
  sidebars.base.right && !sidebars.rightClosed.right && sidebars.rightClosed.railR && sidebars.rightClosed.canvas > sidebars.base.canvas,
  JSON.stringify({ base: sidebars.base, rightClosed: sidebars.rightClosed }),
)
check(
  '右栏可再展开',
  sidebars.rightOpen.right && !sidebars.rightOpen.railR && sidebars.rightOpen.canvas === sidebars.base.canvas,
  JSON.stringify(sidebars.rightOpen),
)
check(
  '两栏都收起时画布铺满、没有横向溢出',
  !sidebars.bothClosed.palette && !sidebars.bothClosed.right && sidebars.bothClosed.canvas > sidebars.rightClosed.canvas && sidebars.bothClosed.overflowX === 0,
  JSON.stringify(sidebars.bothClosed),
)
check('收起再展开能回到原样', sidebars.restored.palette && sidebars.restored.right && sidebars.restored.canvas === sidebars.base.canvas, JSON.stringify(sidebars.restored))

// 节点检查器里的字段编辑
const inspector = await ev(`(async () => {
  const s = window.__ms.store.getState()
  const target = s.doc.nodes.find(n => n.data.blockId === 'builtin.api') || s.doc.nodes[0]
  window.__ms.store.setState({ doc: { ...s.doc, nodes: s.doc.nodes.map(n => ({ ...n, selected: n.id === target.id })) } })
  window.__ms.store.getState().setRightTab('inspector')
  await new Promise(r => setTimeout(r, 400))
  return { id: target.id, rows: document.querySelectorAll('.ms-right .ms-row').length, hasSelect: !!document.querySelector('.ms-right select') }
})()`)
check('检查器显示节点属性', inspector.rows > 5 && inspector.hasSelect, JSON.stringify(inspector))

// 截图
await ev(`(async () => {
  const s = window.__ms.store.getState()
  window.__ms.store.setState({ doc: { ...s.doc, nodes: s.doc.nodes.map(n => ({ ...n, selected: false })) } })
  window.__ms.store.getState().loadSample()
  window.__ms.store.getState().setRightTab('inspector')
  await new Promise(r => setTimeout(r, 800))
  document.querySelector('.react-flow__controls-fitview')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  return 1
})()`)
await new Promise((r) => setTimeout(r, 1400))
const shot = await send('Page.captureScreenshot', { format: 'png' })
const fs = await import('node:fs')
fs.writeFileSync('/tmp/ms-shot.png', Buffer.from(shot.result.data, 'base64'))
console.log('screenshot bytes:', Buffer.from(shot.result.data, 'base64').length)

console.log('\n异常/错误:', errors.length ? errors.join('\n') : '(无)')
const failed = out.filter(([, ok]) => !ok).length
console.log(`结果：${out.length - failed}/${out.length} 通过`)
ws.close()
process.exit(failed ? 1 : 0)
