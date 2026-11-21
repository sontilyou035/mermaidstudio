const APP = process.env.MS_BASE || 'http://127.0.0.1:5274'

// 第五轮：本轮修复 + 新增项验证
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
const mouse = (type, x, y) => send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1 })
async function drag(a, b, steps = 12) {
  await mouse('mousePressed', a.x, a.y)
  for (let i = 1; i <= steps; i++) { await mouse('mouseMoved', a.x + (b.x - a.x) * i / steps, a.y + (b.y - a.y) * i / steps); await sleep(28) }
  await mouse('mouseReleased', b.x, b.y)
  await sleep(250)
}
const out = []
const check = (n, ok, d = '') => { out.push([n, ok]); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ` — ${d}` : ''}`) }

await send('Runtime.enable'); await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1560, height: 940, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: APP + '/' }); await sleep(5000)
await ev(`(() => { Object.keys(localStorage).filter(k=>k.startsWith('mermaid-studio:')).forEach(k=>localStorage.removeItem(k)); return 1 })()`)
await send('Page.reload'); await sleep(5500)

/* ---------- 修复 1：数据表字段可编辑 ---------- */
const fieldEdit = await ev(`(async () => {
  const s = window.__ms.store.getState()
  const id = s.addNodeFromBlock('builtin.table', { x: 120, y: 120 }, 'orders')
  window.__ms.store.getState().selectOnly([id])
  window.__ms.store.getState().setRightTab('inspector')
  await new Promise(r => setTimeout(r, 700))
  const rows = [...document.querySelectorAll('.ms-right .ms-row')]
  const colsRow = rows.find(r => r.querySelector('.ms-row__label')?.textContent === '字段列表')
  const ta = colsRow?.querySelector('textarea')
  if (!ta) return { found: false }
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
  setter.call(ta, 'id: bigint\\nshop_id: bigint\\npay_type: varchar\\npaid_at: datetime\\nremark: text')
  ta.dispatchEvent(new Event('input', { bubbles: true }))
  await new Promise(r => setTimeout(r, 600))
  const node = window.__ms.store.getState().doc.nodes.find(n => n.id === id)
  const domRows = [...document.querySelectorAll('[data-id="' + id + '"] .ms-table__row')].map(e => e.innerText.replace(/\\s+/g,' ').trim())
  return { found: true, tag: ta.tagName, value: node.data.values.columns.split('\\n').length, height: node.data.height, domRows }
})()`)
check('数据表字段列表用多行输入框', fieldEdit.found && fieldEdit.tag === 'TEXTAREA', JSON.stringify(fieldEdit).slice(0, 160))
check('编辑字段列表后模型/画布同步', fieldEdit.value === 5 && fieldEdit.domRows?.length === 5, JSON.stringify(fieldEdit.domRows))

// 节点上双击直接改字段
const inlineEdit = await (async () => {
  const pos = await ev(`(() => {
    const el = document.querySelector('.ms-node--table .ms-table__rows')
    const r = el.getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  })()`)
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pos.x, y: pos.y, button: 'left', clickCount: 2, buttons: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pos.x, y: pos.y, button: 'left', clickCount: 2, buttons: 0 })
  await sleep(500)
  const st = await ev(`(() => {
    const ta = document.querySelector('.ms-table__editor')
    if (!ta) return { open: false }
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
    setter.call(ta, 'id: bigint\\nstatus: varchar')
    ta.dispatchEvent(new Event('input', { bubbles: true }))
    ta.blur()
    return new Promise(res => setTimeout(() => {
      const s = window.__ms.store.getState()
      const n = s.doc.nodes.find(x => x.data.blockId === 'builtin.table')
      res({ open: true, rows: n.data.values.columns.split('\\n').length, height: n.data.height })
    }, 600))
  })()`)
  return st
})()
check('节点上双击即可编辑字段', inlineEdit.open && inlineEdit.rows === 2 && inlineEdit.height < fieldEdit.height, JSON.stringify(inlineEdit))

/* ---------- 修复 2：数据表四个方向都有端口 ---------- */
const ports = await ev(`(() => {
  const s = window.__ms.store.getState()
  const n = s.doc.nodes.find(x => x.data.blockId === 'builtin.table')
  const handles = [...document.querySelectorAll('[data-id="' + n.id + '"] .react-flow__handle')]
    .map(h => h.className.match(/react-flow__handle-(top|right|bottom|left)/)?.[1])
  return { handles }
})()`)
check('数据表有上下左右四个连接口', ['top','right','bottom','left'].every(s => ports.handles.includes(s)), JSON.stringify(ports))

/* ---------- 修复 3：从所选端口连线 ---------- */
// 用非默认端口（右 -> 下），否则默认就是 bottom->top，测不出区别
const plain = await ev(`(() => {
  const s = window.__ms.store.getState()
  const nodes = s.doc.nodes.filter(n => !n.data.isSubgraph && n.data.blockId !== 'builtin.table')
  const pick = (node, side) => {
    const el = [...document.querySelectorAll('[data-id="' + node.id + '"] .react-flow__handle')].find(h => h.className.includes(side))
    const r = el.getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  }
  return { a: nodes[0].id, b: nodes[2].id, from: pick(nodes[0], 'right'), to: pick(nodes[2], 'bottom') }
})()`)
await drag(plain.from, plain.to)
await sleep(1300)
const conn = await ev(`(() => {
  const s = window.__ms.store.getState()
  const e = s.doc.edges[s.doc.edges.length - 1]
  const A = s.doc.nodes.find(n => n.id === e.source)
  const B = s.doc.nodes.find(n => n.id === e.target)
  const path = document.querySelector('.react-flow__edge[data-id="' + e.id + '"] .react-flow__edge-path')?.getAttribute('d') || ''
  const nums = path.slice(1).split(/[ ,]+/).map(parseFloat)
  const start = [nums[0], nums[1]]
  return {
    source: e.source, target: e.target,
    sourceHandle: e.sourceHandle, targetHandle: e.targetHandle,
    expectSource: ${JSON.stringify(plain.a)}, expectTarget: ${JSON.stringify(plain.b)},
    start,
    expectStart: A ? [Math.round((A.position.x + A.data.width) * 100) / 100, Math.round((A.position.y + A.data.height / 2) * 100) / 100] : null,
    targetNodeX: B?.position.x,
  }
})()`)
check('连线记录起点端口（right）', conn.sourceHandle === 'right' && conn.targetHandle === 'bottom', JSON.stringify([conn.sourceHandle, conn.targetHandle]))
check('连线端点连的是这两条线所选的节点', conn.source === conn.expectSource && conn.target === conn.expectTarget)
// 起点画在端口外沿，允许几像素误差
const startOk = conn.expectStart && Math.abs(conn.start[0] - conn.expectStart[0]) < 8 && Math.abs(conn.start[1] - conn.expectStart[1]) < 4
check('连线从所选端口（右侧）出发绘制', startOk, `path 起点=${JSON.stringify(conn.start)} 期望≈${JSON.stringify(conn.expectStart)}`)

/* ---------- 新增 1：角色 / 主体两栏 ---------- */
const categories = await ev(`(() => {
  const sections = [...document.querySelectorAll('.ms-group')].map(g => ({
    title: g.querySelector('.ms-group__title')?.textContent.replace(/[0-9]+$/, '').trim(),
    items: [...g.querySelectorAll('.ms-block-item__name')].map(e => e.textContent.trim()),
  }))
  const find = (t) => sections.find(s => s.title === t)?.items ?? []
  const blocks = window.__ms.store.getState().blocks()
  return {
    titles: sections.map(s => s.title),
    roles: find('角色'),
    subjects: find('主体'),
    blockRoles: blocks.filter(b => b.category === '角色').length,
    blockSubjects: blocks.filter(b => b.category === '主体').length,
  }
})()`)
check('调色板出现「角色」「主体」两栏', categories.titles.includes('角色') && categories.titles.includes('主体'), JSON.stringify(categories.titles))
check('角色栏 9 个（促销员…顾客）', categories.roles.length === 9 && categories.blockRoles === 9, `${categories.roles.length} / ${categories.blockRoles}`)
check('主体栏 9 个（供应商…分公司）', categories.subjects.length === 9 && categories.blockSubjects === 9, `${categories.subjects.length} / ${categories.blockSubjects}`)
check(
  '角色/主体名称完整',
  categories.roles.join(',') ===
    '🎯 促销员,📦 拣货员,🚚 配送员,💰 财务专员,🎧 客服,🧾 收银员,🧑‍💼 店长,📊 品类主管,🛒 顾客' &&
    categories.subjects.join(',') === '🏭 供应商,🤝 联营商,🌐 渠道平台,🚛 配送商,🏪 商户,💳 支付服务商,🏬 自营商,🏢 集团,🏤 分公司',
  JSON.stringify([categories.roles, categories.subjects]),
)

const semantic = await ev(`(() => {
  const s = window.__ms.store.getState()
  const id = s.addNodeFromBlock('builtin.role.0', { x: 40, y: 620 })
  const id2 = window.__ms.store.getState().addNodeFromBlock('builtin.subject.5', { x: 240, y: 620 })
  const st = window.__ms.store.getState()
  const code = st.currentMermaid()
  return {
    n1: st.doc.nodes.find(n => n.id === id)?.data.label,
    n2: st.doc.nodes.find(n => n.id === id2)?.data.label,
    line1: code.split('\\n').find(l => l.includes('促销员')) || '',
    line2: code.split('\\n').find(l => l.includes('支付服务商')) || '',
    classDefs: code.split('\\n').filter(l => l.startsWith('classDef')).length,
  }
})()`)
check('可拖入角色节点（促销员）', semantic.n1 === '促销员' && semantic.line1.includes('促销员'), JSON.stringify(semantic.line1))
check('可拖入主体节点（支付服务商）', semantic.n2 === '支付服务商' && semantic.line2.includes('支付服务商'), JSON.stringify(semantic.line2))
const classUnique = await ev(`(() => {
  const lines = window.__ms.store.getState().currentMermaid().split('\\n').filter(l => l.startsWith('classDef'))
  const styles = lines.map(l => l.split(' ').slice(2).join(' '))
  return { lines: lines.length, unique: new Set(styles).size, dup: lines.length - new Set(styles).size }
})()`)
check('相同样式的节点块共用 classDef（无重复）', classUnique.dup === 0, JSON.stringify(classUnique))

/* ---------- 新增 2：保存弹框（md 默认 + 自动保存项） ---------- */
const dialog = await ev(`(async () => {
  window.__ms.store.getState().openSaveDialog()
  await new Promise(r => setTimeout(r, 600))
  const panel = document.querySelector('.ms-modal__panel--save')
  if (!panel) return { open: false }
  const formatSel = [...panel.querySelectorAll('select')][0]
  const switches = [...panel.querySelectorAll('.ms-switch')].map(s => s.textContent.trim())
  const autoInput = [...panel.querySelectorAll('.ms-switch input')].find(i => i.closest('.ms-subsection')?.querySelector('.ms-subsection__title')?.textContent === '自动保存')
  return {
    open: true,
    format: formatSel.value,
    formats: [...formatSel.options].map(o => o.textContent.trim()),
    hasFileTarget: !!panel.querySelector('.ms-filetarget'),
    switches,
    autoChecked: autoInput?.checked,
    hasAutoSection: [...panel.querySelectorAll('.ms-subsection__title')].some((t) => t.textContent === '自动保存'),
    perDocHint: (panel.innerText || '').includes('不会写到上一张图的文件里'),
    supportsPicker: 'showSaveFilePicker' in window,
  }
})()`)
check('点保存弹出保存对话框', dialog.open === true, JSON.stringify(dialog).slice(0, 120))
check('默认格式是 Markdown(.md)', dialog.format === 'md' && dialog.formats[0].includes('Markdown'), dialog.formats[0])
check(
  '对话框不再有自动保存开关（默认就是自动保存）',
  dialog.hasAutoSection === false && dialog.autoChecked === undefined && dialog.perDocHint === true,
  JSON.stringify({ hasAutoSection: dialog.hasAutoSection, switches: dialog.switches }),
)
check('浏览器支持选择保存位置（Chrome）', dialog.supportsPicker === true)

// 生成 md 内容检查（不走系统弹窗，直接构建内容）
const md = await ev(`(async () => {
  const mod = window.__ms
  const s = window.__ms.store.getState()
  const blocks = s.blocks()
  const code = s.currentMermaid()
  const text = mod.buildMarkdown(s.doc, blocks, code, { title: true, questions: true, changelog: true })
  return { head: text.slice(0, 120), hasMermaid: text.includes('\`\`\`mermaid'),
           hasFrontmatter: text.indexOf('---') === 0 && text.includes('title:'), hasQuestionList: text.includes('## 存疑清单'),
           fences: (text.match(/\`\`\`/g) || []).length }
})()`)
check('.md 内含 mermaid 代码块', md.hasMermaid && md.fences === 2, JSON.stringify(md).slice(0, 140))
check('.md 带 frontmatter 与存疑清单', md.hasFrontmatter === true && md.hasQuestionList === true, md.head)

// 保存到本地文件（用真实文件系统 API 走一遍，写到下载目录）
const saveFlow = await ev(`(async () => {
  const exec = window.__ms && window.__ms.store ? null : null
  return true
})()`)
void saveFlow

// 直接调用保存（走下载分支），确认不抛错并且 localStorage 已落盘
const saveResult = await ev(`(async () => {
  let downloaded = null
  const origCreate = URL.createObjectURL
  const origClick = HTMLAnchorElement.prototype.click
  HTMLAnchorElement.prototype.click = function () { downloaded = { name: this.download, href: this.href } }
  await window.__ms.store.getState().saveToFile({ format: 'md', name: '订单流程', mdOptions: { title: true, questions: true, changelog: true }, chooseLocation: false })
  HTMLAnchorElement.prototype.click = origClick
  URL.revokeObjectURL = origCreate ? URL.revokeObjectURL : URL.revokeObjectURL
  const s = window.__ms.store.getState()
  const key = 'mermaid-studio:doc:' + s.doc.id
  return { downloaded, localSaved: !!localStorage.getItem(key), dirty: s.dirty }
})()`)
check('保存会同时落一份到浏览器本地并产出文件', saveResult.downloaded?.name === '订单流程.md' && saveResult.localSaved, JSON.stringify(saveResult))

const targetUI = await ev(`(async () => {
  window.__ms.store.getState().closeSaveDialog()
  await new Promise(r => setTimeout(r, 400))
  const saveBtn = [...document.querySelectorAll('.ms-btn')].find(b => b.textContent.includes('保存…'))
  return {
    saveBtn: !!saveBtn,
    fileHint: !!document.querySelector('.ms-filehint'),
    hasAutoSwitch: document.body.innerText.includes('自动写入上面选定的文件'),
  }
})()`)
check(
  '顶栏只剩保存入口（自动保存的状态展示已隐藏）',
  targetUI.saveBtn && !targetUI.fileHint && !targetUI.hasAutoSwitch,
  JSON.stringify(targetUI),
)

/* ---------- 新增 2 续：真实走一遍「选择位置并保存」+ 自动保存 ---------- */
const pickerFlow = await ev(`(async () => {
  window.__msTest = { writes: [] }
  // 用一个假的文件句柄替换系统弹窗，验证我们自己的保存/写入链路
  window.showSaveFilePicker = async (opts) => ({
    name: opts?.suggestedName || 'untitled.md',
    kind: 'file',
    createWritable: async () => ({
      write: async (data) => { window.__msTest.writes.push(typeof data === 'string' ? data : '[blob ' + (data?.type || '') + ']') },
      close: async () => {},
    }),
    queryPermission: async () => 'granted',
    requestPermission: async () => 'granted',
  })
  const res = await window.__ms.store.getState().saveToFile({
    format: 'md',
    name: '订单流程',
    mdOptions: { title: true, questions: true, changelog: true },
    chooseLocation: true,
  })
  await new Promise(r => setTimeout(r, 400))
  const st = window.__ms.store.getState()
  const content = window.__msTest.writes[0] || ''
  return {
    ok: res.ok,
    target: st.fileTarget && { name: st.fileTarget.name, format: st.fileTarget.format, permission: st.fileTarget.permission, savedAt: !!st.fileTarget.savedAt },
    writes: window.__msTest.writes.length,
    head: content.slice(0, 60),
    hasFence: content.includes('\u0060\u0060\u0060mermaid'),
    targetName: st.fileTarget?.name,
  }
})()`)
check('「选择位置并保存」写出文件并记住目标', pickerFlow.ok && pickerFlow.target?.name === '订单流程.md' && pickerFlow.target.permission === 'granted', JSON.stringify(pickerFlow).slice(0, 200))
check('写出的 .md 含 mermaid 代码块', pickerFlow.hasFence === true && pickerFlow.writes === 1, JSON.stringify(pickerFlow.head))
check('保存目标记在当前图表名下', (pickerFlow.targetName || '').includes('订单流程'), pickerFlow.targetName)

const autoFlow = await ev(`(async () => {
  const before = window.__msTest.writes.length
  // 先改点东西（触发 changedAt），再跑一次自动保存
  window.__ms.store.getState().addNodeFromBlock('builtin.role.2', { x: 700, y: 700 })
  const s1 = window.__ms.store.getState()
  const first = await s1.autoSaveToFile()
  await new Promise(r => setTimeout(r, 300))
  // 没有新改动时不应重复写
  const second = await window.__ms.store.getState().autoSaveToFile()
  const st = window.__ms.store.getState()
  return {
    first, second,
    writes: window.__msTest.writes.length - before,
    autoSaveFile: st.settings.autoSaveFile,
    interval: st.settings.autoSaveIntervalSec,
    savedAt: !!st.fileTarget?.savedAt,
  }
})()`)
check('自动保存会把改动写进选定文件', autoFlow.first === true && autoFlow.writes === 1, JSON.stringify(autoFlow))
check('无改动时不会重复写文件', autoFlow.second === false, JSON.stringify(autoFlow))

const newDocTarget = await ev(`(async () => {
  const before = window.__msTest.writes.length
  const oldTarget = window.__ms.store.getState().fileTarget?.name
  window.__ms.store.getState().newDoc()
  await new Promise(r => setTimeout(r, 400))
  const target = window.__ms.store.getState().fileTarget
  window.__ms.store.getState().addNodeFromBlock('builtin.subject.0', { x: 900, y: 700 })
  const wrote = await window.__ms.store.getState().autoSaveToFile()
  return { oldTarget, target, wrote, writes: window.__msTest.writes.length - before }
})()`)
check(
  '新建后不再沿用上一个文件（不会写进旧文件）',
  newDocTarget.oldTarget?.includes('订单流程') &&
    newDocTarget.target === null &&
    newDocTarget.wrote === false &&
    newDocTarget.writes === 0,
  JSON.stringify(newDocTarget),
)

console.log('\n异常/错误:', errors.length ? errors.join('\n') : '(无)')
const failed = out.filter(([, ok]) => !ok).length
console.log(`结果：${out.length - failed}/${out.length} 通过`)
ws.close()
process.exit(failed || errors.length ? 1 : 0)
