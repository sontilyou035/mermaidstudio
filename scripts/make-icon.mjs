#!/usr/bin/env node
/**
 * 把 public/logo.svg 光栅化成一张 180×180 的 PNG（apple-touch-icon）。
 * 用法：node scripts/make-icon.mjs   （需要带 --remote-debugging-port=9333 的 Chrome）
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SIZE = Number(process.argv[2] || 180)
const svg = readFileSync(resolve(ROOT, 'public/logo.svg'), 'utf8')

const list = await (await fetch('http://127.0.0.1:9333/json/list')).json()
const page = list.find((t) => t.type === 'page')
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((r) => (ws.onopen = r))
let id = 0
const pending = new Map()
ws.onmessage = (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
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
await send('Page.navigate', { url: 'about:blank' })
await new Promise((r) => setTimeout(r, 800))

const dataUrl = await ev(`(async () => {
  const svgText = ${JSON.stringify(svg)}
  const img = new Image()
  img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgText)))
  await img.decode()
  const c = document.createElement('canvas')
  c.width = ${SIZE}
  c.height = ${SIZE}
  const ctx = c.getContext('2d')
  ctx.drawImage(img, 0, 0, ${SIZE}, ${SIZE})
  // 顺便统计不透明像素比例，确认画上东西了
  const data = ctx.getImageData(0, 0, ${SIZE}, ${SIZE}).data
  let opaque = 0
  for (let i = 3; i < data.length; i += 4) if (data[i] > 8) opaque++
  return { png: c.toDataURL('image/png'), coverage: +(opaque / (${SIZE} * ${SIZE})).toFixed(3) }
})()`)

const b64 = dataUrl.png.split(',')[1]
writeFileSync(resolve(ROOT, 'public/apple-touch-icon.png'), Buffer.from(b64, 'base64'))
console.log(`✓ public/apple-touch-icon.png（${SIZE}×${SIZE}，不透明覆盖 ${(dataUrl.coverage * 100).toFixed(1)}%）`)
ws.close()
