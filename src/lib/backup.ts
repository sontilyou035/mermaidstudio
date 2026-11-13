import type { BlockDef, DiagramDoc } from '../types'

/**
 * 全量备份：把浏览器里所有图表 + 自定义节点块打成一个文件。
 * 换电脑、清缓存、换访问地址之前先导一份，随时能导回来。
 */
export interface BackupFile {
  kind: 'mermaid-studio-backup'
  version: 1
  exportedAt: number
  app: string
  documents: DiagramDoc[]
  customBlocks: BlockDef[]
  settings?: Record<string, unknown>
}

export function buildBackup(
  documents: DiagramDoc[],
  customBlocks: BlockDef[],
  settings?: Record<string, unknown>,
): BackupFile {
  return {
    kind: 'mermaid-studio-backup',
    version: 1,
    exportedAt: Date.now(),
    app: 'Mermaid Studio',
    documents,
    customBlocks,
    settings,
  }
}

export function parseBackup(text: string): BackupFile {
  let parsed: Partial<BackupFile>
  try {
    parsed = JSON.parse(text) as Partial<BackupFile>
  } catch (err) {
    throw new Error(`备份文件不是合法 JSON（${(err as Error).message}）`)
  }
  if (parsed?.kind !== 'mermaid-studio-backup') throw new Error('不是 Mermaid Studio 的备份文件')
  if (!Array.isArray(parsed.documents)) throw new Error('备份文件里没有图表数据')
  return {
    kind: 'mermaid-studio-backup',
    version: 1,
    exportedAt: parsed.exportedAt ?? Date.now(),
    app: parsed.app ?? 'Mermaid Studio',
    documents: parsed.documents.filter((d) => d && Array.isArray(d.nodes) && Array.isArray(d.edges)),
    customBlocks: Array.isArray(parsed.customBlocks) ? parsed.customBlocks : [],
    settings: parsed.settings,
  }
}

export function backupFileName(prefix = 'mermaid-studio-backup'): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${prefix}-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.json`
}
