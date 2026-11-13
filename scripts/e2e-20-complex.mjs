const APP = process.env.MS_BASE || 'http://127.0.0.1:5273'

// 第二十轮：真实复杂图（多分组 + 平行边 + & 并列 + 引号标签）导入
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

const CODE = "flowchart LR\n    classDef dto fill:#fefce8,stroke:#ca8a04,color:#422006\n    classDef chain fill:#f0fdf4,stroke:#16a34a,color:#14532d\n    classDef tbl fill:#eef2ff,stroke:#4f46e5,color:#312e81\n    classDef ext fill:#fff7ed,stroke:#ea580c,color:#7c2d12\n\n    subgraph DTO[OrderCombineRpcDto 小程序结算页报文]\n        direction TB\n        D1[\"orderDataRpcDto<br/>orderType=10 · userId=211 · lat/lng\"]:::dto\n        D2[\"orderDeliveryRpcDto<br/>收货人/省市区/地址/title/cityCode\"]:::dto\n        D3[\"orderMoneyRpcDto 总金额<br/>price=108 · couponDiscount=10<br/>payPrice=149 · wechatPayAmount=149<br/>thirdPayWay=1 · deliveryFee=51\"]:::dto\n        D4[\"skus 商品行(每包裹)<br/>skuId · name · price · amount<br/>weight · saleUnit · buyUnit · skuType\"]:::dto\n        D5[\"coupons 券(每包裹)<br/>couponUserId=11627/11671<br/>couponCode · value=5 · type=100\"]:::dto\n        D6[\"orderDeliveryTime(每包裹)<br/>shipDate · 17:30-18:00 / 次日08:30<br/>deliveryType=1\"]:::dto\n        D7[\"isCycleDeliveryOrder=1(包裹2)\"]:::dto\n        D8[\"locationId/storeId=99901 · saasCode=yas<br/>requestTime · source · platform\"]:::dto\n        D9[\"orderInvoiceRpcDto 发票\"]:::dto\n    end\n\n    subgraph CHAIN[调用链 OrderSubmitCombineFacade]\n        direction TB\n        C0[\"buildMultiSubmitOrderBo<br/>拆2子单 · createMerchantOrderId 父单号\"]:::chain\n        C1[\"buildOrderRpcDto 每包裹复制头信息<br/>judgeCycleDeliveryOrder→adjustmentOrderType\"]:::chain\n        C2[\"buildOrderMoneyRpcDto 支付分摊<br/>包裹1:三方89.5 包裹2:三方59.5<br/>wechatPayAmount 按单扣减\"]:::chain\n        C3[\"buildOrderDeliveryRpcDto 合并配送时间\"]:::chain\n        C4[\"submitChildOrder<br/>CompletableFuture 并行×2 预提交\"]:::chain\n        C5[\"OrderCombineInsertOrderService<br/>逐子单 FlowEngine SubmitOrder 9步\"]:::chain\n        C6[\"OrderInsertOrderHandler → step⑦\"]:::chain\n        C7[\"OrderCreateFacade.insertOrderDto<br/>@Transactional\"]:::chain\n        C0 --> C1 --> C2 --> C3 --> C4 --> C5 --> C6 --> C7\n    end\n\n    subgraph TBL[jy_order 库表]\n        direction TB\n        T1[\"order_data 订单头\"]:::tbl\n        T2[\"order_delivery 配送信息\"]:::tbl\n        T3[\"order_money 订单金额\"]:::tbl\n        T4[\"order_money_payment 支付单\"]:::tbl\n        T5[\"order_item 商品行\"]:::tbl\n        T6[\"sku_snapshot SKU快照\"]:::tbl\n        T7[\"order_item_additional 附加费\"]:::tbl\n        T8[\"order_coupon 订单券\"]:::tbl\n        T9[\"order_item_money 商品分摊金额\"]:::tbl\n        T10[\"order_invoice 发票\"]:::tbl\n        X1[\"jy_market.coupon_user<br/>券核销(跨库RPC)\"]:::ext\n    end\n\n    D1 & D8 --> C1 --> T1\n    D7 --> C1 -->|\"order_type→周期购\"| T1\n    D2 --> C5 -->|\"OrderSetDeliveryHandler\"| T2\n    D6 --> C3 --> T2\n    D3 --> C2 --> T3\n    D3 -->|\"wechatPayAmount/thirdPayWay<br/>OrderPrePayHandler\"| T4\n    D4 -->|\"OrderSetOrderItemHandler\"| T5\n    D4 -->|\"OrderItemSkuSnapshotHandler 62列镜像\"| T6\n    D3 -->|\"deliveryFee→feeList(Freight)<br/>OrderAdditionalItemHandler: 包裹1=22.5 包裹2=28.5\"| T7\n    D5 -->|\"OrderUseCouponHandler\"| T8\n    D5 -.->|\"useCoupon RPC 核销\"| X1\n    D4 -->|\"PromtCatCalculate 按行分摊\"| T9\n    D9 -->|\"OrderSaveInvoiceHandler\"| T10\n"

