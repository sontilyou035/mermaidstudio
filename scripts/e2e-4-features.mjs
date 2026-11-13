const APP = process.env.MS_BASE || 'http://127.0.0.1:5274'

// 第四轮：本轮新增的 5 项改造（框选 / 数据表块 / 分组可编辑 / 图层 / 无颜色）
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

async function mouse(type, x, y, extra = {}) {
  await send('Input.dispatchMouseEvent', {
    type,
    x,
    y,
    button: type === 'mouseMoved' ? 'none' : 'left',
    buttons: type === 'mouseReleased' ? 0 : 1,
    clickCount: 1,
    ...extra,
  })
}

async function drag(from, to, steps = 12) {
  await mouse('mousePressed', from.x, from.y)
  for (let i = 1; i <= steps; i++) {
    await mouse('mouseMoved', from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps)
    await sleep(25)
  }
  await mouse('mouseReleased', to.x, to.y)
  await sleep(250)
}

const out = []
const check = (n, ok, d = '') => {
  out.push([n, ok])
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ` — ${d}` : ''}`)
}

await send('Runtime.enable')
await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1560, height: 940, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: APP + '/' })
await sleep(5000)
await ev(`(() => { Object.keys(localStorage).filter(k=>k.startsWith('mermaid-studio:')).forEach(k=>localStorage.removeItem(k)); return 1 })()`)
await send('Page.navigate', { url: APP + '/' })
await sleep(5500)

/* ---------------- 1. 框选 ---------------- */
// 找一个真正落在空白画布上的起点（避开左上角工具条 / 节点 / 底部操作条）
const boxPlan = await ev(`(() => {
  const pane = document.querySelector('.react-flow__pane').getBoundingClientRect()
  const boxes = [...document.querySelectorAll('.react-flow__node')].map(n => {
    const r = n.getBoundingClientRect()
    return { x: r.x, y: r.y, w: r.width, h: r.height }
  })
  for (let x = pane.x + 16; x < pane.right - 260; x += 24) {
    for (let y = pane.y + 16; y < pane.bottom - 320; y += 24) {
      const el = document.elementFromPoint(x, y)
      const onNode = boxes.some(b => x >= b.x - 10 && x <= b.x + b.w + 10 && y >= b.y - 10 && y <= b.y + b.h + 10)
      if (onNode) continue
      const ok = el && (el.classList.contains('react-flow__pane') || el.classList.contains('react-flow__background') || el.tagName === 'svg')
      if (!ok) continue
      const end = { x: x + 520, y: y + 460 }
      const covered = boxes.filter(b => b.x + b.w > x && b.x < end.x && b.y + b.h > y && b.y < end.y).length
      if (covered >= 2 && end.x < pane.right - 20 && end.y < pane.bottom - 20) return { start: { x, y }, end, covered }
    }
  }
  return null
})()`)
check('找到可框选的空白起点', !!boxPlan, JSON.stringify(boxPlan))

await ev(`window.__ms.store.getState().clearSelection()`)
await drag(boxPlan.start, boxPlan.end)

const boxSelectResult = await ev(`(() => {
  const s = window.__ms.store.getState()
  return {
    selected: s.doc.nodes.filter(n => n.selected).length,
    total: s.doc.nodes.length,
    boxSelectSetting: s.settings.boxSelect,
    barVisible: !!document.querySelector('.ms-selection-bar'),
    barText: document.querySelector('.ms-selection-bar__count')?.textContent || '',
  }
})()`)
check(
  '框选能一次选中多个元素',
  boxSelectResult.selected >= 2 && boxSelectResult.selected === boxPlan.covered,
  JSON.stringify(boxSelectResult) + ' 期望 ' + boxPlan.covered,
)
check('出现批量操作条', boxSelectResult.barVisible, boxSelectResult.barText)

/* ---------------- 2. 数据表节点块 ---------------- */
const tableBlock = await ev(`(() => {
  const s = window.__ms.store.getState()
  const blocks = [...document.querySelectorAll('.ms-block-item__name')].map(e => e.textContent.trim())
  const id = s.addNodeFromBlock('builtin.table', { x: 60, y: 40 }, 'orders')
  const st = window.__ms.store.getState()
  const node = st.doc.nodes.find(n => n.id === id)
  const code = st.currentMermaid()
  return {
    inPalette: blocks.some(b => b.includes('数据表')),
    height: node?.data.height,
    line: code.split('\\n').find(l => l.includes('orders')) || '',
    rows: (node?.data.values.columns || '').split('\\n').filter(Boolean).length,
  }
})()`)
check('数据栏出现「数据表」块', tableBlock.inPalette === true)
check('数据表节点按字段数自动算高', tableBlock.rows === 4 && tableBlock.height >= 34 + 4 * 22, JSON.stringify(tableBlock))
check('数据表 Mermaid 输出字段', tableBlock.line.includes('id: bigint') && tableBlock.line.includes('<br/>'), tableBlock.line)

await sleep(600)
const tableDom = await ev(`(() => {
  const el = [...document.querySelectorAll('.ms-node--table')].pop()
  if (!el) return { found: false }
  return {
    found: true,
    head: el.querySelector('.ms-table__head')?.innerText?.trim(),
    rows: [...el.querySelectorAll('.ms-table__row')].map(r => r.innerText.replace(/\\s+/g, ' ').trim()),
    pk: !!el.querySelector('.ms-table__row.is-pk'),
  }
})()`)
check('数据表渲染成表头 + 字段行', tableDom.found && tableDom.rows.length === 4, JSON.stringify(tableDom))
check('主键行高亮', tableDom.pk === true)

const tableResize = await ev(`(async () => {
  const s = window.__ms.store.getState()
  const node = s.doc.nodes.find(n => n.data.blockId === 'builtin.table')
  window.__ms.store.getState().setNodeField(node.id, 'columns', 'id: bigint\\nname: varchar')
  await new Promise(r => setTimeout(r, 400))
  const after = window.__ms.store.getState().doc.nodes.find(n => n.id === node.id)
  return { height: after.data.height }
})()`)
check('改字段列表后高度自动收缩', tableResize.height < tableBlock.height, JSON.stringify(tableResize))

/* ---------- 富文本：<font color> 在数据表字段里生效 ---------- */
const rich = await ev(`(async () => {
  const s = window.__ms.store.getState()
  const node = s.doc.nodes.find(n => n.data.blockId === 'builtin.table')
  window.__ms.store.getState().setNodeField(node.id, 'columns', "<font color='red'>order_id</font>: 订单id (1:1)\\ndelivery_fee: 运费")
  await new Promise(r => setTimeout(r, 500))
  const el = document.querySelector('[data-id="' + node.id + '"]')
  const firstRow = el?.querySelector('.ms-table__row')
  const colored = firstRow?.querySelector('.ms-table__col span')
  const code = window.__ms.store.getState().currentMermaid()
  return {
    color: colored ? getComputedStyle(colored).color : null,
    rowText: firstRow?.textContent ?? '',
    plainRow: el?.querySelectorAll('.ms-table__row')[1]?.textContent ?? '',
    line: code.split('\\n').find(l => l.includes('order_id')) || '',
  }
})()`)
check('字段名里的 <font color> 渲染成颜色', rich.color === 'rgb(255, 0, 0)' && rich.rowText.includes('order_id'), JSON.stringify({ color: rich.color, rowText: rich.rowText }))
check('未加颜色的字段原样显示', rich.plainRow.includes('delivery_fee') && !rich.plainRow.includes('<font'), rich.plainRow)
check('富文本标记原样进入 Mermaid 标签', rich.line.includes("<font color='red'>order_id</font>"), rich.line)

/* ---------------- 3. 分组：可拖动 / 可缩放 / 编组 ---------------- */
const grouped = await ev(`(() => {
  const s = window.__ms.store.getState()
  const ids = s.doc.nodes.slice(0, 3).map(n => n.id)
  window.__ms.store.getState().selectOnly(ids)
  window.__ms.store.getState().groupSelection()
  const st = window.__ms.store.getState()
  const group = st.doc.nodes.find(n => n.data.isSubgraph)
  return {
    groups: st.doc.nodes.filter(n => n.data.isSubgraph).length,
    members: st.doc.nodes.filter(n => n.data.groupId === group?.id).length,
    groupId: group?.id,
    code: st.currentMermaid().includes('subgraph'),
  }
})()`)
check('框选后一键编组', grouped.groups === 1 && grouped.members === 3 && grouped.code, JSON.stringify(grouped))

await sleep(700)
const groupDrag = await ev(`(() => {
  const g = document.querySelector('.react-flow__node:has(.ms-node--group)')
  const title = g?.querySelector('.ms-node__group-title')?.getBoundingClientRect()
  const s = window.__ms.store.getState()
  const group = s.doc.nodes.find(n => n.data.isSubgraph)
  const members = s.doc.nodes.filter(n => n.data.groupId === group.id)
  return {
    title: title ? { x: title.x + title.width / 2, y: title.y + title.height / 2 } : null,
    groupPos: group.position, memberPos: members.map(m => m.position),
    memberIds: members.map(m => m.id),
    groupBox: { w: group.data.width, h: group.data.height },
  }
})()`)
check('分组标题可点击（可拖动）', !!groupDrag.title)

await drag(groupDrag.title, { x: groupDrag.title.x + 80, y: groupDrag.title.y + 60 })
const afterGroupDrag = await ev(`(() => {
  const s = window.__ms.store.getState()
  const group = s.doc.nodes.find(n => n.data.isSubgraph)
  return { groupPos: group.position, box: { w: group.data.width, h: group.data.height },
           memberPos: s.doc.nodes.filter(n => n.data.groupId === group.id).map(m => m.position) }
})()`)
const dx = afterGroupDrag.groupPos.x - groupDrag.groupPos.x
const dy = afterGroupDrag.groupPos.y - groupDrag.groupPos.y
const near = (a, b, tol = 0.01) => Math.abs(a - b) <= tol
const memberMoved = afterGroupDrag.memberPos.every(
  (p, i) => near(p.x - groupDrag.memberPos[i].x, dx) && near(p.y - groupDrag.memberPos[i].y, dy),
)
check('分组可以拖动', dx > 20 && dy > 10, `dx=${dx} dy=${dy}`)
check('拖动分组带动组内节点', memberMoved, JSON.stringify(afterGroupDrag.memberPos))
check('拖动分组不会跳动/缩放', near(afterGroupDrag.box.w, groupDrag.groupBox.w) && near(afterGroupDrag.box.h, groupDrag.groupBox.h), JSON.stringify([groupDrag.groupBox, afterGroupDrag.box]))

// 用缩放手柄改变分组尺寸
const resize = await ev(`(async () => {
  // 先适应视图，保证缩放手柄在可视区域内（否则鼠标会拖出窗口）
  document.querySelector('.react-flow__controls-fitview')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await new Promise(r => setTimeout(r, 900))
  const s = window.__ms.store.getState()
  const group = s.doc.nodes.find(n => n.data.isSubgraph)
  const el = document.querySelector('.ms-resize-handle.bottom.right')
  const r = el?.getBoundingClientRect()
  const canvas = document.querySelector('.ms-canvas').getBoundingClientRect()
  const p = r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null
  const target = p ? { x: Math.min(p.x + 90, canvas.right - 30), y: Math.min(p.y + 60, canvas.bottom - 30) } : null
  return {
    handle: p, target,
    size: { w: group.data.width, h: group.data.height },
    inView: p ? (p.x < canvas.right - 40 && p.y < canvas.bottom - 40) : false,
    handleCount: document.querySelectorAll('.ms-resize-handle').length,
  }
})()`)
check('分组出现缩放手柄（四角）', !!resize.handle && resize.handleCount === 4)
check('缩放手柄在可视区域内', resize.inView === true, JSON.stringify(resize.handle))
if (resize.handle && resize.target) {
  await drag(resize.handle, resize.target, 8)
  const resized = await ev(`(() => {
    const s = window.__ms.store.getState()
    const group = s.doc.nodes.find(n => n.data.isSubgraph)
    const st = parseFloat(group.style.width)
    return { w: group.data.width, h: group.data.height, styleW: st, synced: Math.abs(st - group.data.width) < 1 }
  })()`)
  check(
    '分组可以缩放且模型同步',
    resized.w > resize.size.w + 30 && resized.h > resize.size.h + 15 && resized.synced,
    JSON.stringify({ from: resize.size, to: resized }),
  )
}

/* ---------------- 4. 图层面板 ---------------- */
const layers = await ev(`(async () => {
  window.__ms.store.getState().setRightTab('layers')
  await new Promise(r => setTimeout(r, 600))
  const rows = [...document.querySelectorAll('.ms-layerrow')]
  const s = window.__ms.store.getState()
  return {
    rows: rows.length,
    expectedNodes: s.doc.nodes.length,
    edges: s.doc.edges.length,
    barVisible: !!document.querySelector('.ms-layerlist'),
    firstNames: rows.slice(0, 3).map(r => r.querySelector('.ms-layerrow__name')?.textContent),
  }
})()`)
check('图层面板列出所有元素', layers.barVisible && layers.rows >= layers.expectedNodes, JSON.stringify(layers))

const layerHidden = await ev(`(async () => {
  const s = window.__ms.store.getState()
  const target = s.doc.nodes.find(n => !n.data.isSubgraph)
  window.__ms.store.getState().toggleNodeHidden(target.id)
  await new Promise(r => setTimeout(r, 400))
  const st = window.__ms.store.getState()
  return {
    dataHidden: st.doc.nodes.find(n => n.id === target.id)?.hidden === true,
    inDom: !!document.querySelector('[data-id="' + target.id + '"]'),
    label: target.data.label,
  }
})()`)
check('图层可隐藏元素（数据保留）', layerHidden.dataHidden && !layerHidden.inDom, JSON.stringify(layerHidden))

const layerLock = await ev(`(async () => {
  const s = window.__ms.store.getState()
  const target = s.doc.nodes.find(n => !n.data.isSubgraph && !n.hidden)
  window.__ms.store.getState().toggleNodeLocked(target.id)
  await new Promise(r => setTimeout(r, 300))
  const st = window.__ms.store.getState()
  const n = st.doc.nodes.find(x => x.id === target.id)
  return { locked: n.data.locked, draggable: n.draggable, deletable: n.deletable }
})()`)
check('图层可锁定元素', layerLock.locked === true && layerLock.draggable === false && layerLock.deletable === false, JSON.stringify(layerLock))

const zorder = await ev(`(() => {
  const s = window.__ms.store.getState()
  const target = s.doc.nodes.find(n => !n.data.isSubgraph)
  const before = target.zIndex ?? 0
  window.__ms.store.getState().changeZOrder(target.id, 'front')
  const after = window.__ms.store.getState().doc.nodes.find(n => n.id === target.id).zIndex
  window.__ms.store.getState().changeZOrder(target.id, 'back')
  const back = window.__ms.store.getState().doc.nodes.find(n => n.id === target.id).zIndex
  return { before, after, back }
})()`)
check('图层层级上移/下移生效', zorder.after > zorder.before && zorder.back < zorder.after, JSON.stringify(zorder))

const showAll = await ev(`(() => {
  window.__ms.store.getState().showAll()
  const s = window.__ms.store.getState()
  return { hidden: s.doc.nodes.filter(n => n.hidden).length }
})()`)
check('全部显示恢复隐藏元素', showAll.hidden === 0, JSON.stringify(showAll))

/* ---------------- 5. 颜色「无」 ---------------- */
const noColor = await ev(`(async () => {
  const s = window.__ms.store.getState()
  const target = s.doc.nodes.find(n => !n.data.isSubgraph)
  window.__ms.store.getState().selectOnly([target.id])
  window.__ms.store.getState().setRightTab('inspector')
  await new Promise(r => setTimeout(r, 500))
  const rows = [...document.querySelectorAll('.ms-right .ms-row')]
  const fillRow = rows.find(r => r.querySelector('.ms-row__label')?.textContent === '填充')
  const noneBtn = fillRow?.querySelector('.ms-none-btn')
  const strokeRow = rows.find(r => r.querySelector('.ms-row__label')?.textContent === '边框')
  const strokeNoneBtn = strokeRow?.querySelector('.ms-none-btn')
  noneBtn?.click()
  strokeNoneBtn?.click()
  await new Promise(r => setTimeout(r, 500))
  const st = window.__ms.store.getState()
  const node = st.doc.nodes.find(n => n.id === target.id)
  const code = st.currentMermaid()
  const line = code.split('\\n').find(l => l.includes(node.data.label)) || ''
  return {
    fill: node.data.fill, stroke: node.data.stroke,
    hasNoneButton: !!noneBtn && !!strokeNoneBtn,
    mermaidLine: line,
    styleLine: code.split('\\n').find(l => l.startsWith('style ') && l.includes('none')) || '',
    codeHasNone: /fill:none/.test(code),
    svgFill: document.querySelector('[data-id="' + target.id + '"] svg rect')?.getAttribute('fill'),
  }
})()`)
check('填充/边框都有「无」按钮', noColor.hasNoneButton === true)
check('选择「无」后节点填充与边框为空', noColor.fill === 'transparent' && noColor.stroke === 'transparent', JSON.stringify(noColor))
check('Mermaid 输出 fill:none / stroke:none', noColor.codeHasNone === true && noColor.styleLine.includes('fill:none') && noColor.styleLine.includes('stroke:none'), noColor.styleLine)

console.log('\n异常/错误:', errors.length ? errors.join('\n') : '(无)')
const failed = out.filter(([, ok]) => !ok).length
console.log(`结果：${out.length - failed}/${out.length} 通过`)
ws.close()
process.exit(failed || errors.length ? 1 : 0)
