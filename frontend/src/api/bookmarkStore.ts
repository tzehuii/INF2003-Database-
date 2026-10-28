/** one browser bookmark collection, mirrored into both database lists.
 * Persist membership before mirroring so an offline database cannot lose saves/removals.
 * Company records themselves are never copied between databases.
 */
import { API_ROUTES } from './client'
import type { ApiRequestOptions, ApiResult, DatabaseMode, QueryValue, SavedListDetail, SavedListEntry, SavedListSummary } from './client'

type Request = <T>(path: string, database: DatabaseMode, query?: Record<string, QueryValue>, options?: ApiRequestOptions) => Promise<ApiResult<T>>
type Saved = { entries: SavedListEntry[]; imported: DatabaseMode[]; removed: string[] }
const DATABASES: DatabaseMode[] = ['mariadb', 'mongodb']
const KEY = 'bta:bookmarks:shared:v1'
export class BookmarkStore {
  private saved: Saved
  private queue: Promise<unknown> = Promise.resolve()
  private storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
  private request: Request
  constructor(storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>, request: Request) {
    this.storage = storage
    this.request = request
    this.saved = this.readSaved()
  }
  private readSaved(): Saved {
    try {
      const saved = JSON.parse(this.storage.getItem(KEY) ?? 'null') as Saved | null
      if (saved && Array.isArray(saved.entries) && Array.isArray(saved.imported) && Array.isArray(saved.removed)
          && saved.entries.every(entry => typeof entry?.company_uen === 'string')) return saved
    } catch { /* A damaged browser cache can be recovered from the database lists. */ }
    return { entries: [], imported: [], removed: [] }
  }
  get entries() { return this.saved.entries }
  get storedEntries() { return this.readSaved().entries }
  private persist() { this.storage.setItem(KEY, JSON.stringify(this.saved)) }
  private serial<T>(action: () => Promise<T>): Promise<T> {
    // A browser-wide lock prevents two tabs reconciling from different snapshots.
    const execute = () => { this.saved = this.readSaved(); return action() }
    const run = this.queue.then(() => globalThis.navigator?.locks
      ? globalThis.navigator.locks.request(KEY, execute)
      : execute())
    this.queue = run.catch(() => {})
    return run
  }
  private key(database: DatabaseMode) { return `bta:bookmarks:${database}` }
  private async read(database: DatabaseMode): Promise<{ id: string | null; entries: SavedListEntry[] }> {
    const id = this.storage.getItem(this.key(database))
    if (!id) return { id: null, entries: [] }
    const entries: SavedListEntry[] = []
    for (let offset = 0; ; offset += 100) {
      const result = await this.request<SavedListDetail>(API_ROUTES.savedListDetail(id), database, { limit: 100, offset })
      if (result.state !== 'success') {
        if (result.status === 404) { this.storage.removeItem(this.key(database)); return { id: null, entries: [] } }
        throw new Error(result.message)
      }
      entries.push(...result.body.entries)
      if (!result.meta?.pagination.has_more) return { id, entries }
    }
  }
  private async ensureList(database: DatabaseMode, id: string | null): Promise<string> {
    if (id) return id
    const result = await this.request<SavedListSummary>(API_ROUTES.savedLists, database, {}, {
      method: 'POST', body: { name: `Bookmarks ${crypto.randomUUID()}` },
    })
    if (result.state !== 'success') throw new Error(result.message)
    this.storage.setItem(this.key(database), result.body.id)
    return result.body.id
  }
  /** Import both old lists once. Tombstones stop a delayed import restoring removed bookmarks. */
  private async importLegacy(database: DatabaseMode) {
    if (this.saved.imported.includes(database)) return
    const remote = await this.read(database)
    for (const entry of remote.entries) {
      if (!this.saved.removed.includes(entry.company_uen) && !this.saved.entries.some(x => x.company_uen === entry.company_uen)) this.saved.entries.push(entry)
    }
    this.saved.imported.push(database)
    this.persist()
  }
  /** Reconcile membership, not company data. Repeating after a failed request is safe. */
  private async mirror(database: DatabaseMode, refreshDetails: boolean) {
    const remote = await this.read(database)
    let id = remote.id
    let incomplete = false
    for (const entry of this.saved.entries) {
      if (remote.entries.some(x => x.company_uen === entry.company_uen)) continue
      id = await this.ensureList(database, id)
      const result = await this.request<SavedListEntry>(`${API_ROUTES.savedListDetail(id)}/companies`, database, {}, {
        method: 'POST', body: { company_uen: entry.company_uen },
      })
      if (result.state !== 'success') incomplete = true
    }
    for (const entry of remote.entries) {
      if (this.saved.entries.some(x => x.company_uen === entry.company_uen)) continue
      const result = await this.request<void>(`${API_ROUTES.savedListDetail(id!)}/companies/${encodeURIComponent(entry.company_uen)}`, database, {}, { method: 'DELETE' })
      if (result.state !== 'success') incomplete = true
    }
    if (refreshDetails) {
      this.saved.entries = this.saved.entries.map(entry => {
        const latest = remote.entries.find(x => x.company_uen === entry.company_uen)
        return latest ? { ...latest, saved_at: entry.saved_at ?? latest.saved_at } : entry
      })
      this.persist()
    }
    if (incomplete) throw new Error('Some bookmarks could not be synced.')
  }
  refresh(database: DatabaseMode, notify: () => void): Promise<string> {
    return this.serial(async () => {
      const failures = new Set<string>()
      for (const db of DATABASES) {
        try { await this.importLegacy(db); notify() }
        catch { failures.add(db === 'mariadb' ? 'MariaDB' : 'MongoDB') }
      }
      for (const db of DATABASES) {
        if (!this.saved.imported.includes(db)) continue
        try { await this.mirror(db, db === database); notify() }
        catch { failures.add(db === 'mariadb' ? 'MariaDB' : 'MongoDB') }
      }
      return failures.size ? `Bookmarks are kept in this browser. Sync with ${[...failures].join(' and ')} is incomplete; retry when available. A company must exist there to sync.` : ''
    })
  }
  change(uen: string, remove: boolean, notify: () => void): Promise<void> {
    return this.serial(async () => {
      if (remove) {
        this.saved.entries = this.saved.entries.filter(x => x.company_uen !== uen)
        if (!this.saved.removed.includes(uen)) this.saved.removed.push(uen)
      } else {
        // Resolve display details from either source before accepting a new bookmark.
        if (!this.saved.entries.some(x => x.company_uen === uen)) {
          let found: SavedListEntry | null = null
          for (const database of DATABASES) {
            try {
              const id = await this.ensureList(database, this.storage.getItem(this.key(database)))
              const result = await this.request<SavedListEntry>(`${API_ROUTES.savedListDetail(id)}/companies`, database, {}, { method: 'POST', body: { company_uen: uen } })
              if (result.state === 'success') { found = result.body; break }
            } catch { /* Try the other source if this database is unavailable. */ }
          }
          if (!found) throw new Error('Could not save this company in either database. Please retry.')
          this.saved.entries.push({ ...found, saved_at: new Date().toISOString() })
        }
        this.saved.removed = this.saved.removed.filter(x => x !== uen)
      }
      this.persist()
      notify()
    })
  }
}
