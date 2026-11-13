/**
 * 渲染层：把 Mermaid 文本渲染成 SVG。
 *
 * 默认引擎是 **pele**（Obsidian 团队做的零依赖渲染器，同步、快、体积小）；
 * mermaid.js 作为兜底：pele 抛错时自动回退，保证图永远能出来。
 * 想强制用官方 mermaid.js 可以在设置里切换。
 */
export type RenderEngine = 'pele' | 'mermaid'

export interface RenderInput {
  code: string
  dark: boolean
  engine?: RenderEngine
  /** 界面皮肤，决定预览/导出用的主题色 */
  skin?: Skin
  fontFamily?: string
  /** 导出时把主题变量内联进 SVG，保证脱离页面也能正确显示 */
  inlineTheme?: boolean
}

export interface RenderOutcome {
  svg: string
  /** 实际用的引擎 */
  engine: RenderEngine
  /** pele 失败时的错误信息（此时 engine 会是 mermaid） */
  fallbackReason?: string
  /** 渲染耗时（ms） */
  ms: number
}

export type Skin = 'warm' | 'cool'

/** pele 的主题变量：皮肤 × 明暗 四套（导出时内联，保证脱离页面也正确） */
const PELE_THEME: Record<Skin, Record<'light' | 'dark', Record<string, string>>> = {
  cool: {
    light: {
      '--pele-bg': '#eef1f6',
      '--pele-fg': '#1e293b',
      '--pele-muted': '#64748b',
      '--pele-line': '#475569',
      '--pele-surface': '#f8fafc',
      '--pele-surface-alt': '#eef2f7',
      '--pele-border': '#b9c4d4',
      '--pele-accent': '#2563eb',
      '--pele-radius': '6px',
    },
    dark: {
      '--pele-bg': '#0b1120',
      '--pele-fg': '#e5e9f0',
      '--pele-muted': '#94a3b8',
      '--pele-line': '#94a3b8',
      '--pele-surface': '#172033',
      '--pele-surface-alt': '#1e293b',
      '--pele-border': '#3b4a63',
      '--pele-accent': '#60a5fa',
      '--pele-radius': '6px',
    },
  },
  warm: {
    light: {
      '--pele-bg': '#fcfbf9',
      '--pele-fg': '#33332f',
      '--pele-muted': '#72726a',
      '--pele-line': '#706b60',
      '--pele-surface': '#fefefd',
      '--pele-surface-alt': '#f3f1ec',
      '--pele-border': '#deded5',
      '--pele-accent': '#bd481b',
      '--pele-radius': '8px',
    },
    dark: {
      '--pele-bg': '#211f1c',
      '--pele-fg': '#eeeae2',
      '--pele-muted': '#bdb6aa',
      '--pele-line': '#a9a294',
      '--pele-surface': '#2b2925',
      '--pele-surface-alt': '#36332e',
      '--pele-border': '#504b43',
      '--pele-accent': '#ed986e',
      '--pele-radius': '8px',
    },
  },
}

const FONT_VARS: Record<string, string> = {
  '--pele-font': 'inherit',
  '--pele-font-mono': 'ui-monospace, SFMono-Regular, Menlo, monospace',
}

function themeStyle(dark: boolean, skin: Skin = 'warm'): string {
  const vars = { ...PELE_THEME[skin][dark ? 'dark' : 'light'], ...FONT_VARS }
  const body = Object.entries(vars)
    .map(([k, v]) => `${k}:${v}`)
    .join(';')
  return `<style>.pele{${body}}</style>`
}

/**
 * 把主题变量**放进 <svg> 内部**（作为第一个子节点）：
 * 这样单独把 svg 存成文件发给别人，样式也跟着走。
 */
function inlineTheme(svg: string, dark: boolean, skin: Skin): string {
  const style = themeStyle(dark, skin)
  if (!svg.startsWith('<svg')) return style + svg
  const end = svg.indexOf('>')
  if (end < 0) return style + svg
  return svg.slice(0, end + 1) + style + svg.slice(end + 1)
}

let peleLoaded: typeof import('pele') | null = null

async function loadPele() {
  if (!peleLoaded) peleLoaded = await import('pele')
  return peleLoaded
}

let mermaidReady: Promise<typeof import('mermaid').default> | null = null

async function loadMermaid(dark: boolean) {
  if (!mermaidReady) {
    mermaidReady = import('mermaid').then((m) => {
      m.default.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        fontFamily: 'inherit',
        theme: 'default',
      })
      return m.default
    })
  }
  const mermaid = await mermaidReady
  // 主题变了要重新 initialize（mermaid 没有"改主题不重渲"的能力）
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    fontFamily: 'inherit',
    theme: dark ? 'dark' : 'default',
  })
  return mermaid
}

async function renderWithPele(input: RenderInput): Promise<string> {
  const pele = await loadPele()
  const { svg } = pele.render(input.code, {
    fontFamily: input.fontFamily ?? 'inherit',
    responsive: false,
  })
  if (!svg) throw new Error('pele 返回了空的 SVG')
  return input.inlineTheme === false ? svg : inlineTheme(svg, input.dark, input.skin ?? 'warm')
}

async function renderWithMermaid(input: RenderInput): Promise<string> {
  const mermaid = await loadMermaid(input.dark)
  const id = `ms-${Math.random().toString(36).slice(2)}`
  const { svg } = await mermaid.render(id, input.code)
  return svg
}

/** 渲染 Mermaid 文本为 SVG；pele 失败时自动回退到 mermaid.js */
export async function renderDiagram(input: RenderInput): Promise<RenderOutcome> {
  const started = performance.now()
  const engine: RenderEngine = input.engine ?? 'pele'

  if (engine === 'mermaid') {
    const svg = await renderWithMermaid(input)
    return { svg, engine: 'mermaid', ms: Math.round(performance.now() - started) }
  }

  try {
    const svg = await renderWithPele(input)
    return { svg, engine: 'pele', ms: Math.round(performance.now() - started) }
  } catch (err) {
    const svg = await renderWithMermaid(input)
    return {
      svg,
      engine: 'mermaid',
      fallbackReason: (err as Error).message,
      ms: Math.round(performance.now() - started),
    }
  }
}

/** 导出用：拿到一张自带主题的 SVG 字符串 */
export async function renderDiagramForExport(
  code: string,
  dark: boolean,
  engine: RenderEngine = 'pele',
  skin: Skin = 'warm',
): Promise<string> {
  const out = await renderDiagram({ code, dark, engine, skin, inlineTheme: true })
  return out.svg
}
