import { useState } from 'react'
import { Link } from 'react-router-dom'
import { API_ROUTES, isLiveData } from '../api/client'
import type { CompaniesData, CompanyStatusesData, IndustriesData } from '../api/client'
import { useApiResource } from '../api/useApiResource'
import { BookmarkError, SaveCompanyButton } from '../api/bookmarks'
import { EmptyState, LinkedAwardBadge, PageHeading, Pagination, Panel, PanelFooter, RegistryStatusBadge, SearchInput } from '../components/ui'
import { formatDate } from '../format'
import { ResourceStatus } from './publicShared'
type SortKey = 'name' | 'uen' | 'status' | 'registration_date' | 'primary_activity'
const SORT_COLUMNS: { key: SortKey; label: string }[] = [
  { key: 'name', label: 'Company name' }, { key: 'uen', label: 'UEN' },
  { key: 'status', label: 'Registry status' }, { key: 'registration_date', label: 'Registration date' },
  { key: 'primary_activity', label: 'Primary activity' },
]
const PAGE_SIZE = 25
const EMPTY = { q: '', status: '', linked: false, industry: '' }
export default function CompaniesPage() {
  const [sort, setSort] = useState<{ key: SortKey; direction: 'asc' | 'desc' }>({ key: 'uen', direction: 'asc' })
  const [draft, setDraft] = useState(EMPTY)
  const [filters, setFilters] = useState(EMPTY)
  const [offset, setOffset] = useState(0)
  // Show only broad letter-coded industry sections; the backend includes their subcategories.
  const industries = useApiResource<IndustriesData>(API_ROUTES.industries, {}, '', {}, true)
  const industryOptions = isLiveData(industries.result) ? industries.result.body.items : []
  const industryMatch = industryOptions.find(item => draft.industry === item.code)
  const invalidIndustry = !!draft.industry.trim() && !industryMatch
  const statuses = useApiResource<CompanyStatusesData>(API_ROUTES.companyStatuses, {}, '', {}, true)
  const { result, isLoading } = useApiResource<CompaniesData>(API_ROUTES.companies, { q: filters.q, industry_code: filters.industry, sort_by: sort.key, sort_direction: sort.direction, status: filters.status, require_linked_award: filters.linked, limit: PAGE_SIZE, offset }, '', {}, true)
  const rows = isLiveData(result) ? result.body.items : []
  // Ask the selected database to sort the full matching set, keeping filters unchanged.
  function toggleSort(key: SortKey) {
    setSort(previous => ({ key, direction: previous.key === key && previous.direction === 'asc' ? 'desc' : 'asc' }))
    setOffset(0)
  }
  return <>
    <PageHeading icon="companies" title="Companies" description="Browse Singapore companies and save the ones you want to monitor." />
    <BookmarkError />
    <Panel title="Companies">
      <form className="toolbar" onSubmit={e => { e.preventDefault(); if (invalidIndustry) return; setFilters({ ...draft, industry: industryMatch?.code ?? '', q: draft.q.trim() }); setOffset(0) }}>
        <div className="toolbar-row toolbar-row-fields">
          <SearchInput aria-label="UEN or company name" placeholder="Search UEN or current / former company name" value={draft.q} onChange={e => setDraft({ ...draft, q: e.target.value })} />
          <label className="field"><span className="field-label">Registry status</span><select className="input" value={draft.status} onChange={e => setDraft({ ...draft, status: e.target.value })}><option value="">All statuses</option>{isLiveData(statuses.result) && statuses.result.body.items.map(s => <option key={s}>{s}</option>)}</select></label>
          <label className="checkbox-item"><input type="checkbox" checked={draft.linked} onChange={e => setDraft({ ...draft, linked: e.target.checked })} />Has linked awards</label>

        </div>
        <div className="toolbar-row public-industry-filter">
          <label className="field field-grow"><span className="field-label">Primary industry / SSIC</span>
            <select className="input" value={draft.industry} onChange={event => setDraft({ ...draft, industry: event.target.value })} aria-describedby="public-industry-help" disabled={industries.isLoading && !industryOptions.length}>
              <option value="">{industries.isLoading && !industryOptions.length ? 'Loading industries...' : 'All industries'}</option>
              {industryOptions.map(item => <option key={item.code} value={item.code}>{item.code} - {item.title ?? 'No title'}</option>)}
            </select>
          </label>
          {draft.industry && <button type="button" className="button button-secondary" onClick={() => setDraft({ ...draft, industry: '' })}>Clear industry</button>}
        </div>
        <p id="public-industry-help" className="muted-text">{invalidIndustry ? 'Choose a suggestion or enter a valid SSIC code.' : 'Choose an industry category to filter companies by their primary business activity, including all subcategories. Click Search to apply.'}</p>
        {industries.result && industries.result.state !== 'success' && <p className="field-warning">Industry options could not load. Refresh to try again; other company filters still work.</p>}
        {draft.q.trim().length === 1 && <p className="field-warning">Enter at least two characters to search.</p>}
        {/* Apply/reset buttons follow all filter fields, including industry. */}
        <div className="toolbar-row public-company-filter-actions">
          <button className="button button-primary" disabled={draft.q.trim().length === 1 || invalidIndustry}>Search</button>
          <button type="button" className="button button-secondary" onClick={() => { setDraft(EMPTY); setFilters(EMPTY); setOffset(0) }}>Clear filters</button>
        </div>
      </form>
      <ResourceStatus result={result} loading={isLoading && !isLiveData(result)} />
      {isLoading && isLiveData(result) && <span className="visually-hidden" role="status">Updating company results.</span>}
      {isLiveData(result) && (rows.length ? <div className="table-scroll" aria-busy={isLoading}><table className="table"><thead><tr><th scope="col" className="bookmark-column">Save</th>{SORT_COLUMNS.map(column => <th key={column.key} aria-sort={sort.key === column.key ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}><button type="button" className="industry-sort" onClick={() => toggleSort(column.key)} title={`Sort ${column.label} ${sort.key === column.key && sort.direction === 'asc' ? 'descending' : 'ascending'}`}><span>{column.label}</span><span className={sort.key === column.key ? 'sort-arrow active' : 'sort-arrow'} aria-hidden="true">{sort.key === column.key ? (sort.direction === 'asc' ? '▲' : '▼') : '▴▾'}</span></button></th>)}<th>Linked awards</th></tr></thead><tbody>{rows.map(row => <tr key={row.uen}>
        <td className="bookmark-column"><SaveCompanyButton uen={row.uen} /></td><td className="cell-primary"><Link className="row-link" to={`/companies/${encodeURIComponent(row.uen)}`}>{row.name ?? row.uen}</Link></td><td className="cell-id">{row.uen}</td><td><RegistryStatusBadge status={row.status} /></td><td className="cell-nowrap">{formatDate(row.incorporation_date)}</td><td>{row.primary_activity ? `${row.primary_activity.code} — ${row.primary_activity.title ?? 'No title'}` : '—'}</td><td><LinkedAwardBadge hasLinkedAward={row.has_linked_award} /></td>
      </tr>)}</tbody></table></div> : <EmptyState title="No companies found">Try another company name or filter.</EmptyState>)}
      <PanelFooter><Pagination count={rows.length} hasPrevious={!isLoading && offset > 0} hasNext={!isLoading && isLiveData(result) && !!result.meta?.pagination.has_more} onPrevious={() => setOffset(x => Math.max(0, x - PAGE_SIZE))} onNext={() => setOffset(x => x + PAGE_SIZE)} /></PanelFooter>
    </Panel>
  </>
}
