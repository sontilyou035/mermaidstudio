import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { DEFAULT_MD_OPTIONS, FORMAT_META, suggestedFileName, type ExportFormat, type MarkdownOptions } from '../lib/exporters'
import { supportsFilePicker } from '../lib/files'

/** 保存弹框：选格式、选本地保存位置、自动保存设置 */
export function SaveDialog() {
  const open = useStore((s) => s.saveDialogOpen)
  const close = useStore((s) => s.closeSaveDialog)
  const doc = useStore((s) => s.doc)
  const settings = useStore((s) => s.settings)
  const updateSettings = useStore((s) => s.updateSettings)
  const saveToFile = useStore((s) => s.saveToFile)
  const fileTarget = useStore((s) => s.fileTarget)
  const grantFilePermission = useStore((s) => s.grantFilePermission)
  const forgetFile = useStore((s) => s.forgetFile)
  const currentMermaid = useStore((s) => s.currentMermaid)
  const mdVersion = useStore((s) => s.mdVersion)
  const docId = useStore((s) => s.doc.id)

  const [name, setName] = useState(doc.name)
  const [format, setFormat] = useState<ExportFormat>((fileTarget?.format as ExportFormat) ?? 'md')
  const [mdOptions, setMdOptions] = useState<MarkdownOptions>(DEFAULT_MD_OPTIONS)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) {
      setName(doc.name)
      setFormat((fileTarget?.format as ExportFormat) ?? 'md')
    }
  }, [open, doc.name, fileTarget?.format, docId])

  if (!open) return null

  const picker = supportsFilePicker()
  const fileName = suggestedFileName(name, format)
  const needsPermission = Boolean(fileTarget && fileTarget.permission !== 'granted')

  const run = async (chooseLocation: boolean) => {
    setBusy(true)
    try {
      await saveToFile({ format, name, mdOptions, chooseLocation })
    } finally {
      setBusy(false)
      if (!busy) close()
    }
  }

  return (
    <div className="ms-modal" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="ms-modal__panel ms-modal__panel--save">
        <div className="ms-modal__head">
          <div>
            <div className="ms-modal__title">保存</div>
            <div className="ms-modal__sub">
              图表同时会自动保存到浏览器本地；下面可以把文件保存到你自己的目录，方便交给 AI 或存档。
            </div>
          </div>
          <button className="ms-icon-btn" onClick={close}>
            ✕
          </button>
        </div>

        <div className="ms-modal__body">
          <label className="ms-row">
            <span className="ms-row__label">文件名</span>
            <span className="ms-row__control">
              <input className="ms-input" value={name} onChange={(e) => setName(e.target.value)} />
              <span className="ms-hint">保存为 {fileName}</span>
            </span>
          </label>

          <label className="ms-row">
            <span className="ms-row__label">格式</span>
            <span className="ms-row__control">
              <select className="ms-input" value={format} onChange={(e) => setFormat(e.target.value as ExportFormat)}>
                {(Object.keys(FORMAT_META) as ExportFormat[]).map((f) => (
                  <option key={f} value={f}>
                    {FORMAT_META[f].label}
                  </option>
                ))}
              </select>
            </span>
          </label>

          {format === 'md' ? (
            <div className="ms-subsection">
              <div className="ms-subsection__title">Markdown 内容</div>
              <div className="ms-md-preview">
                <pre className="ms-pre">{`---
title: "${name || '未命名图表'}"
kind: mermaid-flowchart
version: ${mdVersion() + 1}
author: "${settings.mdAuthor}"
updated: ${new Date().toISOString().slice(0, 16).replace('T', ' ')}
convention: "${settings.mdConvention.slice(0, 24)}…"
---

# ${name || '未命名图表'}

## 流程图

\`\`\`mermaid
${currentMermaid().split('\n').slice(0, 5).join('\n')}
...
\`\`\`

## 存疑清单
- [ ] 虚线对应的问题…

## 变更记录
- …`}</pre>
              </div>
              <div className="ms-checkrow">
                <label className="ms-switch">
                  <input
                    type="checkbox"
                    checked={mdOptions.title}
                    onChange={(e) => setMdOptions({ ...mdOptions, title: e.target.checked })}
                  />
                  包含一级标题
                </label>
                <label className="ms-switch">
                  <input
                    type="checkbox"
                    checked={mdOptions.questions}
                    onChange={(e) => setMdOptions({ ...mdOptions, questions: e.target.checked })}
                  />
                  存疑清单（每条虚线一条）
                </label>
                <label className="ms-switch">
                  <input
                    type="checkbox"
                    checked={mdOptions.changelog}
                    onChange={(e) => setMdOptions({ ...mdOptions, changelog: e.target.checked })}
                  />
                  变更记录
                </label>
              </div>
              <label className="ms-row">
                <span className="ms-row__label">作者</span>
                <span className="ms-row__control">
                  <input
                    className="ms-input"
                    value={settings.mdAuthor}
                    onChange={(e) => updateSettings({ mdAuthor: e.target.value })}
                  />
                </span>
              </label>
              <label className="ms-row">
                <span className="ms-row__label">约定</span>
                <span className="ms-row__control">
                  <input
                    className="ms-input"
                    value={settings.mdConvention}
                    onChange={(e) => updateSettings({ mdConvention: e.target.value })}
                  />
                </span>
              </label>
              <div className="ms-hint">
                每次手动导出 frontmatter 的 version 会 +1；自动保存不会改版本号。
                重新导出时会保留你在「存疑清单」里的勾选和「变更记录」里的历史条目。
              </div>
            </div>
          ) : null}

          <div className="ms-subsection">
            <div className="ms-subsection__title">保存位置</div>
            <div className="ms-filetarget">
              <span className="ms-filetarget__icon">📄</span>
              <span className="ms-filetarget__name">
                {fileTarget ? fileTarget.name : '还没有选择保存文件'}
              </span>
              <span className="ms-filetarget__state">
                {fileTarget
                  ? fileTarget.permission === 'granted'
                    ? '已授权，可自动保存'
                    : '需要重新授权'
                  : picker
                    ? '点「选择位置并保存」挑目录'
                    : '浏览器不支持选目录，将下载到下载目录'}
              </span>
              {fileTarget ? (
                <button className="ms-mini" onClick={() => void forgetFile()}>
                  取消目标
                </button>
              ) : null}
              {needsPermission ? (
                <button className="ms-mini ms-mini--accent" onClick={() => void grantFilePermission()}>
                  恢复授权
                </button>
              ) : null}
            </div>
            <div className="ms-hint">
              选定后改动会自动写进这个文件（默认开启，没有开关）；新建图表或换一张图时，保存目标各自独立，不会写到上一张图的文件里。
            </div>
            {!picker ? (
              <div className="ms-hint">
                当前浏览器不支持「另存为」对话框（Chrome / Edge 支持）。也可以在浏览器设置里打开
                「下载前询问每个文件的保存位置」，下载时就能自己选目录。
              </div>
            ) : null}
          </div>

        </div>

        <div className="ms-modal__foot">
          <button className="ms-btn" onClick={close}>
            关闭
          </button>
          <button className="ms-btn" disabled={busy} onClick={() => void run(false)}>
            保存到已选文件 / 下载
          </button>
          <button className="ms-btn ms-btn--primary" disabled={busy} onClick={() => void run(true)}>
            {picker ? '选择位置并保存…' : '下载文件'}
          </button>
        </div>
      </div>
    </div>
  )
}
