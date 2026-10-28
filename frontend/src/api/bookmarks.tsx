import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { apiRequest } from '../api/client'
import { BookmarkStore } from './bookmarkStore'
import type { SavedListEntry } from '../api/client'
import { useDatabase } from '../databaseContext'
import { Icon } from '../components/icons'

type Bookmarks = {
  entries: SavedListEntry[]; loading: boolean; error: string; pending: string[]
  save: (uen: string) => Promise<boolean>; remove: (uen: string) => Promise<boolean>; reload: () => void
}
const Context = createContext<Bookmarks | null>(null)

/** share bookmark membership across switches and mirror both saved lists. */
export function BookmarksProvider({ children }: { children: ReactNode }) {
  const { database } = useDatabase()
  const [store] = useState(() => new BookmarkStore(localStorage, apiRequest))
  const [entries, setEntries] = useState<SavedListEntry[]>(store.entries)
  const [loading, setLoading] = useState(store.entries.length === 0)
  const [error, setError] = useState('')
  const [pending, setPending] = useState<string[]>([])
  const [version, setVersion] = useState(0)
  const mounted = useRef(false)
  const refreshVersion = useRef(0)
  const publish = useCallback(() => { if (mounted.current) setEntries([...store.entries]) }, [store])
  useEffect(() => {
    mounted.current = true
    // Follow saves in another tab without starting a sync loop between tabs.
    const changed = (event: StorageEvent) => {
      if (event.key === 'bta:bookmarks:shared:v1') setEntries([...store.storedEntries])
    }
    window.addEventListener('storage', changed)
    return () => { mounted.current = false; window.removeEventListener('storage', changed) }
  }, [store])

  useEffect(() => {
    const request = ++refreshVersion.current
    void store.refresh(database, publish).then(message => {
      if (mounted.current && request === refreshVersion.current) { setError(message); setLoading(false) }
    }).catch(() => {
      if (mounted.current && request === refreshVersion.current) { setError('Could not load saved companies. Please retry.'); setLoading(false) }
    })
  }, [database, store, publish, version])

  async function change(uen: string, remove: boolean) {
    setPending(old => [...old, uen]); setError('')
    try {
      await store.change(uen, remove, publish)
      // Membership updates immediately; an unavailable mirror is retried on reload/switch.
      void store.refresh(database, publish).then(message => { if (mounted.current) setError(message) }).catch(() => { if (mounted.current) setError('Your bookmarks are kept in this browser, but sync could not finish. Please retry.') })
      return true
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : 'Could not update saved companies.')
      return false
    } finally { if (mounted.current) setPending(old => old.filter(x => x !== uen)) }
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
  const { error, reload } = useBookmarks()
  return error ? <div className="banner banner-warning" role="alert"><p className="banner-text">{error}</p><button type="button" className="button button-secondary button-sm" onClick={reload}>Retry sync</button></div> : null
}
