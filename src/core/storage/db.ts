import Dexie, { type Table } from 'dexie'
import type { Asset, Character, Generation, Material, Project, Storyboard } from '@/types/domain'
import type { Production } from '@/core/pipeline/production'
import { indexedDB as fallbackIDB, IDBKeyRange as fallbackKeyRange } from 'fake-indexeddb'

/**
 * IndexedDB 模式定义。
 *
 * 任何字段或表的变更都需要 `version(N+1).stores({...}).upgrade(...)` 形式
 * 增加新版本号；不要原地修改现有版本。
 */
class DramaiDB extends Dexie {
  projects!: Table<Project, string>
  characters!: Table<Character, string>
  materials!: Table<Material, string>
  storyboards!: Table<Storyboard, string>
  assets!: Table<Asset, string>
  generations!: Table<Generation, string>
  productions!: Table<Production, string>

  constructor(fallback = false) {
    super('dramai', fallback ? { indexedDB: fallbackIDB, IDBKeyRange: fallbackKeyRange } : undefined)

    this.version(1).stores({
      // 第一个字段是主键，后续逗号分隔的是次级索引
      projects: 'id, status, createdAt, updatedAt',
      characters: 'id, projectId, role, locked, createdAt',
      materials: 'id, projectId, kind, createdAt',
      storyboards: 'id, projectId, status, [projectId+sequence]',
      assets: 'id, projectId, kind, createdAt',
      generations: 'id, projectId, stageName, status, createdAt',
    })
    this.version(2).stores({ productions: 'projectId' })
    // Add optional edit/composition records without rewriting or deleting existing media.
    this.version(3).stores({ productions: 'projectId' }).upgrade(() => {})
    this.version(4).stores({ productions: 'projectId' }).upgrade(() => {})
  }
}

export let db = new DramaiDB()
export let storageMode: 'browser' | 'local-file' = 'browser'
const tableNames = ['projects', 'characters', 'materials', 'storyboards', 'assets', 'generations', 'productions']
let saving: Promise<void> = Promise.resolve()
let saveTimer: ReturnType<typeof setTimeout> | undefined
let saveError: Error | undefined

try {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([db.open(), new Promise<never>((_, reject) => {
      timeout = setTimeout(() => reject(Object.assign(new Error('浏览器数据库初始化超时'), { name: 'UnknownError' })), 5000)
    })])
  } finally { clearTimeout(timeout) }
} catch (error) {
  const name = (error as Error).name
  if (!['UnknownError', 'SecurityError', 'InvalidStateError', 'MissingAPIError'].includes(name)) throw error
  db.close()
  const response = await fetch('/api/local-db', { cache: 'no-store' })
  if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) throw new Error('当前浏览器无法打开 IndexedDB。请用 start-local.cmd 启动本地存储服务后刷新。')
  const snapshot = await response.json() as Record<string, Record<string, unknown>[]>
  db = new DramaiDB(true)
  await db.open()
  for (const name of tableNames) {
    const rows = snapshot[name] ?? []
    if (name === 'assets') for (const row of rows) {
      const binary = atob(String(row.blobBase64 ?? ''))
      row.blob = new Blob([Uint8Array.from(binary, c => c.charCodeAt(0))], { type: String(row.mimeType ?? '') })
      delete row.blobBase64
    }
    if (rows.length) await db.table(name).bulkPut(rows)
  }
  storageMode = 'local-file'
  db.use({ stack: 'dbcore', name: 'local-file-persistence', create(core) {
    return { ...core, transaction(...args) {
      const transaction = core.transaction(...args)
      if (args[1] === 'readwrite') (transaction as unknown as IDBTransaction).addEventListener('complete', () => {
        clearTimeout(saveTimer)
        saveTimer = setTimeout(() => { void flushLocalStore().catch(error => { saveError = error as Error }) }, 50)
      })
      return transaction
    } }
  } })
  // Reopen to install the persistence middleware on the constructed core.
  db.close(); await db.open()
}

export async function flushLocalStore(): Promise<void> {
  if (storageMode !== 'local-file') return
  clearTimeout(saveTimer)
  const task = saving.then(async () => {
    const snapshot: Record<string, unknown[]> = {}
    await db.transaction('r', tableNames.map(name => db.table(name)), async () => {
      for (const name of tableNames) snapshot[name] = await db.table(name).toArray()
    })
    const assets = snapshot.assets as (Asset & { blobBase64?: string })[]
    snapshot.assets = await Promise.all(assets.map(async ({ blob, ...rest }) => {
      const encoded = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = () => reject(reader.error); reader.readAsDataURL(blob)
      })
      return { ...rest, blobBase64: encoded }
    }))
    const response = await fetch('/api/local-db', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(snapshot) })
    if (!response.ok) throw new Error(`本地文件保存失败（HTTP ${response.status}），请保持页面开启并重试。`)
    saveError = undefined
  })
  saving = task.catch(() => {})
  await task
  if (saveError) throw saveError
}

/** 一次性删除所有 dramai 本地数据。会触发所有 useLiveQuery 重新计算。 */
export async function wipeAll(): Promise<void> {
  await db.delete()
  await db.open()
}
