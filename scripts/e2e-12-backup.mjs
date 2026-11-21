// 第十二轮：全量备份 / 恢复（部署前必须可靠）
const APP = process.env.MS_BASE || 'http://127.0.0.1:5274'
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
await send('Page.navigate', { url: `${APP}/` }); await sleep(5000)
await ev(`(() => { Object.keys(localStorage).filter(k=>k.startsWith('mermaid-studio:')).forEach(k=>localStorage.removeItem(k)); return 1 })()`)
await send('Page.reload'); await sleep(5500)

/* ---------- 造点数据：两份图表 + 一个自定义块 ---------- */
const fixture = await ev(`(async () => {
  const s = window.__ms.store.getState()
  // 图表 1：当前这份
  window.__ms.store.getState().addNodeFromBlock('builtin.role.8', { x: 80, y: 80 }, '顾客')
  window.__ms.store.getState().renameDoc('主流程')
  window.__ms.store.getState().saveNow()
  // 自定义块
  s.openBlockEditor('builtin.api')
  window.__ms.store.getState().updateDraft({ id: 'blk_backup_test', name: '备份测试块', idPrefix: 'bt' })
  window.__ms.store.getState().saveDraft()
  // 图表 2
  window.__ms.store.getState().newDoc()
  window.__ms.store.getState().addNodeFromBlock('builtin.table', { x: 80, y: 80 }, 'order_data')
  window.__ms.store.getState().renameDoc('数据表')
  window.__ms.store.getState().saveNow()
  await new Promise(r => setTimeout(r, 900))
  const st = window.__ms.store.getState()
  return { docs: st.index.order.length, blocks: st.customBlocks.length, names: st.index.order.map(i => st.index.metas[i]?.name) }
})()`)
check('准备了两份图表 + 一份自定义块', fixture.docs === 2 && fixture.blocks === 1, JSON.stringify(fixture))

/* ---------- 导出全量备份 ---------- */
const backupJson = await ev(`(() => window.__ms.store.getState().exportAllData())()`)
const backup = await ev(`(async () => {
  const json = ${JSON.stringify(backupJson)}
  const parsed = JSON.parse(json)
  // 模拟用户把备份文件存下来
  return {
    kind: parsed.kind, version: parsed.version, docs: parsed.documents.length, blocks: parsed.customBlocks.length,
    names: parsed.documents.map(d => d.name),
    hasNodes: parsed.documents.every(d => Array.isArray(d.nodes) && d.nodes.length > 0),
    author: parsed.settings?.mdAuthor,
  }
})()`)
check('备份包结构正确（kind/version/documents/customBlocks）', backup.kind === 'mermaid-studio-backup' && backup.version === 1, JSON.stringify(backup))
check('两份图表都进了备份', backup.docs === 2 && backup.hasNodes === true, JSON.stringify(backup.names))
check('自定义节点块也进了备份', backup.blocks === 1)
check('设置（作者等）一并带上', !!backup.author, String(backup.author))

/* ---------- 界面上的备份按钮 ---------- */
const ui = await ev(`(async () => {
  window.__ms.store.getState().setRightTab('files')
  await new Promise(r => setTimeout(r, 700))
  const buttons = [...document.querySelectorAll('.ms-right button')].map(b => b.textContent.trim())
  return { buttons, panelText: (document.querySelector('.ms-right')?.innerText || '').slice(0, 400) }
})()`)
check('「保存」面板里有导出/恢复备份按钮', ui.buttons.some((b) => b.includes('导出全部图表')) && ui.buttons.some((b) => b.includes('从备份恢复')), JSON.stringify(ui.buttons))
check('面板提示了本地数据的风险', ui.panelText.includes('清缓存') || ui.panelText.includes('备份'), ui.panelText.slice(0, 80))

/* ---------- 模拟「清缓存 / 换电脑」后恢复 ---------- */
const restored = await ev(`(async () => {
  const json = ${JSON.stringify(backupJson)}
  // 清空所有本地数据，模拟换电脑
  Object.keys(localStorage).filter(k => k.startsWith('mermaid-studio:')).forEach(k => localStorage.removeItem(k))
  window.__ms.store.setState({ index: { order: [], active: null, metas: {} }, customBlocks: [] })
  await new Promise(r => setTimeout(r, 300))
  const before = { docs: window.__ms.store.getState().index.order.length, blocks: window.__ms.store.getState().customBlocks.length }
  const res = window.__ms.store.getState().importAllData(json)
  await new Promise(r => setTimeout(r, 600))
  const st = window.__ms.store.getState()
  const reloaded = st.index.order.map(id => JSON.parse(localStorage.getItem('mermaid-studio:doc:' + id) || 'null'))
  return {
    before, res,
    docs: st.index.order.length, blocks: st.customBlocks.length,
    names: st.index.order.map(i => st.index.metas[i]?.name),
    nodesOk: reloaded.every(d => d && Array.isArray(d.nodes) && d.nodes.length > 0),
    blockId: st.customBlocks[0]?.id,
    blockPrefix: st.customBlocks[0]?.idPrefix,
    authorAfter: st.settings.mdAuthor,
  }
})()`)
check('清空本地数据后确实没有图表了', restored.before.docs === 0 && restored.before.blocks === 0, JSON.stringify(restored.before))
check('从备份恢复出两份图表', restored.docs === 2 && restored.nodesOk === true, JSON.stringify({ docs: restored.docs, names: restored.names }))
check('自定义节点块连 ID 前缀一起恢复', restored.blocks === 1 && restored.blockId === 'blk_backup_test' && restored.blockPrefix === 'bt', JSON.stringify(restored))

/* ---------- 再刷新一次，确认真的落到本地了 ---------- */
await send('Page.reload')
await sleep(5000)
const afterReload = await ev(`(() => {
  const st = window.__ms.store.getState()
  return { docs: st.index.order.length, blocks: st.customBlocks.length, activeDoc: st.doc.name, palette: document.querySelectorAll('.ms-block-item').length }
})()`)
check('刷新后恢复的数据还在（真的写进本地了）', afterReload.docs === 2 && afterReload.blocks === 1 && afterReload.palette === 39, JSON.stringify(afterReload))

/* ---------- 重复导入不会覆盖原有数据 ---------- */
const dedupe = await ev(`(() => {
  const before = window.__ms.store.getState().index.order.length
  window.__ms.store.getState().importAllData(${JSON.stringify(backupJson)})
  const st = window.__ms.store.getState()
  return { before, after: st.index.order.length, names: st.index.order.map(i => st.index.metas[i]?.name) }
})()`)
check('重复导入会新建一份而不是覆盖', dedupe.after === dedupe.before + 2 && dedupe.names.some((n) => n?.includes('导入')), JSON.stringify(dedupe.names))

/* ---------- 坏文件要有清晰报错 ---------- */
const bad = await ev(`(() => {
  let msg = ''
  try { window.__ms.store.getState().importAllData('{"kind":"whatever"}') } catch (e) { msg = e.message }
  return msg
})()`)
check('导入非备份文件会明确报错', bad.includes('备份文件'), bad)

console.log('\n异常/错误:', errors.length ? errors.join('\n') : '(无)')
const failed = out.filter(([, ok]) => !ok).length
console.log(`结果：${out.length - failed}/${out.length} 通过`)
ws.close()
process.exit(failed || errors.length ? 1 : 0)
