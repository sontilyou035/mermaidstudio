const APP = process.env.MS_BASE || 'http://127.0.0.1:5274'

// 第八轮：md 文档结构（frontmatter / 存疑清单 / 变更记录）+ 固定 classDef
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

/* ---------- 造一张覆盖各个语义类的图 ---------- */
const fixture = await ev(`(() => {
  const s = window.__ms.store.getState()
  s.newDoc()
  const add = (block, x, y, label) => window.__ms.store.getState().addNodeFromBlock(block, { x, y }, label)
  const role = add('builtin.role.8', 60, 60, '顾客')
  const mq = add('builtin.start', 60, 200, '开始')
  const proc = add('builtin.process', 300, 200, '下单')
  const action = add('builtin.manual', 540, 200, '拣货')
  const table = add('builtin.table', 60, 360, 'orders')
  const job = add('builtin.document', 340, 380, '出库单')
  const ext = add('builtin.subject.0', 620, 380, '供应商')
  const st = () => window.__ms.store.getState()
  st().onConnect({ source: role, target: mq, sourceHandle: 'bottom', targetHandle: 'top' })
  st().onConnect({ source: mq, target: proc, sourceHandle: 'bottom', targetHandle: 'top' })
  st().onConnect({ source: proc, target: action, sourceHandle: 'bottom', targetHandle: 'top' })
  st().onConnect({ source: proc, target: table, sourceHandle: 'bottom', targetHandle: 'top' })
  st().onConnect({ source: action, target: job, sourceHandle: 'bottom', targetHandle: 'top' })
  // 一条虚线 = 待确认
  const dashed = st().onConnect({ source: ext, target: proc, sourceHandle: 'left', targetHandle: 'right' })
  const edges = st().doc.edges
  const last = edges[edges.length - 1]
  st().updateEdgeData(last.id, { lineStyle: 'dashed', label: '货源是否稳定' })
  st().updateNodeData(last.target, {})
  window.__ms.store.getState().clearSelection()
  return { role, mq, proc, action, table, job, ext, dashed: last.id, nodes: st().doc.nodes.length, edges: st().doc.edges.length }
})()`)
check('测试图准备完成（7 个语义节点 + 1 条虚线）', fixture.nodes === 7 && fixture.edges === 6, JSON.stringify(fixture))

/* ---------- 3. 固定 classDef ---------- */
const classes = await ev(`(() => {
  const code = window.__ms.store.getState().currentMermaid()
  const defs = code.split('\\n').filter(l => l.startsWith('classDef'))
  const uses = (name) => new RegExp(':::' + name + '$', 'm').test(code)
  return {
    defs,
    hasRole: uses('role'), hasProcess: uses('process'), hasAction: uses('action'),
    hasTable: uses('table'), hasJob: uses('job'), hasMq: uses('mq'), hasExternal: uses('external'),
    roleLine: defs.find(l => l.startsWith('classDef role')),
    processLine: defs.find(l => l.startsWith('classDef process')),
    mqLine: defs.find(l => l.startsWith('classDef mq')),
    tableLine: defs.find(l => l.startsWith('classDef table')),
    jobLine: defs.find(l => l.startsWith('classDef job')),
    actionLine: defs.find(l => l.startsWith('classDef action')),
    externalLine: defs.find(l => l.startsWith('classDef external')),
    noBlkPrefix: !defs.some(l => l.includes('blk_builtin_role') || l.includes('blk_builtin_start')),
  }
})()`)
check('七个固定 classDef 全部输出', classes.defs.length === 7, JSON.stringify(classes.defs))
check('role 颜色固定', classes.roleLine === 'classDef role fill:#e0e7ff,stroke:#4f46e5,color:#312e81', classes.roleLine)
check('action 颜色固定', classes.actionLine === 'classDef action fill:#ffedd5,stroke:#ea580c,color:#7c2d12', classes.actionLine)
check('process 颜色固定', classes.processLine === 'classDef process fill:#dbeafe,stroke:#2563eb,color:#1e3a8a', classes.processLine)
check('table 颜色固定', classes.tableLine === 'classDef table fill:#eef2ff,stroke:#4f46e5,color:#312e81', classes.tableLine)
check('job 颜色固定', classes.jobLine === 'classDef job fill:#fef9c3,stroke:#ca8a04,color:#713f12', classes.jobLine)
check('mq 颜色固定', classes.mqLine === 'classDef mq fill:#dcfce7,stroke:#16a34a,color:#14532d', classes.mqLine)
check('external 颜色固定', classes.externalLine === 'classDef external fill:#f3f4f6,stroke:#6b7280,color:#1f2937', classes.externalLine)
check('节点全部挂到语义类上', classes.hasRole && classes.hasProcess && classes.hasAction && classes.hasTable && classes.hasJob && classes.hasMq && classes.hasExternal && classes.noBlkPrefix)

