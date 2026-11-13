const APP = process.env.MS_BASE || 'http://127.0.0.1:5274'

// 通过 Chrome DevTools Protocol 对应用做端到端验证
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
  const res = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  })
  if (res.exceptionDetails) {
    throw new Error(res.exceptionDetails.exception?.description ?? res.exceptionDetails.text)
  }
  return res.result.value
}

await send('Runtime.enable')
await send('Page.enable')
await send('Page.navigate', { url: APP + '/' })
await new Promise((r) => setTimeout(r, 4500))
// 清空本地数据，保证每次验证从同样的状态开始
await evaluate(`(() => { Object.keys(localStorage).filter(k => k.startsWith('mermaid-studio:')).forEach(k => localStorage.removeItem(k)); return true })()`)
await send('Page.navigate', { url: APP + '/' })
await new Promise((r) => setTimeout(r, 4500))

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

// 1. 应用挂载
const mounted = await evaluate(`!!document.querySelector('.ms-topbar') && !!document.querySelector('.react-flow')`)
check('应用挂载（顶栏 + 画布）', mounted === true)

const paletteCount = await evaluate(`document.querySelectorAll('.ms-block-item').length`)
check('调色板渲染 38 个内置节点块', paletteCount === 38, `块数量=${paletteCount}`)

const canvasNodes = await evaluate(`document.querySelectorAll('.react-flow__node').length`)
check('示例图渲染到画布', canvasNodes === 7, `节点=${canvasNodes}`)

const edges = await evaluate(`document.querySelectorAll('.react-flow__edge').length`)
check('连线渲染', edges === 6, `边=${edges}`)

const hasStore = await evaluate(`!!(window.__ms && window.__ms.store)`)
check('调试接口可用', hasStore === true)

// 2. 自定义节点块：创建
const created = await evaluate(`(() => {
  const s = window.__ms.store.getState()
  s.openBlockEditor('builtin.api')
  const st = window.__ms.store.getState()
  st.updateDraft({
    id: 'blk_test_api',
    name: '订单服务',
    category: '测试',
    icon: '🧪',
    shape: 'hexagon',
    fill: '#ffe4e6',
    stroke: '#e11d48',
    textColor: '#881337',
    width: 200,
    height: 80,
    fields: [
      { key: 'port', label: '端口', type: 'number', default: '8080' },
      { key: 'owner', label: '负责人', type: 'text', default: '张三' },
    ],
    labelTemplate: '{{label}}\\n:{{port}} {{owner}}',
    classDef: 'fill:#ffe4e6,stroke:#e11d48',
  })
  window.__ms.store.getState().saveDraft()
  const after = window.__ms.store.getState()
  return { count: after.customBlocks.length, name: after.customBlocks[0]?.name, template: after.customBlocks[0]?.labelTemplate }
})()`)
check('创建自定义节点块', created.count === 1 && created.name === '订单服务', JSON.stringify(created))

const paletteAfter = await evaluate(`document.querySelectorAll('.ms-block-item').length`)
check('自定义块出现在调色板', paletteAfter === paletteCount + 1, `${paletteCount} -> ${paletteAfter}`)

// 3. 用自定义块添加节点 + 自定义块序列化
const added = await evaluate(`(() => {
  const s = window.__ms.store.getState()
  const id = s.addNodeFromBlock('blk_test_api', { x: 60, y: 620 }, '下单接口')
  const st = window.__ms.store.getState()
  const node = st.doc.nodes.find(n => n.id === id)
  const code = st.currentMermaid()
  return { id, label: node?.data.label, shape: node?.data.shape,
           line: code.split('\\n').find(l => l.includes('下单接口')) || '',
           classDefLine: code.split('\\n').find(l => l.startsWith('classDef')) || '' }
})()`)
check('自定义块节点带字段/模板', added.line.includes('<br/>:8080 张三'), added.line)
const customClassDef = await evaluate(`window.__ms.store.getState().currentMermaid().split('\\n').filter(l => l.startsWith('classDef') && l.includes('#ffe4e6')).length`)
check('自定义块生成 classDef', customClassDef >= 1, `匹配 classDef 行=${customClassDef}`)

// 4. 保存到 localStorage
const saved = await evaluate(`(() => {
  window.__ms.store.getState().saveNow()
  const key = 'mermaid-studio:doc:' + window.__ms.store.getState().doc.id
  const raw = localStorage.getItem(key)
  const doc = raw ? JSON.parse(raw) : null
  const blocks = JSON.parse(localStorage.getItem('mermaid-studio:custom-blocks') || '[]')
  return { bytes: (raw || '').length, nodes: doc?.nodes.length ?? -1, blocks: blocks.length, name: doc?.name }
})()`)
check('图表写入 localStorage', saved.nodes === 8 && saved.bytes > 500, JSON.stringify(saved))
check('自定义块持久化', saved.blocks === 1, `blocks=${saved.blocks}`)

// 5. 刷新后仍然存在
await send('Page.navigate', { url: APP + '/' })
await new Promise((r) => setTimeout(r, 4000))
const afterReload = await evaluate(`(() => {
  const s = window.__ms.store.getState()
  return {
    nodes: s.doc.nodes.length,
    blocks: s.customBlocks.length,
    hasCustomNode: s.doc.nodes.some(n => n.data.blockId === 'blk_test_api'),
    palette: document.querySelectorAll('.ms-block-item').length,
    savedAt: !!localStorage.getItem('mermaid-studio:index'),
  }
})()`)
check('刷新后图表仍在', afterReload.nodes === 8, JSON.stringify(afterReload))
check('刷新后自定义块仍在', afterReload.blocks === 1 && afterReload.hasCustomNode && afterReload.palette === paletteCount + 1, JSON.stringify(afterReload))

