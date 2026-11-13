/** 颜色输入：支持「无颜色」（transparent），并兼容 CSS 变量/rgba 之类的自定义值 */
export function ColorField({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (v: string) => void
}) {
  const isNone = !value || value === 'transparent' || value === 'none'
  return (
    <label className="ms-row">
      <span className="ms-row__label">{label}</span>
      <span className="ms-row__control">
        <button
          className={`ms-none-btn${isNone ? ' is-active' : ''}`}
          onClick={() => onChange('transparent')}
          title="不填任何颜色"
        >
          无
        </button>
        <span className={`ms-color-wrap${isNone ? ' is-none' : ''}`}>
          <input
            type="color"
            className="ms-color"
            value={normalize(value)}
            onChange={(e) => onChange(e.target.value)}
          />
        </span>
        <input
          className="ms-input ms-input--color"
          value={isNone ? '' : value}
          placeholder="无颜色"
          onChange={(e) => onChange(e.target.value.trim() === '' ? 'transparent' : e.target.value)}
        />
      </span>
    </label>
  )
}

/** CSS 变量或 transparent 之类的值无法直接放进 <input type=color> */
export function normalize(color: string): string {
  if (!color) return '#ffffff'
  if (color.startsWith('#')) {
    if (color.length === 4) return `#${color[1]}${color[1]}${color[2]}${color[2]}${color[3]}${color[3]}`
    return color.slice(0, 7)
  }
  if (color.startsWith('rgb')) {
    const m = color.match(/\d+/g)
    if (m && m.length >= 3) return `#${m.slice(0, 3).map((n) => Number(n).toString(16).padStart(2, '0')).join('')}`
  }
  return '#ffffff'
}