/* ---------- 1+2. md 结构 ---------- */
const md = await ev(`(async () => {
  const mod = window.__ms
  const s = window.__ms.store.getState()
  const text = mod.buildMarkdown(s.doc, s.blocks(), s.currentMermaid(), { title: true, questions: true, changelog: true },
    { author: '测试作者', convention: '虚线=待确认', version: 3 })
  const lines = text.split('\\n')
  return {
    text,
    first: lines[0],
    fmEnd: lines.indexOf('---', 1),
    hasTables: text.includes('| 名称 | 节点块 |') || text.includes('| --- | --- |'),
    headings: lines.filter(l => l.startsWith('## ')).map(l => l.trim()),
    fenced: (text.match(/\`\`\`mermaid/g) || []).length,
    hasTitle: lines.includes('# 未命名图表'),
    questions: lines.filter(l => /^- \\[ \\]/.test(l)),
    changelog: lines.filter(l => /^- \\d{4}-\\d{2}-\\d{2}/.test(l)),
    frontmatter: lines.slice(1, lines.indexOf('---', 1)),
  }
})()`)
check('frontmatter 以 --- 开头并闭合', md.first === '---' && md.fmEnd === 7, JSON.stringify({ first: md.first, fmEnd: md.fmEnd }))
check('frontmatter 六个字段齐全', ['title:', 'kind:', 'version:', 'author:', 'updated:', 'convention:'].every((k) => md.frontmatter.some((l) => l.startsWith(k))), JSON.stringify(md.frontmatter))
check('frontmatter 值正确', md.frontmatter.includes('kind: mermaid-flowchart') && md.frontmatter.includes('version: 3') && md.frontmatter.includes('author: "测试作者"'), JSON.stringify(md.frontmatter))
check('章节：标题 / 流程图 / 存疑清单 / 变更记录', md.hasTitle && md.headings.join(',') === '## 流程图,## 存疑清单,## 变更记录', JSON.stringify(md.headings))
check('只有一个 mermaid 代码块', md.fenced === 1)
check('已去掉元素清单三张表', md.hasTables === false)
check('每条虚线对应一条存疑项（带稳定标记）', md.questions.length === 1 && md.questions[0].includes('货源是否稳定') && /<!-- ms:[\w-]+ -->$/.test(md.questions[0]), JSON.stringify(md.questions))
check('变更记录有一条', md.changelog.length === 1, JSON.stringify(md.changelog))

/* ---------- 写盘 + 保留手写内容 + 版本号 ---------- */
const write1 = await ev(`(async () => {
  window.__msTest = { content: null }
  window.showSaveFilePicker = async (opts) => ({
    name: opts?.suggestedName || 'doc.md',
    createWritable: async () => ({
      write: async (data) => { window.__msTest.content = typeof data === 'string' ? data : '[blob]' },
      close: async () => {},
    }),
    getFile: async () => ({ text: async () => window.__msTest.content || '' }),
    queryPermission: async () => 'granted',
    requestPermission: async () => 'granted',
  })
  await window.__ms.store.getState().saveToFile({ format: 'md', name: '订单流程', mdOptions: { title: true, questions: true, changelog: true }, chooseLocation: true })
  await new Promise(r => setTimeout(r, 300))
  const text = window.__msTest.content || ''
  return { version: (text.split('\\n').find(l => l.startsWith('version:')) || ''), hasFm: text.startsWith('---') }
})()`)
check('手动导出写入文件且带版本号 v1', write1.hasFm && write1.version === 'version: 1', JSON.stringify(write1))

// 模拟用户在 Obsidian 里勾选 + 加自己的条目 + 历史变更记录
const merged = await ev(`(async () => {
  const text = window.__msTest.content
  const edited = text
    .replace('- [ ] 货源是否稳定', '- [x] 货源是否稳定（已和采购确认）')
    .replace('## 变更记录', '## 存疑清单-extra-placeholder\\n## 变更记录')
    .replace('- [x] 货源是否稳定（已和采购确认）', '- [x] 货源是否稳定（已和采购确认）\\n- [ ] 供应商账期要不要写进图里')
    .replace('- 2026', '- 历史条目：2026')
  window.__msTest.content = edited.replace('## 存疑清单-extra-placeholder\\n', '')
  await window.__ms.store.getState().saveToFile({ format: 'md', name: '订单流程', mdOptions: { title: true, questions: true, changelog: true }, chooseLocation: false })
  await new Promise(r => setTimeout(r, 300))
  window.__msTest.content = window.__msTest.content + '\\n## 备注\\n\\n这是我手写的补充说明。\\n'
  await window.__ms.store.getState().saveToFile({ format: 'md', name: '订单流程', mdOptions: { title: true, questions: true, changelog: true }, chooseLocation: false })
  await new Promise(r => setTimeout(r, 300))
  const out = window.__msTest.content || ''
  const lines = out.split('\\n')
  const qStart = lines.indexOf('## 存疑清单')
  let qEnd = lines.length
  for (let i = qStart + 1; i < lines.length; i++) if (lines[i].startsWith('## ')) { qEnd = i; break }
  const items = qStart < 0 ? [] : lines.slice(qStart + 1, qEnd).filter(l => /^- \\[.\\]/.test(l))
  return {
    version: lines.find(l => l.startsWith('version:')),
    itemCount: items.length,
    items,
    checked: items.find(l => l.includes('货源是否稳定')),
    customItem: items.some(l => l.includes('供应商账期要不要写进图里')),
    changelogLines: lines.filter(l => /^- /.test(l) && l.includes('导出')).length,
    historical: lines.some(l => l.includes('历史条目')),
    extraSection: out.includes('## 备注') && out.includes('这是我手写的补充说明'),
  }
})()`)
// 到这一步一共手动导出过 3 次（首次 + 合并一次 + 保留章节一次）
check('每次手动导出都把版本号 +1', merged.version === 'version: 3', merged.version)
check('保留用户勾选状态 [x]', merged.checked?.startsWith('- [x]') === true, merged.checked)
check('用户改过的文字保留且不重复', merged.itemCount === 2, JSON.stringify(merged.items))
check('保留用户自己加的存疑条目', merged.customItem === true, JSON.stringify(merged.items))
check('变更记录会累积历史条目', merged.changelogLines === 3 && merged.historical === true, JSON.stringify({ lines: merged.changelogLines, historical: merged.historical }))
check('用户自己加的章节（## 备注）不会被覆盖', merged.extraSection === true)

