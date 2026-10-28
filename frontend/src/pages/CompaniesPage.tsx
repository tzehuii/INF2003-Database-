import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useVisitState } from '../visitState'
import CompanyLink from '../components/CompanyLink'
import { API_ROUTES, isLiveData } from '../api/client'
import type { ApiResult, CompaniesData, CompanyStatusesData, IndustriesData } from '../api/client'
import { useApiResource } from '../api/useApiResource'
import { BookmarkError, SaveCompanyButton } from '../api/bookmarks'
import { EmptyState, LinkedAwardBadge, PageHeading, Panel, PanelFooter, RegistryStatusBadge, SearchInput } from '../components/ui'
import { formatDate } from '../format'
import { ResourceStatus } from './publicShared'
type SortKey = 'name' | 'uen' | 'status' | 'registration_date' | 'primary_activity'
const SORT_COLUMNS: { key: SortKey; label: string }[] = [
  { key: 'name', label: 'Company name' }, { key: 'uen', label: 'UEN' },
  { key: 'status', label: 'Registry status' }, { key: 'registration_date', label: 'Registration date' },
  { key: 'primary_activity', label: 'Primary activity' },
]
const EMPTY = { q: '', status: '', linked: false, industry: '' }
export default function CompaniesPage() {
  const [sort, setSort] = useVisitState<{ key: SortKey; direction: 'asc' | 'desc' }>('companies:sort', { key: 'uen', direction: 'asc' })
  const [draft, setDraft] = useVisitState('companies:draft', EMPTY)
  const [filters, setFilters] = useVisitState('companies:filters', EMPTY)
  const [offset, setOffset] = useVisitState('companies:offset', 0)
  const [pageSize,setPageSize] = useVisitState('companies:page-size', 25)
  const [pageDraft,setPageDraft] = useState(String(Math.floor(offset / pageSize) + 1))
  useEffect(() => { setPageDraft(String(Math.floor(offset / pageSize) + 1)) }, [offset,pageSize])
  const [tablePosition,setTablePosition] = useVisitState('companies:table-position', {top:0,left:0})
  const table = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => { if (table.current) { table.current.scrollTop=tablePosition.top; table.current.scrollLeft=tablePosition.left } }, [])
  function resetTable() { setTablePosition({top:0,left:0}); if (table.current) { table.current.scrollTop=0; table.current.scrollLeft=0 } }
  // Show only broad letter-coded industry sections; the backend includes their subcategories.
  const industries = useApiResource<IndustriesData>(API_ROUTES.industries, {}, '', {}, true)
  const industryOptions = isLiveData(industries.result) ? industries.result.body.items : []
  const industryMatch = industryOptions.find(item => draft.industry === item.code)
  const invalidIndustry = !!draft.industry.trim() && isLiveData(industries.result) && !industryMatch
  const statuses = useApiResource<CompanyStatusesData>(API_ROUTES.companyStatuses, {}, '', {}, true)
  const [cached, setCached] = useVisitState<ApiResult<CompaniesData> | null>('companies:rows', null)
  const { result: response, isLoading } = useApiResource<CompaniesData>(API_ROUTES.companies, { q: filters.q, industry_code: filters.industry, sort_by: sort.key, sort_direction: sort.direction, status: filters.status, require_linked_award: filters.linked, limit: pageSize, offset }, '', {}, true)
  useEffect(() => { if (isLiveData(response)) setCached(response) }, [response, setCached])
  const result = response ?? cached
  const rows = isLiveData(result) ? result.body.items : []
  // Ask the selected database to sort the full matching set, keeping filters unchanged.
  function toggleSort(key: SortKey) {
    setSort(previous => ({ key, direction: previous.key === key && previous.direction === 'asc' ? 'desc' : 'asc' }))
    setOffset(0); resetTable()
  }
  return <>
    <PageHeading icon="companies" title="Companies" description="Browse Singapore companies and save the ones you want to monitor." />
    <BookmarkError />
    <Panel title="Companies">
      <form className="toolbar" onSubmit={e => { e.preventDefault(); if (invalidIndustry || draft.q.trim().length === 1) return; setFilters({ ...draft, industry: industryMatch?.code ?? draft.industry, q: draft.q.trim() }); setOffset(0); resetTable() }}>
        <div className="toolbar-row toolbar-row-fields public-company-filter-row">
          <label className="field field-grow public-company-search"><span className="field-label">Company name or UEN</span><SearchInput aria-label="UEN or company name" aria-describedby="company-search-help" aria-invalid={draft.q.trim().length === 1} placeholder="Search UEN or current / former company name" value={draft.q} onChange={e => setDraft({ ...draft, q: e.target.value })} /><small id="company-search-help" className={draft.q.trim().length === 1 ? 'field-warning' : 'muted-text'}>Enter at least 2 characters, or leave empty to browse.</small></label>
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
        {/* Apply/reset buttons follow all filter fields, including industry. */}
        <div className="toolbar-row public-company-filter-actions">
          <button className="button button-primary" disabled={draft.q.trim().length === 1 || invalidIndustry}>Search</button>
          <button type="button" className="button button-secondary" onClick={() => { setDraft(EMPTY); setFilters(EMPTY); setOffset(0); resetTable() }}>Clear filters</button>
        </div>
      </form>
      <ResourceStatus result={result} loading={isLoading && !isLiveData(result)} />
      {isLoading && isLiveData(result) && <span className="visually-hidden" role="status">Updating company results.</span>}
      {isLiveData(result) && (rows.length ? <div ref={table} className="table-scroll" aria-busy={isLoading} onScroll={event=>setTablePosition({top:event.currentTarget.scrollTop,left:event.currentTarget.scrollLeft})}><table className="table public-companies-table"><thead><tr><th scope="col" className="bookmark-column">Save</th>{SORT_COLUMNS.map(column => <th key={column.key} aria-sort={sort.key === column.key ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}><button type="button" className="industry-sort" onClick={() => toggleSort(column.key)} title={`Sort ${column.label} ${sort.key === column.key && sort.direction === 'asc' ? 'descending' : 'ascending'}`}><span>{column.label}</span><span className={sort.key === column.key ? 'sort-arrow active' : 'sort-arrow'} aria-hidden="true">{sort.key === column.key ? (sort.direction === 'asc' ? '▲' : '▼') : '▴▾'}</span></button></th>)}<th>Linked awards</th></tr></thead><tbody>{rows.map(row => <tr key={row.uen}>
        <td className="bookmark-column" data-label="Save"><SaveCompanyButton uen={row.uen} /></td><td className="cell-primary" data-label="Company"><CompanyLink uen={row.uen}>{row.name ?? row.uen}</CompanyLink></td><td className="cell-id" data-label="UEN">{row.uen}</td><td data-label="Registry status"><RegistryStatusBadge status={row.status} /></td><td className="cell-nowrap" data-label="Registered">{formatDate(row.incorporation_date)}</td><td data-label="Primary activity">{row.primary_activity ? `${row.primary_activity.code} — ${row.primary_activity.title ?? 'No title'}` : '—'}</td><td data-label="Linked awards"><LinkedAwardBadge hasLinkedAward={row.has_linked_award} /></td>
      </tr>)}</tbody></table></div> : <EmptyState title={offset ? "No companies on this page" : "No companies found"}>{offset ? "Choose a lower page number or use First page below." : "Try another company name or filter."}</EmptyState>)}
      <PanelFooter><div className="public-company-pagination">
        <span className="muted-text">Page {Math.floor(offset / pageSize)+1} · {rows.length ? `Showing ${offset+1}–${offset+rows.length}` : 'No results on this page'}</span>
        <div className="agency-pagination-controls">
          <label className="agency-page-size">Results per page<select className="input" value={pageSize} disabled={isLoading} onChange={event=>{const size=Number(event.target.value);const page=Math.floor(offset/pageSize);setPageSize(size);setOffset(page*size);resetTable()}}>{[10,25,50].map(size=><option key={size} value={size}>{size}</option>)}</select></label>
          <form className="company-page-jump" onSubmit={event=>{event.preventDefault();const page=Number(pageDraft);if(Number.isSafeInteger(page)&&page>=1&&page<=1000000){setOffset((page-1)*pageSize);resetTable()}}}>
            <label htmlFor="public-company-page">Page</label><input id="public-company-page" className="input" type="number" min={1} max={1000000} step={1} required value={pageDraft} disabled={isLoading} aria-describedby="public-company-page-help" onChange={event=>setPageDraft(event.target.value)} /><span id="public-company-page-help">Press Enter</span>
          </form>
          <button type="button" className="button button-secondary button-sm" disabled={isLoading || offset===0} onClick={()=>{setOffset(0);resetTable()}}>First page</button>
          <button type="button" className="button button-secondary button-sm" disabled={isLoading || offset===0} onClick={()=>{setOffset(x=>Math.max(0,x-pageSize));resetTable()}}>Previous</button>
          <button type="button" className="button button-secondary button-sm" disabled={isLoading || !isLiveData(result) || !result.meta?.pagination.has_more} onClick={()=>{setOffset(x=>x+pageSize);resetTable()}}>Next</button>
        </div>
      </div></PanelFooter>
    </Panel>
  </>
}
