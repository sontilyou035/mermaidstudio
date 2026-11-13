import type { ReactNode } from 'react'

/* 节点内的轻量富文本：支持 Mermaid 标签里常见的
 *   <font color='red'>…</font>、<b>、<i>、<u>、<s>
 * 只做行内颜色/字重，不引入 HTML 解析库；未知标签保留为普通文字。 */

interface RichStyle {
  color?: string
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strike?: boolean
}

const TAG = /<(\/?)(font|b|i|u|s)\b([^>]*)>/gi

export function stripRichText(text: string): string {
  return String(text).replace(TAG, '')
}

function cssOf(style: RichStyle): React.CSSProperties {
  const css: React.CSSProperties = {}
  if (style.color) css.color = style.color
  if (style.bold) css.fontWeight = 700
  if (style.italic) css.fontStyle = 'italic'
  if (style.underline || style.strike) css.textDecoration = `${style.underline ? 'underline' : ''} ${style.strike ? 'line-through' : ''}`.trim()
  return css
}

export function parseRichText(text: string): ReactNode[] {
  const src = String(text)
  const out: ReactNode[] = []
  const stack: RichStyle[] = [{}]
  let last = 0
  let m: RegExpExecArray | null

  const push = (chunk: string) => {
    if (!chunk) return
    const style = stack[stack.length - 1]
    const css = cssOf(style)
    out.push(
      Object.keys(css).length ? (
        <span key={out.length} style={css}>
          {chunk}
        </span>
      ) : (
        chunk
      ),
    )
  }

  TAG.lastIndex = 0
  while ((m = TAG.exec(src))) {
    push(src.slice(last, m.index))
    last = TAG.lastIndex
    const closing = m[1] === '/'
    const name = m[2].toLowerCase()
    if (!closing) {
      const style: RichStyle = { ...stack[stack.length - 1] }
      if (name === 'font') {
        const color = /color\s*=\s*["']?([^"'>\s]+)/i.exec(m[3] ?? '')
        if (color) style.color = color[1]
      } else if (name === 'b') style.bold = true
      else if (name === 'i') style.italic = true
      else if (name === 'u') style.underline = true
      else if (name === 's') style.strike = true
      stack.push(style)
    } else if (stack.length > 1) {
      stack.pop()
    }
  }
  push(src.slice(last))
  return out
}

export function RichText({ text }: { text: string }) {
  return <>{parseRichText(text)}</>
}
