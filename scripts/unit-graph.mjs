import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deriveGraphModel, bfsHops, graphSignature } from '../src/lib/graphModel.ts'
import { layoutGraph } from '../src/lib/graphLayout.ts'

/* ---------- 夹具 ---------- */

const node = (id, data = {}) => ({
  id,
  type: 'block',
  position: { x: 0, y: 0 },
  data: {
    blockId: 'builtin.table',
    label: id,
    values: {},
    fill: '#fff',
    stroke: '#000',
    textColor: '#000',
    shape: 'rect',
    width: 160,
    height: 60,
    ...data,
  },
})

const edge = (id, source, target, data = {}) => ({
  id,
  source,
  target,
  type: 'ms',
  data: {
    curve: 'smoothstep',
    lineStyle: 'solid',
    startMarker: 'none',
    endMarker: 'arrow',
    stroke: '#000',
    strokeWidth: 2,
    ...data,
  },
})

const doc = (nodes, edges) => ({
  id: 'd1',
  name: '测试图',
  createdAt: 0,
  updatedAt: 0,
  direction: 'TB',
  nodes,
  edges,
})

/* ---------- 红绿切片 ---------- */

test('只有可见的实体节点进图', () => {
  const model = deriveGraphModel(
    doc(
      [
        node('t_a'),
        node('t_b'),
        node('g_1', { isSubgraph: true }),
        { ...node('t_hidden'), hidden: true },
        { ...node('t_hidden2'), hidden: true },
        node('x_note', { shape: 'text' }),
        node('x_note2', { shape: 'text' }),
      ],
      [
        edge('e1', 't_a', 't_b'),
        edge('e2', 't_b', 'x_note2'),
        edge('e3', 't_a', 't_hidden'),
      ],
    ),
  )

  assert.deepEqual(
    model.nodes.map((n) => n.id).sort(),
    ['t_a', 't_b', 'x_note2'],
  )
  assert.deepEqual(
    model.edges.map((e) => e.id).sort(),
    ['e1', 'e2'],
  )
})

test('节点带表名与原始字段文本', () => {
  const model = deriveGraphModel(
    doc(
      [
        node('t_orders', {
          label: 'orders',
          values: { columns: 'id: bigint\nuser_id: bigint\n\namount: decimal' },
        }),
        node('p_pay', { label: '', values: {} }),
      ],
      [],
    ),
  )
  const byId = new Map(model.nodes.map((n) => [n.id, n]))

  assert.equal(byId.get('t_orders').label, 'orders')
  assert.equal(byId.get('t_orders').columns, 'id: bigint\nuser_id: bigint\n\namount: decimal')
  assert.equal(byId.get('p_pay').label, 'p_pay')
  assert.equal(byId.get('p_pay').columns, '')
})

test('邻接是无向的，跳数按最短路径算', () => {
  const model = deriveGraphModel(
    doc(
      [node('t_a'), node('t_b'), node('t_c'), node('t_d')],
      [
        edge('e1', 't_a', 't_b'),
        edge('e2', 't_b', 't_c'),
        edge('e3', 't_c', 't_d'),
        edge('e4', 't_a', 't_c'),
      ],
    ),
  )

  assert.deepEqual([...model.neighbors.get('t_a')].sort(), ['t_b', 't_c'])
  assert.deepEqual([...model.neighbors.get('t_c')].sort(), ['t_a', 't_b', 't_d'])

  const hops = bfsHops(model, 't_a')
  assert.equal(hops.get('t_a'), 0)
  assert.equal(hops.get('t_b'), 1)
  assert.equal(hops.get('t_c'), 1)
  assert.equal(hops.get('t_d'), 2)
  assert.equal(bfsHops(model, '不存在').size, 0)
})

test('连线带着原有的图语言：虚线待确认、标签不合规要标出来', () => {
  const model = deriveGraphModel(
    doc(
      [node('t_a'), node('t_b'), node('t_c')],
      [
        edge('e1', 't_a', 't_b', { lineStyle: 'dashed', label: '关联: order_id' }),
        edge('e2', 't_b', 't_c', { label: '' }),
        edge('e3', 't_c', 't_a', { label: '随便写的一句话' }),
        edge('e4', 't_a', 't_c', { label: '关联', endMarker: 'none' }),
      ],
    ),
  )
  const byId = new Map(model.edges.map((e) => [e.id, e]))

  assert.equal(byId.get('e1').dashed, true)
  assert.equal(byId.get('e1').warn, false)
  assert.equal(byId.get('e1').label, '关联: order_id')
  assert.equal(byId.get('e1').arrow, true)
  assert.equal(byId.get('e4').arrow, false)
  assert.equal(byId.get('e2').dashed, false)
  assert.equal(byId.get('e2').warn, true)
  assert.equal(byId.get('e3').warn, true)
  assert.equal(byId.get('e3').label, '随便写的一句话')
})

