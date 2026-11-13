import type { ExportFormat } from './exporters'

/**
 * 本地文件保存：
 *  - 支持 File System Access API 的浏览器（Chrome / Edge）会弹出系统「另存为」窗口，可以自己选目录；
 *  - 不支持的浏览器退回普通下载（走浏览器默认下载目录）。
 *  选中的文件句柄存在 IndexedDB 里，刷新后仍能恢复（需要点一次「恢复」重新授权）。
 */

declare global {
  interface Window {
    showSaveFilePicker?: (options?: {
      suggestedName?: string
      types?: Array<{ description?: string; accept: Record<string, string[]> }>
      excludeAcceptAllOption?: boolean
      startIn?: unknown
      id?: string
    }) => Promise<FileSystemFileHandle>
  }
}

export interface SaveTargetInfo {
  /** 这个文件属于哪张图表：换图/新建不会串到别人的文件上 */
  docId: string
  name: string
  format: ExportFormat
  savedAt: number | null
  /** granted = 可以直接写入；prompt = 需要用户点一次授权 */
  permission: 'granted' | 'prompt' | 'denied'
}

const DB_NAME = 'mermaid-studio-files'
const STORE = 'handles'
const KEY = 'save-target'

let handle: FileSystemFileHandle | null = null
let info: SaveTargetInfo | null = null
/** 当前内存里这个句柄属于哪张图 */
let currentDocId: string | null = null

/** 每张图各自存一个句柄：docId -> { handle, format } */
type StoredTargets = Record<string, { handle: FileSystemFileHandle; format: ExportFormat }>

/** 旧版本只存了一个全局句柄 */
type LegacyTarget = { handle: FileSystemFileHandle; format?: ExportFormat }

function isLegacyTarget(value: unknown): value is LegacyTarget {
  return !!value && typeof value === 'object' && 'handle' in (value as Record<string, unknown>)
}

export function supportsFilePicker(): boolean {
  return typeof window !== 'undefined' && typeof window.showSaveFilePicker === 'function'
}

export function getSaveTarget(): SaveTargetInfo | null {
  return info
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function idbSet(value: unknown): Promise<void> {
  try {
    await idbSetRaw(value)
  } catch (err) {
    // 存不下（隐私模式 / 结构不可克隆）不影响本次会话继续用内存里的句柄
    console.warn('[mermaid-studio] 保存文件句柄失败，仅本次会话有效', err)
  }
}

async function idbSetRaw(value: unknown): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(value, KEY)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  db.close()
}

async function idbGet<T>(): Promise<T | null> {
  const db = await openDb()
  const value = await new Promise<T | null>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).get(KEY)
    req.onsuccess = () => resolve((req.result as T) ?? null)
    req.onerror = () => reject(req.error)
  })
  db.close()
  return value
}

async function idbDelete(): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(KEY)
    tx.oncomplete = () => resolve()
    tx.onerror = () => resolve()
  })
  db.close()
}

async function queryPermission(h: FileSystemFileHandle): Promise<SaveTargetInfo['permission']> {
  try {
    const anyH = h as unknown as { queryPermission?: (d: { mode: string }) => Promise<PermissionState> }
    if (typeof anyH.queryPermission !== 'function') return 'granted'
    const state = await anyH.queryPermission({ mode: 'readwrite' })
    return state === 'granted' ? 'granted' : state === 'denied' ? 'denied' : 'prompt'
  } catch {
    return 'prompt'
  }
}

/** 弹出系统保存对话框让用户选位置 */
export async function chooseSaveTarget(
  suggestedName: string,
  format: ExportFormat,
  mime: string,
  description: string,
  docId: string,
): Promise<SaveTargetInfo | null> {
  if (!supportsFilePicker()) return null
  try {
    const picked = await window.showSaveFilePicker!({
      suggestedName,
      types: [{ description, accept: { [mime.split(';')[0]]: [suggestedName.slice(suggestedName.lastIndexOf('.')) || '.txt'] } }],
      excludeAcceptAllOption: false,
      startIn: handle ?? undefined,
      id: 'mermaid-studio',
    })
    handle = picked
    currentDocId = docId
    const permission = await queryPermission(picked)
    info = { docId, name: picked.name, format, savedAt: info?.savedAt ?? null, permission }
    const map = await readTargets()
    map[docId] = { handle: picked, format }
    await idbSet(map)
    return info
  } catch (err) {
    if ((err as DOMException)?.name === 'AbortError') return null
    console.warn('[mermaid-studio] 选择保存位置失败', err)
    return null
  }
}

