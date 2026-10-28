import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import CompanyLink from '../components/CompanyLink'
import { useVisitState } from '../visitState'
import { BookmarkError, useBookmarks } from '../api/bookmarks'
import type { SavedListEntry } from '../api/client'
import { EmptyState, PageHeading, Panel, RegistryStatusBadge, SearchInput } from '../components/ui'

export default function SavedListsPage() {
  const { entries, loading, pending, save, remove, reload } = useBookmarks()
  const [queryDraft, setQuery] = useVisitState('saved:query', '')
  // A stale development-session value must not crash the entire saved page.
  const query = typeof queryDraft === 'string' ? queryDraft : ''
  const [sortDraft, setSort] = useVisitState('saved:sort', 'recent')
  const sort = sortDraft === 'name' ? 'name' : 'recent'
  const [removed, setRemoved] = useState<SavedListEntry | null>(null)
  const [restoring, setRestoring] = useState(false)
  const active = useRef(true)

  useEffect(() => {
    active.current = true
    reload()
    return () => { active.current = false }
  }, [reload])

  useEffect(() => {
    if (!removed || restoring) return
    const timer = window.setTimeout(() => setRemoved(null), 10000)
    return () => window.clearTimeout(timer)
  }, [removed, restoring])

  async function removeCompany(entry: SavedListEntry) {
    if (await remove(entry.company_uen)) {
      if (active.current) setRemoved(entry)
    }
  }

  async function undoRemove() {
    if (!removed) return
    setRestoring(true)
    const restored = await save(removed.company_uen)
    if (active.current) {
      if (restored) setRemoved(null)
      setRestoring(false)
    }
  }

  // Only offer chronological sorting when the database supplies saved timestamps.
  const hasSavedDates = entries.some(entry => !!entry.saved_at)
  const term = query.trim().toLocaleLowerCase()
  const rows = entries.filter(entry => !term || entry.company_uen.toLocaleLowerCase().includes(term) || entry.company_name?.toLocaleLowerCase().includes(term))
    .sort((a, b) => {
      if (sort === 'recent') {
        const difference = (Date.parse(b.saved_at ?? '') || 0) - (Date.parse(a.saved_at ?? '') || 0)
        if (difference) return difference
      }
      return (a.company_name ?? a.company_uen).localeCompare(b.company_name ?? b.company_uen) || a.company_uen.localeCompare(b.company_uen)
    })

  return <>
    <PageHeading icon="saved" title="Saved companies" description="Your company bookmarks. Open a company to see its current details, or remove it whenever you like." actions={<Link className="button button-primary" to="/companies">Find companies</Link>} />
    <BookmarkError />
    {removed && <div className="banner banner-success" role="status"><p className="banner-text">Removed {removed.company_name ?? removed.company_uen}.</p><button type="button" className="button button-ghost button-sm" disabled={restoring || pending.includes(removed.company_uen)} onClick={() => void undoRemove()}>{restoring ? 'Restoring…' : 'Undo'}</button><button type="button" className="button button-ghost button-sm" disabled={restoring} aria-label="Dismiss removal message" onClick={() => setRemoved(null)}>Dismiss</button></div>}
    <Panel title={`Saved companies (${entries.length})`}>
      <div className="toolbar"><div className="toolbar-row toolbar-row-fields">
        <SearchInput aria-label="Search saved companies" placeholder="Search saved companies by name or UEN" value={query} onChange={event => setQuery(event.target.value)} />
        <label className="field"><span className="field-label">Sort by</span><select className="input" value={hasSavedDates ? sort : "name"} onChange={event => setSort(event.target.value)}>{hasSavedDates && <option value="recent">Recently saved</option>}<option value="name">Company name (A–Z)</option></select></label>
        {query && <button type="button" className="button button-secondary" onClick={() => setQuery('')}>Clear search</button>}
      </div></div>
      {loading ? <p className="panel-pad" role="status">Loading saved companies…</p> : entries.length === 0 ? <EmptyState title="No saved companies yet">Click the bookmark icon beside a company to save it here.</EmptyState> : rows.length === 0 ? <EmptyState title="No matching saved companies">Try another name or UEN, or clear your search.</EmptyState> : <div className="table-scroll"><table className="table"><thead><tr><th>Company</th><th>UEN</th><th>Registry status</th><th>Action</th></tr></thead><tbody>{rows.map(entry => <tr key={entry.company_uen}><td className="cell-primary"><CompanyLink uen={entry.company_uen}>{entry.company_name ?? entry.company_uen}</CompanyLink></td><td className="cell-id">{entry.company_uen}</td><td>{entry.company_status ? <RegistryStatusBadge status={entry.company_status} /> : 'Company no longer available'}</td><td><button type="button" className="button button-secondary button-sm" disabled={pending.includes(entry.company_uen)} onClick={() => void removeCompany(entry)}>{pending.includes(entry.company_uen) ? 'Removing…' : 'Remove'}</button></td></tr>)}</tbody></table></div>}
    </Panel>
  </>
}