test('同组同色：同组共用调色索引，不属于分组的是 -1', () => {
  const model = deriveGraphModel(
    doc(
      [
        node('t_a', { groupId: 'g_1' }),
        node('t_b', { groupId: 'g_1' }),
        node('t_c', { groupId: 'g_2' }),
        node('t_d'),
      ],
      [edge('e1', 't_a', 't_b')],
    ),
  )
  const byId = new Map(model.nodes.map((n) => [n.id, n]))

  assert.equal(byId.get('t_a').groupIndex, byId.get('t_b').groupIndex)
  assert.notEqual(byId.get('t_a').groupIndex, byId.get('t_c').groupIndex)
  assert.equal(byId.get('t_d').groupIndex, -1)
})

/* 一条 a—b—c—d 链 + a—c 跨环连线：a 是 0 跳，b/c 是 1 跳，d 是 2 跳 */
const chainModel = () =>
  deriveGraphModel(
    doc(
      [node('t_a'), node('t_b'), node('t_c'), node('t_d')],
      [
        edge('e1', 't_a', 't_b'),
        edge('e2', 't_b', 't_c'),
        edge('e3', 't_c', 't_d'),
        edge('e4', 't_a', 't_c'),
      ],
    ),
  )

const radiusOf = (pos) => Math.hypot(pos.x, pos.y)

test('根钉在原点，同一份模型每次排出来一模一样', () => {
  const model = chainModel()
  const first = layoutGraph(model)
  const second = layoutGraph(model)

  // a—b—c—d 里 c 连了三条（a、b、d），度数最高，钉在原点
  assert.deepEqual(first.get('t_c'), { x: 0, y: 0 })
  assert.deepEqual([...first.entries()], [...second.entries()])
  assert.equal(first.size, 4)
})

test('跳数决定离根多远：1 跳比 2 跳更近', () => {
  const model = chainModel()
  const pos = layoutGraph(model)

  // 根是 b：c 是 1 跳，d/a 是 1 跳——用另一条链验证 2 跳确实更远
  const chain = deriveGraphModel(
    doc(
      [node('t_1'), node('t_2'), node('t_3'), node('t_4')],
      [edge('c1', 't_1', 't_2'), edge('c2', 't_2', 't_3'), edge('c3', 't_3', 't_4')],
    ),
  )
  const laid = layoutGraph(chain)
  const near = radiusOf(laid.get('t_2'))
  const far = radiusOf(laid.get('t_4'))
  assert.ok(far > near, `3 跳的 t_4 应当比 1 跳的 t_2 更远：far=${far.toFixed(1)} near=${near.toFixed(1)}`)
  assert.ok(radiusOf(pos.get('t_c')) === 0)
})

test('展开的大卡片占更大的位置，不会和邻居挤在一起', () => {
  const model = deriveGraphModel(doc([node('t_a'), node('t_b')], [edge('e1', 't_a', 't_b')]))
  const gap = (m) => Math.hypot(m.get('t_a').x - m.get('t_b').x, m.get('t_a').y - m.get('t_b').y)

  const small = gap(layoutGraph(model))
  const big = gap(layoutGraph(model, { radiusOf: () => 200 }))
  assert.ok(big > small + 50, `大占位应当拉得更开：small=${small.toFixed(1)} big=${big.toFixed(1)}`)
  assert.ok(big >= 380, `两个半径 200 的卡片至少要隔 380：实际 ${big.toFixed(1)}`)
})

test('结构签名只反映谁连着谁', () => {
  const model = chainModel()

  const relabeled = deriveGraphModel(
    doc(
      [
        node('t_a', { label: '改名了' }),
        node('t_b', { label: '也改了' }),
        node('t_c'),
        node('t_d'),
      ],
      [
        edge('e1', 't_a', 't_b'),
        edge('e2', 't_b', 't_c'),
        edge('e3', 't_c', 't_d'),
        edge('e4', 't_a', 't_c'),
      ],
    ),
  )
  assert.equal(graphSignature(model), graphSignature(relabeled))

  const extraEdge = deriveGraphModel(
    doc(
      [node('t_a'), node('t_b'), node('t_c'), node('t_d')],
      [
        edge('e1', 't_a', 't_b'),
        edge('e2', 't_b', 't_c'),
        edge('e3', 't_c', 't_d'),
        edge('e4', 't_a', 't_c'),
        edge('e5', 't_b', 't_d'),
      ],
    ),
  )
  assert.notEqual(graphSignature(model), graphSignature(extraEdge))
})