/* ---------- 自动保存不改版本号 ---------- */
const autoVersion = await ev(`(async () => {
  const before = window.__msTest.content.split('\\n').find(l => l.startsWith('version:'))
  window.__ms.store.getState().addNodeFromBlock('builtin.process', { x: 900, y: 620 }, '自动保存测试')
  const ok = await window.__ms.store.getState().autoSaveToFile()
  await new Promise(r => setTimeout(r, 300))
  const after = window.__msTest.content.split('\\n').find(l => l.startsWith('version:'))
  const checked = window.__msTest.content.split('\\n').some(l => l.startsWith('- [x] 货源是否稳定'))
  return { ok, before, after, checked }
})()`)
check('自动保存写入但不改版本号', autoVersion.ok === true && autoVersion.before === autoVersion.after, JSON.stringify(autoVersion))
check('自动保存也保留勾选状态', autoVersion.checked === true)

/* ---------- 导入回来仍能用语义类 ---------- */
const roundTrip = await ev(`(() => {
  const s = window.__ms.store.getState()
  const code = s.currentMermaid()
  const res = s.importMermaid(code)
  const st = window.__ms.store.getState()
  const blocks = st.blocks()
  const used = st.doc.nodes.map(n => blocks.find(b => b.id === n.data.blockId)).filter(Boolean)
  return {
    ok: res.ok,
    classNames: [...new Set(used.map(b => b.className).filter(Boolean))].sort(),
    labels: st.doc.nodes.map(n => n.data.label).slice(0, 4),
    nodes: st.doc.nodes.length,
  }
})()`)
check('导出再导入仍落到语义类节点块', roundTrip.ok && ['action', 'external', 'job', 'mq', 'process', 'role', 'table'].every((c) => roundTrip.classNames.includes(c)), JSON.stringify(roundTrip.classNames))

/* ---------- 导出的 .md 能再导回来（.md 导入链路） ---------- */
const mdRoundTrip = await ev(`(async () => {
  const mod = window.__ms
  const s = window.__ms.store.getState()
  const text = s.exportAllData ? null : null
  // 用第 1 步准备的那张图，走 buildMarkdown 生成一份 md
  const exp = window.__ms
  const md = exp.buildMarkdown(s.doc, s.blocks(), s.currentMermaid(), { title: true, questions: true, changelog: true },
    { author: 'x', convention: 'y', version: 1 })
  // 用真实的抽取函数解析回来
  const parsed = mod.extractMermaidFromMarkdown(md)
  const before = window.__ms.store.getState().doc.nodes.length
  const res = window.__ms.store.getState().importMermaid(parsed.code)
  const after = window.__ms.store.getState().doc.nodes.length
  // 纯 mermaid（没有围栏）也要能识别
  const NL = String.fromCharCode(10)
  const plain = mod.extractMermaidFromMarkdown(['flowchart TB', '  A --> B'].join(NL))
  let err = ''
  try { mod.extractMermaidFromMarkdown(['# 只是普通笔记', '', '没有图'].join(NL)) } catch (e) { err = e.message }
  return { ok: res.ok, before, after, title: parsed.title, plainOk: plain.code.startsWith('flowchart'), err }
})()`)
check('.md 的 mermaid 代码块能被抽出来并导回画布', mdRoundTrip.ok === true && mdRoundTrip.after === mdRoundTrip.before, JSON.stringify({ before: mdRoundTrip.before, after: mdRoundTrip.after }))
check('纯 .mmd 文本也能识别', mdRoundTrip.plainOk === true)
check('没有 mermaid 的文件给出清晰报错', mdRoundTrip.err.includes('Mermaid'), mdRoundTrip.err)

console.log('\n异常/错误:', errors.length ? errors.join('\n') : '(无)')
const failed = out.filter(([, ok]) => !ok).length
console.log(`结果：${out.length - failed}/${out.length} 通过`)
ws.close()
process.exit(failed || errors.length ? 1 : 0)
