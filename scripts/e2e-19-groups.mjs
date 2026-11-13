const APP = process.env.MS_BASE || 'http://127.0.0.1:5273'

// 第十九轮：解析子图（分组包含成员、分组垫底、组内连线方向、节点顺序从上到下）
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
const check = (n, ok, d = '') => {
  out.push([n, ok])
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ` — ${d}` : ''}`)
}

const CODE = `flowchart TB
  subgraph web[接入层]
    gw[网关]
    auth[鉴权]
  end
  subgraph core[交易核心]
    subgraph order[订单]
      create[下单]
      cancel[取消]
    end
    subgraph stock[库存]
      lock[锁定库存]
      release[释放库存]
    end
    create --> lock
    cancel --> release
  end
  gw --> auth
  auth --> create`

await send('Runtime.enable')
await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1560, height: 940, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: APP + '/' })
await sleep(3000)
await ev(`(() => { Object.keys(localStorage).filter(k=>k.startsWith('mermaid-studio:')).forEach(k=>localStorage.removeItem(k)); return 1 })()`)
await send('Page.navigate', { url: APP + '/' })
await sleep(3200)

const imported = await ev(`window.__ms.store.getState().importMermaid(${JSON.stringify(CODE)})`)
check('导入成功', imported.ok === true, JSON.stringify(imported))
await sleep(1200)
// 命中测试要保证节点都在可视区里
const fit = async () => {
  await ev(`document.querySelector('.react-flow__controls-fitview')?.click()`)
  await sleep(800)
}
await fit()

/** 分组盒子的数据尺寸 / style 尺寸 / DOM 尺寸是否一致，成员是否都在盒子里 */
const probe = `(() => {
  const st = window.__ms.store.getState()
  const nodes = st.doc.nodes
  const dom = (n) => {
    const el = document.querySelector('.react-flow__node[data-id="' + n.id + '"]')
    return el ? el.getBoundingClientRect() : null
  }
  const groups = nodes.filter((n) => n.data.isSubgraph).map((g) => {
    const gd = dom(g)
    const kids = nodes.filter((n) => n.id !== g.id && n.data.groupId === g.id)
    const outside = kids.filter((k) => {
      const kd = dom(k)
      if (!gd || !kd) return true
      return kd.left < gd.left - 2 || kd.top < gd.top - 2 || kd.right > gd.right + 2 || kd.bottom > gd.bottom + 2
    })
    return {
      label: g.data.label,
      data: [g.data.width, g.data.height],
      style: [g.style && g.style.width, g.style && g.style.height],
      members: kids.map((k) => k.data.label),
      outside: outside.map((k) => k.data.label),
    }
  })
  // 点成员中心，最上层应该是成员自己，而不是分组
  const hitSelf = (label) => {
    const n = nodes.find((x) => x.data.label === label)
    const r = dom(n)
    if (!r) return null
    const hits = document.elementsFromPoint(r.left + r.width / 2, r.top + r.height / 2)
    const nodeEl = hits.find((h) => h.classList && h.classList.contains('react-flow__node'))
    return nodeEl ? nodeEl.getAttribute('data-id') === n.id : null
  }
  return {
    groups,
    order: nodes.map((n) => ({ label: n.data.label, group: !!n.data.isSubgraph, y: Math.round(n.position.y) })),
    hit: { 网关: hitSelf('网关'), 下单: hitSelf('下单'), 锁定库存: hitSelf('锁定库存') },
    edges: st.doc.edges.map((e) => ({
      label: e.data && e.data.label,
      from: nodes.find((n) => n.id === e.source)?.data.label,
      to: nodes.find((n) => n.id === e.target)?.data.label,
      sh: e.sourceHandle,
      th: e.targetHandle,
    })),
  }
})()`

let r = await ev(probe)
const byLabel = new Map(r.groups.map((g) => [g.label, g]))
check('识别出 4 个分组', r.groups.length === 4, r.groups.map((g) => `${g.label}(${g.members.join('+')})`).join(' '))
check(
  '每个分组都包含自己的成员（含子分组）',
  byLabel.get('接入层')?.members.slice().sort().join(',') === '网关,鉴权' &&
    byLabel.get('交易核心')?.members.slice().sort().join(',') === '库存,订单',
  JSON.stringify(r.groups.map((g) => `${g.label}[${g.members}]`)),
)
check(
  '分组的 data 尺寸和 style 尺寸一致（盒子不会画错大小）',
  r.groups.every((g) => g.data[0] === g.style[0] && g.data[1] === g.style[1]),
  JSON.stringify(r.groups.map((g) => `${g.label}:${g.data.join('x')}/${g.style.join('x')}`)),
)
check(
  '所有成员都落在分组盒子里',
  r.groups.every((g) => g.outside.length === 0),
  JSON.stringify(r.groups.map((g) => `${g.label}: [${g.outside.join(',')}]`)),
)
check(
  '嵌套分组被父分组包住',
  (() => {
    const outer = byLabel.get('交易核心')
    const inner = byLabel.get('订单')
    return outer && inner && outer.data[0] > inner.data[0] && outer.data[1] > inner.data[1] && outer.members.includes('订单')
  })(),
  JSON.stringify(byLabel.get('交易核心')),
)
check(
  '分组垫在节点下面（点节点命中的是节点）',
  r.hit['网关'] === true && r.hit['下单'] === true && r.hit['锁定库存'] === true,
  JSON.stringify(r.hit),
)

/* ---------- 节点顺序：分组在前、其余从上到下 ---------- */
const plain = r.order.filter((o) => !o.group)
const sortedTopDown = plain.every((o, i) => i === 0 || plain[i - 1].y <= o.y)
const firstPlainIndex = r.order.findIndex((o) => !o.group)
const groupsAfterPlain = r.order.slice(firstPlainIndex).some((o) => o.group)
check('分组排在数组前面（渲染时垫底）', !groupsAfterPlain, r.order.map((o) => (o.group ? '[G]' : '') + o.label).join(' | '))
check('其余节点从上到下排列', sortedTopDown, plain.map((o) => `${o.label}@${o.y}`).join(' '))

/* ---------- 连线方向：组内横向、跨组纵向 ---------- */
const edgeOf = (a, b) => r.edges.find((e) => e.from === a && e.to === b)
check('组内也是从上到下：连线走下出上入', edgeOf('网关', '鉴权')?.sh === 'bottom' && edgeOf('网关', '鉴权')?.th === 'top', JSON.stringify(edgeOf('网关', '鉴权')))
check('跨分组的连线走下列出上入', edgeOf('鉴权', '下单')?.sh === 'bottom' && edgeOf('鉴权', '下单')?.th === 'top', JSON.stringify(edgeOf('鉴权', '下单')))

/* ---------- 自动布局后依然成立 ---------- */
await ev(`window.__ms.store.getState().runAutoLayout()`)
await sleep(1000)
await fit()
r = await ev(probe)
check(
  '重新自动布局后分组仍然包住成员',
  r.groups.every((g) => g.outside.length === 0 && g.data[0] === g.style[0] && g.data[1] === g.style[1]),
  JSON.stringify(r.groups.map((g) => `${g.label}:${g.outside.length}`)),
)
check('重新自动布局后分组仍在节点下面', r.hit['网关'] === true && r.hit['下单'] === true, JSON.stringify(r.hit))

/* ---------- 导出保持 subgraph 结构 ---------- */
const code = await ev(`window.__ms.store.getState().currentMermaid(false)`)
const subgraphs = (code.match(/^\s*subgraph\b/gm) || []).length
check('导出仍是 4 个 subgraph', subgraphs === 4, `subgraph=${subgraphs}`)
check('导出的嵌套关系正确（订单在交易核心里）', /subgraph core\["交易核心"\][\s\S]*subgraph order\["订单"\]/.test(code), code.split('\n').slice(0, 3).join(' | '))

/* ---------- 导入时按文本撑宽，长标题不被省略号截断 ---------- */
const fitted = await ev(`(async () => {
  window.__ms.store.getState().importMermaid('flowchart TB\\n  longlabel[校验下单参数并检查库存可用性以及限购规则]\\n  short[下单]\\n  longlabel --> short')
  await new Promise((r) => setTimeout(r, 1200))
  const st = window.__ms.store.getState()
  const long = st.doc.nodes.find((n) => n.data.label.startsWith('校验下单'))
  const short = st.doc.nodes.find((n) => n.data.label === '下单')
  const title = (n) => document.querySelector('.react-flow__node[data-id="' + n.id + '"] .ms-card__title')
  const overflow = (el) => (el ? el.scrollWidth - el.clientWidth : null)
  return {
    longWidth: long ? long.data.width : null,
    longStyleWidth: long && long.style ? long.style.width : null,
    longOverflow: long ? overflow(title(long)) : null,
    shortWidth: short ? short.data.width : null,
    shortOverflow: short ? overflow(title(short)) : null,
  }
})()`)
check('长标题把节点撑宽（不再是 200 固定宽）', fitted.longWidth > 200, JSON.stringify(fitted))
check('长标题没有被省略号截断', fitted.longOverflow !== null && fitted.longOverflow <= 1, JSON.stringify({ overflow: fitted.longOverflow }))
check('短标题保持默认宽度', fitted.shortWidth === 200 && (fitted.shortOverflow ?? 99) <= 0, JSON.stringify({ width: fitted.shortWidth, overflow: fitted.shortOverflow }))

const failed = out.filter(([, ok]) => !ok).length
console.log('\n--- 控制台错误 ---')
console.log(errors.length ? errors.join('\n') : '(无)')
console.log(`\n结果：${out.length - failed}/${out.length} 通过，控制台错误 ${errors.length}`)
ws.close()
process.exit(failed || errors.length ? 1 : 0)