// 6. Mermaid 导入
const imported = await evaluate(`(() => {
  const r = window.__ms.store.getState().importMermaid(\`flowchart LR
  A["开始"] --> B{"库存够吗"}
  B -->|是| C(["发货"])
  B -->|否| D[(补货单)]
  subgraph S1["仓储"]
    C
    D
  end
  classDef warning fill:#fee2e2,stroke:#dc2626
  B:::warning\`)
  const st = window.__ms.store.getState()
  return { ok: r.ok, message: r.message, nodes: st.doc.nodes.length, edges: st.doc.edges.length,
           groups: st.doc.nodes.filter(n => n.data.isSubgraph).length,
           grouped: st.doc.nodes.filter(n => !!n.data.groupId).length,
           labels: st.doc.nodes.map(n => n.data.label) }
})()`)
check('导入 Mermaid', imported.ok === true, imported.message)
check('导入得到 4 节点 + 1 分组 / 3 连线', imported.nodes === 5 && imported.edges === 3 && imported.groups === 1, JSON.stringify(imported))
check('导入保留子图归属', imported.grouped === 2, `grouped=${imported.grouped}`)

// 7. 往返：导出 -> 再导入
const roundtrip = await evaluate(`(() => {
  const code = window.__ms.store.getState().currentMermaid()
  window.__ms.store.getState().importMermaid(code)
  const st = window.__ms.store.getState()
  return { nodes: st.doc.nodes.length, edges: st.doc.edges.length, code: code.split('\\n').length }
})()`)
check('Mermaid 往返稳定', roundtrip.nodes === 5 && roundtrip.edges === 3, JSON.stringify(roundtrip))

// 8. 撤销 / 重做
const undoTest = await evaluate(`(() => {
  const st = window.__ms.store.getState()
  const before = st.doc.nodes.length
  st.pushHistory()
  window.__ms.store.setState({ doc: { ...st.doc, nodes: [] } })
  window.__ms.store.getState().undo()
  return { before, afterUndo: window.__ms.store.getState().doc.nodes.length }
})()`)
check('撤销可用', undoTest.before === undoTest.afterUndo, JSON.stringify(undoTest))

// 9. 工程文件导出/导入
const project = await evaluate(`(() => {
  const s = window.__ms.store.getState()
  const json = s.exportProjectJson()
  const parsed = JSON.parse(json)
  s.newDoc()
  window.__ms.store.getState().importProjectJson(json)
  const st = window.__ms.store.getState()
  return { kind: parsed.kind, blocks: parsed.customBlocks.length, nodes: st.doc.nodes.length, name: st.doc.name }
})()`)
check('工程 json 导出/导入', project.kind === 'mermaid-studio-project' && project.nodes === 5 && project.blocks === 1, JSON.stringify(project))

// 10. 自动布局
const layoutTest = await evaluate(`(() => {
  window.__ms.store.getState().runAutoLayout()
  const st = window.__ms.store.getState()
  const pos = st.doc.nodes.map(n => n.position)
  const unique = new Set(pos.map(p => p.x + ',' + p.y)).size
  return { unique, total: pos.length, groupSize: st.doc.nodes.filter(n=>n.data.isSubgraph).map(n=>Math.round(n.data.width)+'x'+Math.round(n.data.height)) }
})()`)
check('自动布局给出不同坐标', layoutTest.unique === layoutTest.total, JSON.stringify(layoutTest))

// 11. 预览面板渲染 mermaid
await evaluate(`window.__ms.store.getState().setRightTab('preview')`)
let preview = { svg: 0, alert: null }
for (let i = 0; i < 12; i++) {
  await new Promise((r) => setTimeout(r, 1200))
  preview = await evaluate(`(() => ({
    svg: document.querySelectorAll('.ms-preview svg').length,
    alert: document.querySelector('.ms-alert--error')?.textContent?.slice(0, 120) || null,
  }))()`)
  if (preview.svg > 0) break
}
check('Mermaid 预览渲染出 SVG', preview.svg > 0 && !preview.alert, JSON.stringify(preview))

// 12. 语法面板
await evaluate(`window.__ms.store.getState().setRightTab('code')`)
await new Promise((r) => setTimeout(r, 600))
const codePanel = await evaluate(`(() => {
  const ta = document.querySelector('.ms-code')
  return { exists: !!ta, starts: (ta?.value || '').split('\\n')[0] }
})()`)
check('语法面板显示 flowchart 头', codePanel.exists && /^flowchart /.test(codePanel.starts), JSON.stringify(codePanel))

// 13. 交互：拖拽新增节点（模拟 Drop 事件）
const dnd = await evaluate(`(() => {
  const pane = document.querySelector('.react-flow__pane')
  const dt = new DataTransfer()
  dt.setData('application/mermaid-block', 'builtin.decision')
  const rect = pane.getBoundingClientRect()
  const ev = new DragEvent('drop', { bubbles: true, cancelable: true, clientX: rect.left + 300, clientY: rect.top + 240, dataTransfer: dt })
  pane.dispatchEvent(ev)
  return { nodes: window.__ms.store.getState().doc.nodes.length }
})()`)
check('拖拽落点新增节点（+1）', dnd.nodes === 6, JSON.stringify(dnd))

console.log('\n--- 控制台错误 ---')
console.log(consoleErrors.length ? consoleErrors.join('\n') : '(无)')
console.log('--- 未捕获异常 ---')
console.log(exceptions.length ? exceptions.join('\n') : '(无)')

const failed = results.filter((r) => !r.ok)
console.log(`\n结果：${results.length - failed.length}/${results.length} 通过，控制台错误 ${consoleErrors.length}，异常 ${exceptions.length}`)

ws.close()
process.exit(failed.length || exceptions.length ? 1 : 0)