/** 写入当前选中的文件 */
export async function writeToSaveTarget(data: string | Blob): Promise<boolean> {
  if (!handle) return false
  try {
    const writable = await (handle as unknown as { createWritable: () => Promise<FileSystemWritableFileStream> }).createWritable()
    await writable.write(data as never)
    await writable.close()
    if (info) {
      info = { ...info, savedAt: Date.now(), permission: 'granted' }
      const map = await readTargets()
      map[info.docId] = { handle, format: info.format }
      await idbSet(map)
    }
    return true
  } catch (err) {
    console.warn('[mermaid-studio] 写入文件失败', err)
    if (info) info = { ...info, permission: 'prompt' }
    return false
  }
}

/** 读一下已经写在磁盘上的内容（用来保留手写的存疑项 / 历史变更记录） */
export async function readSaveTarget(): Promise<string | null> {
  if (!handle) return null
  try {
    const file = await (handle as unknown as { getFile: () => Promise<File> }).getFile()
    return await file.text()
  } catch {
    return null
  }
}

/** 刷新后点一下就能恢复自动保存（浏览器要求用户手势才能重新授权） */
export async function requestTargetPermission(): Promise<boolean> {
  if (!handle) return false
  try {
    const anyH = handle as unknown as { requestPermission?: (d: { mode: string }) => Promise<PermissionState> }
    if (typeof anyH.requestPermission === 'function') {
      const state = await anyH.requestPermission({ mode: 'readwrite' })
      if (state !== 'granted') {
        if (info) info = { ...info, permission: state === 'denied' ? 'denied' : 'prompt' }
        return false
      }
    }
    if (info) info = { ...info, permission: 'granted' }
    return true
  } catch {
    return false
  }
}

/** 读出磁盘上的「每图一个句柄」表；兼容旧版本的单句柄记录 */
async function readTargets(): Promise<StoredTargets> {
  const raw = await idbGet<unknown>()
  if (!raw) return {}
  if (isLegacyTarget(raw)) {
    // 旧版本只有一个全局句柄：算作当前这张图的，迁移后其它图不再共用
    const owner = currentDocId
    return owner ? { [owner]: { handle: raw.handle, format: raw.format ?? 'md' } } : {}
  }
  return raw as StoredTargets
}

export async function restorePersistedTarget(docId: string): Promise<SaveTargetInfo | null> {
  currentDocId = docId
  handle = null
  info = null
  try {
    const saved = await idbGet<unknown>()
    if (!saved) return null
    let map: StoredTargets
    if (isLegacyTarget(saved)) {
      map = { [docId]: { handle: saved.handle, format: saved.format ?? 'md' } }
      await idbSet(map)
    } else {
      map = saved as StoredTargets
    }
    const entry = map[docId]
    if (!entry?.handle) return null
    handle = entry.handle
    const permission = await queryPermission(entry.handle)
    info = { docId, name: entry.handle.name, format: entry.format ?? 'md', savedAt: null, permission }
    return info
  } catch {
    return null
  }
}

/** 只清内存里的句柄（切换/新建图表时用，不删磁盘记录） */
export function clearCurrentTarget() {
  handle = null
  info = null
  currentDocId = null
}

/** 忘掉某张图选过的文件（不传就只清内存） */
export async function forgetSaveTarget(docId?: string): Promise<void> {
  if (!docId) {
    clearCurrentTarget()
    return
  }
  try {
    const map = await readTargets()
    delete map[docId]
    if (Object.keys(map).length) await idbSet(map)
    else await idbDelete()
  } catch {
    /* ignore */
  }
  if (currentDocId === docId) clearCurrentTarget()
}

export function setTargetFormat(format: ExportFormat) {
  if (info) info = { ...info, format }
}

export function hasTargetHandle(): boolean {
  return handle !== null
}
