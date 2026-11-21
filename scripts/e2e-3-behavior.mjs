const APP = process.env.MS_BASE || 'http://127.0.0.1:5274'

// 第三轮：删除/撤销/重连/持久化细节
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
const out = []
const check = (n, ok, d = '') => {
  out.push([n, ok])
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ` — ${d}` : ''}`)
}

await send('Runtime.enable')
await send('Page.enable')
await send('Page.navigate', { url: APP + '/' })
await new Promise((r) => setTimeout(r, 5000))
await ev(`(() => { Object.keys(localStorage).filter(k=>k.startsWith('mermaid-studio:')).forEach(k=>localStorage.removeItem(k)); return 1 })()`)
await send('Page.reload')
await new Promise((r) => setTimeout(r, 5000))

// 删除连线 -> 撤销
const del = await ev(`(() => {
  const s = window.__ms.store.getState()
  const edgeId = s.doc.edges[0].id
  window.__ms.store.getState().onEdgesChange([{ id: edgeId, type: 'remove' }])
  const afterDelete = window.__ms.store.getState().doc.edges.length
  window.__ms.store.getState().undo()
  return { afterDelete, afterUndo: window.__ms.store.getState().doc.edges.length, before: s.doc.edges.length }
})()`)
check('删除连线可撤销', del.afterDelete === del.before - 1 && del.afterUndo === del.before, JSON.stringify(del))

// 删除节点 -> 关联连线一起删除 -> 撤销
const delNode = await ev(`(() => {
  const s = window.__ms.store.getState()
  const nodeId = s.doc.nodes[1].id
  window.__ms.store.getState().onNodesChange([{ id: nodeId, type: 'remove' }])
  const st = window.__ms.store.getState()
  const dangling = st.doc.edges.filter(e => e.source === nodeId || e.target === nodeId).length
  window.__ms.store.getState().undo()
  return { nodes: st.doc.nodes.length, edges: st.doc.edges.length, dangling, beforeNodes: s.doc.nodes.length, afterUndoNodes: window.__ms.store.getState().doc.nodes.length }
})()`)
check('删除节点会清掉关联连线并可撤销', delNode.nodes === delNode.beforeNodes - 1 && delNode.dangling === 0 && delNode.afterUndoNodes === delNode.beforeNodes, JSON.stringify(delNode))

// 重连边
const rec = await ev(`(() => {
  const s = window.__ms.store.getState()
  const edge = s.doc.edges[0]
  const other = s.doc.nodes.find(n => n.id !== edge.source && n.id !== edge.target).id
  window.__ms.store.getState().onReconnect(edge, { source: edge.source, target: other, sourceHandle: 'right', targetHandle: 'left' })
  const after = window.__ms.store.getState().doc.edges.find(e => e.id === edge.id)
  return { target: after.target === other, handle: after.targetHandle }
})()`)
check('拖动连线端点可重连', rec.target === true, JSON.stringify(rec))

// 自定义块被删除后，节点回退到默认块
const fallback = await ev(`(() => {
  const s = window.__ms.store.getState()
  s.openBlockEditor('builtin.process')
  window.__ms.store.getState().updateDraft({ id: 'blk_tmp', name: '临时块' })
  window.__ms.store.getState().saveDraft()
  const nid = window.__ms.store.getState().addNodeFromBlock('blk_tmp', { x: 10, y: 10 }, '临时')
  window.__ms.store.getState().deleteBlock('blk_tmp')
  const st = window.__ms.store.getState()
  const node = st.doc.nodes.find(n => n.id === nid)
  return { blocks: st.customBlocks.length, blockId: node?.data.blockId }
})()`)
check('删除自定义块后节点回退', fallback.blocks === 0 && fallback.blockId === 'builtin.start', JSON.stringify(fallback))

// 自动保存（不需要手动点保存）
const autosave = await ev(`(async () => {
  const s = window.__ms.store.getState()
  const nid = s.addNodeFromBlock('builtin.process', { x: 40, y: 40 }, '自动保存测试')
  await new Promise(r => setTimeout(r, 1600))
  const key = 'mermaid-studio:doc:' + window.__ms.store.getState().doc.id
  const doc = JSON.parse(localStorage.getItem(key) || 'null')
  return { inStore: !!doc?.nodes.find(n => n.id === nid), dirty: window.__ms.store.getState().dirty }
})()`)
check('修改后自动保存到本地', autosave.inStore === true && autosave.dirty === false, JSON.stringify(autosave))

// 多文档：新建 + 切换
const docs = await ev(`(async () => {
  const s = window.__ms.store.getState()
  const firstId = s.doc.id
  window.__ms.store.getState().newDoc()
  const newId = window.__ms.store.getState().doc.id
  window.__ms.store.getState().addNodeFromBlock('builtin.database', { x: 20, y: 20 })
  await new Promise(r => setTimeout(r, 1200))
  window.__ms.store.getState().openDoc(firstId)
  const back = window.__ms.store.getState().doc
  return { different: firstId !== newId, count: window.__ms.store.getState().index.order.length, backNodes: back.nodes.length, backName: back.name, active: back.id === firstId }
})()`)
check('多图表新建/切换', docs.different && docs.count === 2 && docs.active, JSON.stringify(docs))

// 缩放控件
const zoom = await ev(`(async () => {
  const before = document.querySelector('.react-flow__viewport').style.transform
  document.querySelector('.react-flow__controls-zoomin').dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await new Promise(r => setTimeout(r, 400))
  const after = document.querySelector('.react-flow__viewport').style.transform
  return { before, after, changed: before !== after }
})()`)
check('缩放按钮生效', zoom.changed === true, JSON.stringify(zoom))

// 搜索过滤调色板
const search = await ev(`(async () => {
  const input = document.querySelector('.ms-input--search')
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setter.call(input, '数据库')
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await new Promise(r => setTimeout(r, 400))
  const n = document.querySelectorAll('.ms-block-item').length
  setter.call(input, '')
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await new Promise(r => setTimeout(r, 300))
  return { filtered: n, restored: document.querySelectorAll('.ms-block-item').length }
})()`)
check('调色板搜索过滤', search.filtered === 1 && search.restored >= 16, JSON.stringify(search))

console.log('\n异常/错误:', errors.length ? errors.join('\n') : '(无)')
const failed = out.filter(([, ok]) => !ok).length
console.log(`结果：${out.length - failed}/${out.length} 通过`)
ws.close()
process.exit(failed || errors.length ? 1 : 0)
