import { composeLabel, labelLines, tableRows } from '../blocks/registry'
import type { BlockDef, NodeData } from '../types'

/**
 * 按文本量节点宽度用的字体栈（和 styles.css 里的一致）。
 * 浏览器里用 canvas 实测；没有 DOM（单测 / 导出脚本）时退化成字符宽度估算。
 */
const FONT_STACK =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif"
const MONO_STACK = 'ui-monospace, SFMono-Regular, Menlo, monospace'

/** 节点最宽不无限膨胀：超过这个宽度就保持不动（超长文本仍会被省略号截断） */
export const MAX_FIT_WIDTH = 560

let cachedCtx: CanvasRenderingContext2D | null | undefined

function context(): CanvasRenderingContext2D | null {
  if (cachedCtx !== undefined) return cachedCtx
  if (typeof document === 'undefined') {
    cachedCtx = null
    return cachedCtx
  }
  try {
    cachedCtx = document.createElement('canvas').getContext('2d')
  } catch {
    cachedCtx = null
  }
  return cachedCtx
}

/** 全角字符（中日韩、全角标点）按 1em 算，其余按西文宽度表估 */
function estimateWidth(text: string, fontSize: number, weight: number): number {
  const WIDE = /[\u1100-\u11FF\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6\u3000-\u303F]/
  let em = 0
  for (const ch of text) {
    if (WIDE.test(ch)) em += 1
    else if (ch === ' ') em += 0.28
    else if ('ilj.,:;!|\'`'.includes(ch)) em += 0.3
    else if ('MW@'.includes(ch)) em += 0.9
    else if ('mw'.includes(ch)) em += 0.82
    else if (/[A-Z]/.test(ch)) em += 0.66
    else if (/[0-9]/.test(ch)) em += 0.56
    else em += 0.55
  }
  return em * fontSize * (weight >= 600 ? 1.03 : 1)
}

/** 量一段文本的像素宽度（去掉富文本标签，标签不占位） */
export function measureTextWidth(text: string, fontSize: number, weight = 400, mono = false): number {
  const clean = String(text ?? '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
  if (!clean) return 0
  const ctx = context()
  if (!ctx) return estimateWidth(clean, fontSize, weight)
  ctx.font = `${weight} ${fontSize}px ${mono ? MONO_STACK : FONT_STACK}`
  return ctx.measureText(clean).width
}

/* 各排版下的内边距（和 styles.css 对齐，另外留几像素余量避免贴边） */
const CARD_PAD_X = 12 * 2 + 2 + 8 // .ms-card padding 12 + border 1 + 余量
const TABLE_PAD_X = 10 * 2 + 2 + 8 // .ms-table__row padding 10 + border 2 + 余量
const JSON_PAD_X = 10 * 2 + 2 + 8

/**
 * 算出「刚好不把文字截掉」的节点宽度。
 * 只加宽、不收窄，并且有上限（MAX_FIT_WIDTH）。
 */
export function fitNodeWidth(block: BlockDef, data: NodeData, maxWidth = MAX_FIT_WIDTH): number {
  const base = Math.max(60, Math.round(data.width || block.width || 200))
  const lines = labelLines(composeLabel(data, block))
  let needed = base

  if (block.layout === 'table') {
    const head = lines[0] ?? data.label ?? ''
    needed = Math.max(needed, measureTextWidth(head, 12.5, 700) + 18 /* 图标 */ + 6 + TABLE_PAD_X)
    for (const row of tableRows(data.values?.columns)) {
      needed = Math.max(needed, measureTextWidth(row, 11.5, 400) + TABLE_PAD_X)
    }
  } else if (block.layout === 'json') {
    const head = lines[0] ?? data.label ?? ''
    const key = String(data.values?.key ?? '').trim()
    needed = Math.max(needed, measureTextWidth(head, 12.5, 700) + (key ? measureTextWidth(key, 11, 400, true) + 12 : 0) + 40)
    for (const line of String(data.values?.json ?? '').split('\n')) {
      needed = Math.max(needed, measureTextWidth(line, 11, 400, true) + JSON_PAD_X)
    }
  } else {
    // 卡片 / 纯文本：第一行是标题，2–3 行是说明
    const title = lines[0] ?? data.label ?? ''
    needed = Math.max(needed, measureTextWidth(title, 13, 600) + CARD_PAD_X)
    for (const desc of lines.slice(1, 3)) {
      needed = Math.max(needed, measureTextWidth(desc, 10, 400) + CARD_PAD_X)
    }
  }

  return Math.min(Math.round(needed), Math.max(base, maxWidth))
}
