import { useState } from 'react'
import { Link } from 'react-router-dom'
import { API_ROUTES, isLiveData } from '../api/client'
import type { CompaniesData, CompanyStatusesData } from '../api/client'
import { useApiResource } from '../api/useApiResource'
import { BookmarkError, SaveCompanyButton } from '../api/bookmarks'
import { EmptyState, LinkedAwardBadge, PageHeading, Pagination, Panel, PanelFooter, RegistryStatusBadge, SearchInput } from '../components/ui'
import { formatDate } from '../format'
import { ResourceStatus } from './publicShared'
const PAGE_SIZE = 25
const EMPTY = { q: '', status: '', linked: false }
export default function CompaniesPage() {
  const [draft, setDraft] = useState(EMPTY)
  const [filters, setFilters] = useState(EMPTY)
  const [offset, setOffset] = useState(0)
  const statuses = useApiResource<CompanyStatusesData>(API_ROUTES.companyStatuses)
  const { result, isLoading } = useApiResource<CompaniesData>(API_ROUTES.companies, { q: filters.q, status: filters.status, require_linked_award: filters.linked, limit: PAGE_SIZE, offset })
  const rows = isLiveData(result) ? result.body.items : []
  return <>
    <PageHeading icon="companies" title="Companies" description="Browse Singapore companies and save the ones you want to monitor." />
    <BookmarkError />
    <Panel title="Companies">
      <form className="toolbar" onSubmit={e => { e.preventDefault(); setFilters({ ...draft, q: draft.q.trim() }); setOffset(0) }}>
        <div className="toolbar-row toolbar-row-fields">
          <SearchInput aria-label="UEN or company name" placeholder="Search UEN or current / former company name" value={draft.q} onChange={e => setDraft({ ...draft, q: e.target.value })} />
          <label className="field"><span className="field-label">Registry status</span><select className="input" value={draft.status} onChange={e => setDraft({ ...draft, status: e.target.value })}><option value="">All statuses</option>{isLiveData(statuses.result) && statuses.result.body.items.map(s => <option key={s}>{s}</option>)}</select></label>
          <label className="checkbox-item"><input type="checkbox" checked={draft.linked} onChange={e => setDraft({ ...draft, linked: e.target.checked })} />Has linked awards</label>
          <button className="button button-primary" disabled={draft.q.trim().length === 1}>Search</button>
          <button type="button" className="button button-secondary" onClick={() => { setDraft(EMPTY); setFilters(EMPTY); setOffset(0) }}>Clear filters</button>
        </div>
        {draft.q.trim().length === 1 && <p className="field-warning">Enter at least two characters to search.</p>}
      </form>
      <ResourceStatus result={result} loading={isLoading} />
      {isLiveData(result) && (rows.length ? <div className="table-scroll"><table className="table"><thead><tr><th scope="col" className="bookmark-column">Save</th><th>Company name</th><th>UEN</th><th>Registry status</th><th>Registration date</th><th>Primary activity</th><th>Linked awards</th></tr></thead><tbody>{rows.map(row => <tr key={row.uen}>
        <td className="bookmark-column"><SaveCompanyButton uen={row.uen} /></td><td className="cell-primary"><Link className="row-link" to={`/companies/${encodeURIComponent(row.uen)}`}>{row.name ?? row.uen}</Link></td><td className="cell-id">{row.uen}</td><td><RegistryStatusBadge status={row.status} /></td><td className="cell-nowrap">{formatDate(row.incorporation_date)}</td><td>{row.primary_activity ? `${row.primary_activity.code} — ${row.primary_activity.title ?? 'No title'}` : '—'}</td><td><LinkedAwardBadge hasLinkedAward={row.has_linked_award} /></td>
      </tr>)}</tbody></table></div> : <EmptyState title="No companies found">Try another company name or filter.</EmptyState>)}
      <PanelFooter><Pagination count={rows.length} hasPrevious={!isLoading && offset > 0} hasNext={!isLoading && isLiveData(result) && !!result.meta?.pagination.has_more} onPrevious={() => setOffset(x => Math.max(0, x - PAGE_SIZE))} onNext={() => setOffset(x => x + PAGE_SIZE)} /></PanelFooter>
    </Panel>
  </>
}