await send('Runtime.enable')
await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1560, height: 940, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: APP + '/' })
await sleep(3000)
await ev(`(() => { Object.keys(localStorage).filter(k=>k.startsWith('mermaid-studio:')).forEach(k=>localStorage.removeItem(k)); return 1 })()`)
await send('Page.navigate', { url: APP + '/' })
await sleep(3200)

await ev('window.__ms_e2e_code = ' + JSON.stringify(CODE))
const imported = await ev(`(() => {
  const st = window.__ms.store.getState()
  const res = st.importMermaid(window.__ms_e2e_code)
  const after = window.__ms.store.getState()
  return { res, toasts: after.toasts.map((t) => t.message) }
})()`)
check('导入成功（不再抛 dagre 交点异常）', imported.res.ok === true, JSON.stringify(imported.res))
check('提示里没有「行被忽略」', !imported.toasts.some((t) => t.includes('被忽略')), JSON.stringify(imported.toasts))
check('提示里没有「排版已降级」', !imported.toasts.some((t) => t.includes('降级')), JSON.stringify(imported.toasts))
await sleep(1500)
await ev(`document.querySelector('.react-flow__controls-fitview')?.click()`)
await sleep(900)

const probe = `(() => {
  const st = window.__ms.store.getState()
  const nodes = st.doc.nodes
  const label = (nid) => nodes.find((n) => n.id === nid)?.data.label ?? '?'
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
      members: kids.length,
      outside: outside.length,
      styleOk: !g.style || (g.style.width === g.data.width && g.style.height === g.data.height),
    }
  })
  const hit = (n) => {
    const r = dom(n)
    if (!r) return null
    const hits = document.elementsFromPoint(r.left + r.width / 2, r.top + r.height / 2)
    const nodeEl = hits.find((h) => h.classList && h.classList.contains('react-flow__node'))
    return nodeEl ? nodeEl.getAttribute('data-id') === n.id : null
  }
  const firstOrder = nodes.find((n) => n.data.label.startsWith('order_data'))
  const widened = nodes.filter((n) => (n.data.width ?? 0) > 200).length
  const edgeTexts = [...document.querySelectorAll('.ms-edge-label')].map((el) => el.textContent ?? '')
  return {
    nodes: nodes.length,
    edges: st.doc.edges.length,
    groups,
    firstOrderHit: firstOrder ? hit(firstOrder) : null,
    widened,
    quotedLabels: edgeTexts.filter((t) => t.includes('"')).length,
    sampleLabel: edgeTexts.find((t) => t.includes('OrderSetOrderItemHandler')) ?? null,
    hasD1C1: st.doc.edges.some((e) => label(e.source).startsWith('orderDataRpcDto') && label(e.target).startsWith('buildOrderRpcDto')),
  }
})()`

const r = await ev(probe)
check('31 个节点 / 26 条连线', r.nodes === 31 && r.edges === 26, `${r.nodes} 节点 / ${r.edges} 连线`)
check('3 个分组都建出来了', r.groups.length === 3, JSON.stringify(r.groups.map((g) => g.label)))
check('分组把成员都包住（9 / 8 / 11）', r.groups.every((g) => g.outside === 0) && r.groups.reduce((a, g) => a + g.members, 0) === 28, JSON.stringify(r.groups.map((g) => `${g.label}:${g.members}${g.outside ? `/外${g.outside}` : ''}`)))
check('分组盒子的 style 与 data 一致', r.groups.every((g) => g.styleOk), JSON.stringify(r.groups.map((g) => g.styleOk)))
check('点节点命中的是节点（分组不挡）', r.firstOrderHit === true, String(r.firstOrderHit))
check('& 并列的边补回来了（D1/D8 → C1）', r.hasD1C1 === true, String(r.hasD1C1))
check('长标签节点被撑宽', r.widened > 0, `宽于 200 的节点 ${r.widened} 个`)
check('边标签不再带引号', r.quotedLabels === 0, JSON.stringify(r.sampleLabel))

const round = await ev(`(() => {
  const st = window.__ms.store.getState()
  const code = st.currentMermaid(false)
  const res = window.__ms.store.getState().importMermaid(code)
  const after = window.__ms.store.getState()
  return { ok: res.ok, message: res.message, nodes: after.doc.nodes.length, edges: after.doc.edges.length, groups: after.doc.nodes.filter((n) => n.data.isSubgraph).length }
})()`)
check('导出的 Mermaid 能再次导入（往返稳定）', round.ok === true && round.nodes === 31 && round.edges === 26 && round.groups === 3, JSON.stringify(round))

const failed = out.filter(([, ok]) => !ok).length
console.log('\n--- 控制台错误 ---')
console.log(errors.length ? errors.join('\n') : '(无)')
console.log(`\n结果：${out.length - failed}/${out.length} 通过，控制台错误 ${errors.length}`)
ws.close()
process.exit(failed || errors.length ? 1 : 0)
