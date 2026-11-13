// 方案 A 皮肤验收：暖色（默认）/ 冷色切换，外壳 + 预览 + 导出
const APP = process.env.MS_BASE || process.argv[2] || 'http://127.0.0.1:5273'
const list = await (await fetch('http://127.0.0.1:9333/json/list')).json()
const page = list.find((t) => t.type === 'page')
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((r) => (ws.onopen = r))
let id = 0; const pending = new Map(); const errors = []
ws.onmessage = (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return }
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text)
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map((a) => a.value ?? a.description).join(' '))
}
const send = (method, params = {}) => { const i = ++id; ws.send(JSON.stringify({ id: i, method, params })); return new Promise((r) => pending.set(i, r)) }
const ev = async (x) => { const r = await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description); return r.result?.result?.value }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const out = []
const check = (n, ok, d = '') => { out.push([n, ok]); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ` — ${d}` : ''}`) }

await send('Runtime.enable'); await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1560, height: 940, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: `${APP}/` }); await sleep(5000)
await ev(`(() => { Object.keys(localStorage).filter(k=>k.startsWith('mermaid-studio:')).forEach(k=>localStorage.removeItem(k)); return 1 })()`)
await send('Page.navigate', { url: `${APP}/` }); await sleep(5500)

const initial = await ev(`(() => {
  const cs = getComputedStyle(document.documentElement)
  return {
    skin: window.__ms.store.getState().settings.skin,
    attr: document.documentElement.dataset.skin,
    theme: document.documentElement.dataset.theme,
    bg: cs.getPropertyValue('--bg').trim(),
    accent: cs.getPropertyValue('--accent').trim(),
    bodyBg: getComputedStyle(document.body).backgroundColor,
    btn: document.querySelector('.ms-topbar .ms-btn')?.textContent?.trim(),
    warmBtn: [...document.querySelectorAll('.ms-topbar button')].map(b => b.textContent.trim()).find(t => t.includes('🎨')),
  }
})()`)
check('默认皮肤是暖色（warm）', initial.skin === 'warm' && initial.attr === 'warm', JSON.stringify(initial))
check('暖色变量生效：底色 #fcfbf9 / 主色 #bd481b', initial.bg === '#fcfbf9' && initial.accent === '#bd481b', JSON.stringify({ bg: initial.bg, accent: initial.accent }))
check('页面背景真的变暖（不是冷灰蓝）', initial.bodyBg === 'rgb(252, 251, 249)', initial.bodyBg)
check('顶栏有皮肤切换按钮', (initial.warmBtn || '').includes('暖'), initial.warmBtn)

// 暖色下检查关键外壳元素
const chrome = await ev(`(() => {
  const pick = (sel) => { const el = document.querySelector(sel); return el ? getComputedStyle(el) : null }
  const topbar = pick('.ms-topbar')
  const palette = pick('.ms-palette')
  const accentBtn = pick('.ms-btn--primary')
  const grid = document.querySelector('.react-flow__background pattern circle')
  return {
    topbarBg: topbar?.backgroundColor, topbarBorder: topbar?.borderBottomColor,
    paletteBg: palette?.backgroundColor,
    primaryBg: accentBtn?.backgroundColor,
    gridDot: grid?.getAttribute('fill') ?? grid?.style?.fill ?? null,
    canvasVar: getComputedStyle(document.querySelector('.ms-canvas')).backgroundColor,
  }
})()`)
check('面板/顶栏用暖色表面', chrome.topbarBg === 'rgb(247, 245, 240)' && chrome.paletteBg === 'rgb(247, 245, 240)', JSON.stringify({ topbar: chrome.topbarBg, palette: chrome.paletteBg }))
check('主按钮是陶土橙', chrome.primaryBg === 'rgb(189, 72, 27)', chrome.primaryBg)
check('画布底色变暖', chrome.canvasVar === 'rgb(252, 251, 249)', chrome.canvasVar)

// 预览/导出跟随皮肤
const preview = await ev(`(async () => {
  window.__ms.store.getState().setRightTab('preview')
  for (let i = 0; i < 200; i++) { await new Promise(r => setTimeout(r, 30)); if (document.querySelector('.ms-preview svg')) break }
  const svg = document.querySelector('.ms-preview svg')
  const style = svg?.querySelector('style')?.textContent ?? ''
  return { hasSvg: !!svg, pele: svg?.classList.contains('pele'), warmInSvg: style.includes('#fcfbf9') && style.includes('#bd481b'), styleLen: style.length }
})()`)
check('预览 SVG 内联了暖色主题变量', preview.hasSvg && preview.pele && preview.warmInSvg, JSON.stringify(preview))

// 切到冷色
const cool = await ev(`(async () => {
  const btn = [...document.querySelectorAll('.ms-topbar button')].find(b => b.textContent.includes('🎨'))
  btn.click()
  await new Promise(r => setTimeout(r, 600))
  const cs = getComputedStyle(document.documentElement)
  return {
    skin: window.__ms.store.getState().settings.skin,
    attr: document.documentElement.dataset.skin,
    bg: cs.getPropertyValue('--bg').trim(),
    accent: cs.getPropertyValue('--accent').trim(),
    bodyBg: getComputedStyle(document.body).backgroundColor,
    btnText: btn.textContent.trim(),
  }
})()`)
check('一键切回冷色皮肤', cool.skin === 'cool' && cool.bg === '#eef1f6' && cool.accent === '#2563eb', JSON.stringify(cool))
check('冷色下页面背景恢复', cool.bodyBg === 'rgb(238, 241, 246)', cool.bodyBg)
check('按钮文案跟着变', cool.btnText.includes('冷'), cool.btnText)

// 预览跟着切换
const previewCool = await ev(`(async () => {
  for (let i = 0; i < 200; i++) { await new Promise(r => setTimeout(r, 30)); const s = document.querySelector('.ms-preview svg style')?.textContent ?? ''; if (s.includes('#eef1f6')) return { cool: true, styleLen: s.length }; }
  return { cool: false, style: document.querySelector('.ms-preview svg style')?.textContent?.slice(0, 120) }
})()`)
check('切冷色后预览主题同步', previewCool.cool === true, JSON.stringify(previewCool))

// 持久化 + 深色暖色
const persist = await ev(`(async () => {
  window.__ms.store.getState().updateSettings({ skin: 'warm' })
  await new Promise(r => setTimeout(r, 400))
  return JSON.parse(localStorage.getItem('mermaid-studio:settings') || '{}').skin
})()`)
check('皮肤选择被持久化', persist === 'warm', String(persist))

const darkWarm = await ev(`(async () => {
  window.__ms.store.getState().setTheme('dark')
  await new Promise(r => setTimeout(r, 400))
  const cs = getComputedStyle(document.documentElement)
  const r = { attr: document.documentElement.dataset.theme, bg: cs.getPropertyValue('--bg').trim(), accent: cs.getPropertyValue('--accent').trim(), bodyBg: getComputedStyle(document.body).backgroundColor }
  window.__ms.store.getState().setTheme('light')
  return r
})()`)
check('暖色 + 深色组合正确（#211f1c / #ed986e）', darkWarm.attr === 'dark' && darkWarm.bg === '#211f1c' && darkWarm.accent === '#ed986e', JSON.stringify(darkWarm))

console.log('\n控制台错误:', errors.length ? errors.join('\n') : '(无)')
const failed = out.filter(([, ok]) => !ok).length
console.log(`皮肤验收：${out.length - failed}/${out.length} 通过`)
ws.close()
process.exit(failed || errors.length ? 1 : 0)
