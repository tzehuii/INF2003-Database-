import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { apiRequest, API_ROUTES } from '../api/client'
import type { SavedListDetail, SavedListEntry, SavedListSummary } from '../api/client'
import { useDatabase } from '../databaseContext'
import { Icon } from '../components/icons'

type Bookmarks = {
  entries: SavedListEntry[]; loading: boolean; error: string; pending: string[]
  save: (uen: string) => Promise<boolean>; remove: (uen: string) => Promise<boolean>; reload: () => void
}
const Context = createContext<Bookmarks | null>(null)

/** One browser's bookmark list in each database; company records stay in the database. */
export function BookmarksProvider({ children }: { children: ReactNode }) {
  const { database } = useDatabase()
  // Keep the page mounted; ignore bookmark responses from a database we have left.
  const activeDatabase = useRef(database)
  activeDatabase.current = database
  const storageKey = `bta:bookmarks:${database}`
  const listId = useRef<string | null>(null)
  const creating = useRef<Promise<string> | null>(null)
  const [entries, setEntries] = useState<SavedListEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [pending, setPending] = useState<string[]>([])
  const [version, setVersion] = useState(0)

  useEffect(() => {
    let current = true
    const controller = new AbortController()
    async function load() {
      setLoading(true); setError(''); setPending([]); creating.current = null
      try {
        const id = localStorage.getItem(storageKey)
        listId.current = id
        const loaded: SavedListEntry[] = []
        if (id) {
          let offset = 0
          while (true) {
            const result = await apiRequest<SavedListDetail>(API_ROUTES.savedListDetail(id), database, { limit: 100, offset }, { signal: controller.signal })
            if (result.state !== 'success') {
              if (!current) return
              if (result.status === 404) {
                localStorage.removeItem(storageKey); listId.current = null; break
              }
              throw new Error(result.message)
            }
            loaded.push(...result.body.entries)
            if (!result.meta?.pagination.has_more) break
            offset = result.meta.pagination.next_offset!
          }
        }
        if (current) setEntries(loaded)
      } catch (e) {
        if (current) setError(e instanceof Error ? e.message : 'Could not load saved companies.')
      } finally { if (current) setLoading(false) }
    }
    void load()
    return () => { current = false; controller.abort() }
  }, [database, storageKey, version])

  async function ensureList(): Promise<string> {
    if (listId.current) return listId.current
    if (!creating.current) {
      creating.current = (async () => {
        const result = await apiRequest<SavedListSummary>(API_ROUTES.savedLists, database, {}, { method: 'POST', body: { name: `Bookmarks ${crypto.randomUUID()}` } })
        if (result.state !== 'success') throw new Error(result.message)
        localStorage.setItem(storageKey, result.body.id)
        if (activeDatabase.current === database) listId.current = result.body.id
        return result.body.id
      })().finally(() => { if (activeDatabase.current === database) creating.current = null })
    }
    return creating.current
  }

  async function change(uen: string, remove: boolean) {
    setPending(old => [...old, uen]); setError('')
    try {
      const id = remove ? listId.current : await ensureList()
      if (!id || activeDatabase.current !== database) return false
      const path = `${API_ROUTES.savedListDetail(id)}/companies${remove ? `/${encodeURIComponent(uen)}` : ''}`
      const result = await apiRequest<SavedListEntry>(path, database, {}, { method: remove ? 'DELETE' : 'POST', body: remove ? undefined : { company_uen: uen } })
      if (activeDatabase.current !== database) return false
      if (result.state !== 'success') throw new Error(result.message)
      setEntries(old => remove ? old.filter(x => x.company_uen !== uen) : old.some(x => x.company_uen === uen) ? old : [...old, result.body])
      return true
    } catch (e) { if (activeDatabase.current === database) setError(e instanceof Error ? e.message : 'Could not update saved companies.'); return false }
    finally { if (activeDatabase.current === database) setPending(old => old.filter(x => x !== uen)) }
  }

  const reload = useCallback(() => setVersion(x => x + 1), [])
  return <Context.Provider value={{ entries, loading, error, pending, save: uen => change(uen, false), remove: uen => change(uen, true), reload }}>{children}</Context.Provider>
}

export function useBookmarks() {
  const value = useContext(Context)
  if (!value) throw new Error('BookmarksProvider is missing')
  return value
}

export function SaveCompanyButton({ uen }: { uen: string }) {
  const bookmarks = useBookmarks()
  const saved = bookmarks.entries.some(x => x.company_uen === uen)
  const busy = bookmarks.pending.includes(uen)
  const label = busy ? 'Updating bookmark…' : saved ? `Remove ${uen} from saved companies` : `Save ${uen} to saved companies`
  return <button type="button" className="button button-ghost bookmark-button" aria-label={label} title={label} aria-pressed={saved} aria-busy={busy} disabled={busy || bookmarks.loading} onClick={() => void (saved ? bookmarks.remove(uen) : bookmarks.save(uen))}><Icon name="saved" size={18} /></button>
}

export function BookmarkError() {
  const { error } = useBookmarks()
  return error ? <p className="banner banner-warning" role="alert">{error}</p> : null
}
