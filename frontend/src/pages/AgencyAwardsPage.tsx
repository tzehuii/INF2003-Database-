import { useEffect, useState } from 'react'
import { useVisitState } from '../visitState'
import CompanyLink from '../components/CompanyLink'
import { API_ROUTES, isLiveData } from '../api/client'
import type { AgenciesData, AgencyAwardsData } from '../api/client'
import { useApiResource } from '../api/useApiResource'
import { EmptyState, PageHeading, Panel, PanelFooter } from '../components/ui'
import { formatMoney, formatPercent } from '../format'
import { ResourceStatus } from './publicShared'
import AgencyAwardsChart from './AgencyAwardsChart'
const EMPTY = { agency: '', start: '', end: '', above: false }
export default function AgencyAwardsPage() {
  const [draft, setDraft] = useVisitState('agency:draft', EMPTY)
  const [filters, setFilters] = useVisitState('agency:filters', EMPTY)
  const [pageSize, setPageSize] = useVisitState('agency:page-size', 25)
  const [offset, setOffset] = useVisitState('agency:offset', 0)
  const [pageDraft, setPageDraft] = useState("1")
  useEffect(() => { setPageDraft(String(offset / pageSize + 1)) }, [offset, pageSize])
  const agencies = useApiResource<AgenciesData>(API_ROUTES.agencies, { limit: 100 }, '', {}, true)
  const moreAgencies = useApiResource<AgenciesData>(API_ROUTES.agencies, { limit: 100, offset: 100 }, '', {}, true)
  // two agency requests share one failure notice and retry action.
  const agencyFailure = [agencies.result, moreAgencies.result].find(result => result && result.state !== 'success') ?? null
  const agenciesLoading = agencies.isLoading || moreAgencies.isLoading
  const names = [...(isLiveData(agencies.result) ? agencies.result.body.items : []), ...(isLiveData(moreAgencies.result) ? moreAgencies.result.body.items : [])]
  const firstAgency = names[0]?.agency_name ?? ''
  const agency = filters.agency || firstAgency
  const { result, isLoading } = useApiResource<AgencyAwardsData>(agency ? API_ROUTES.agencyAwards : null, { agency_name: agency, start_date: filters.start, end_date: filters.end, above_average_only: filters.above, limit: pageSize, offset }, '', {}, true)
  const data = isLiveData(result) ? result.body : null
  const pageCount = Math.max(1, Math.ceil((data?.summary.matching_supplier_count ?? 0) / pageSize))
  return <>
    <PageHeading icon="agency" title="Agency Awards" description="Compare supplier awards for a government agency and period." />
    <Panel title="Supplier awards">
      <form className="toolbar" onSubmit={e => { e.preventDefault(); setFilters({ ...draft, agency: draft.agency || firstAgency }); setOffset(0) }}>
        <div className="toolbar-row toolbar-row-fields">
          <label className="field field-grow"><span className="field-label">Agency</span><select className="input" value={draft.agency || firstAgency} onChange={e => setDraft({ ...draft, agency: e.target.value })}>{!names.length && <option value={draft.agency}>{draft.agency || (agenciesLoading ? 'Loading agencies…' : agencyFailure ? 'Agencies unavailable' : 'No agencies available')}</option>}{names.map(x => <option key={x.agency_name}>{x.agency_name}</option>)}</select></label>
          <label className="field"><span className="field-label">Start date</span><input className="input" type="date" value={draft.start} onChange={e => setDraft({ ...draft, start: e.target.value })} /></label>
          <label className="field"><span className="field-label">End date</span><input className="input" type="date" min={draft.start || undefined} value={draft.end} onChange={e => setDraft({ ...draft, end: e.target.value })} /></label>
          <label className="checkbox-item"><input type="checkbox" checked={draft.above} onChange={e => setDraft({ ...draft, above: e.target.checked })} />Above average only</label>
          <button className="button button-primary" disabled={!firstAgency}>Search</button><button type="button" className="button button-secondary" onClick={() => { setDraft(EMPTY); setFilters(EMPTY); setOffset(0) }}>Reset</button>
        </div>
      </form>
      <ResourceStatus result={agencyFailure} loading={agenciesLoading && !names.length} />{agencyFailure && <div className="panel-pad"><button type="button" className="button button-secondary" onClick={()=>{agencies.reload();moreAgencies.reload()}}>Retry agencies</button></div>}{!agencyFailure && <ResourceStatus result={result} loading={isLoading && !data} />}
      {data && <>
        <div className="stat-band"><dl className="stat-strip"><div className="stat"><dt className="stat-label">Suppliers</dt><dd className="stat-value">{data.summary.supplier_count}</dd></div><div className="stat"><dt className="stat-label">Tenders</dt><dd className="stat-value">{data.summary.tender_count}</dd></div><div className="stat"><dt className="stat-label">Total awards (SGD)</dt><dd className="stat-value">{formatMoney(data.summary.total_award_amount)}</dd></div></dl><p className="stat-footnote">{data.summary.excluded_no_supplier_tender_count} tenders without supplier awards excluded. Average supplier total: {formatMoney(data.summary.average_supplier_total)}.</p></div>
        <AgencyAwardsChart agency={agency} start={filters.start} end={filters.end} above={filters.above} />
        {data.items.length ? <div className="table-scroll"><table className="table"><thead><tr><th>Supplier</th><th className="cell-number">Total awards (SGD)</th><th className="cell-number">Tenders</th><th className="cell-number">Share</th><th>Linked company</th></tr></thead><tbody>{data.items.map(row => <tr key={row.supplier_name}><td className="cell-primary">{row.supplier_name}</td><td className="cell-number">{formatMoney(row.total_award_amount)}</td><td className="cell-number">{row.tender_count}</td><td className="cell-number">{formatPercent(row.share_percent)}</td><td>{row.company_link.uen ? <CompanyLink uen={row.company_link.uen}>{row.company_link.name ?? row.company_link.uen}</CompanyLink> : 'No confirmed company link'}</td></tr>)}</tbody></table></div> : <EmptyState title="No awards found">Try a different date range or agency.</EmptyState>}
      </>}
      <PanelFooter>
        {/* Keep page navigation together; changing page size keeps the search and current page where possible. */}
        <div className="agency-pagination">
          <span className="muted-text">Showing {data?.items.length ?? 0} results</span>
          <div className="agency-pagination-controls">
            <label className="agency-page-size">Results per page
              <select className="input" value={pageSize} disabled={isLoading} onChange={event => { const size = Number(event.target.value); const currentPage = offset / pageSize + 1; const lastPage = Math.max(1, Math.ceil((data?.summary.matching_supplier_count ?? 0) / size)); setPageSize(size); setOffset((Math.min(currentPage, lastPage) - 1) * size) }}>
                {[10, 25, 50].map(size => <option key={size} value={size}>{size}</option>)}
              </select>
            </label>
            <form className="company-page-jump" onSubmit={event => { event.preventDefault(); const target = Number(pageDraft); if (Number.isInteger(target) && target >= 1 && target <= pageCount) setOffset((target - 1) * pageSize) }}>
              <label htmlFor="agency-page">Page</label>
              <input id="agency-page" title="Type a page number and press Enter" className="input" type="number" min={1} max={pageCount} step={1} required value={pageDraft} disabled={isLoading || !data} onChange={event => setPageDraft(event.target.value)} />
              <span>of {pageCount}</span>
            </form>
            <button type="button" className="button button-secondary button-sm" disabled={isLoading || offset === 0} onClick={() => setOffset(x => Math.max(0, x - pageSize))}>Previous</button>
            <button type="button" className="button button-secondary button-sm" disabled={isLoading || !isLiveData(result) || !result.meta?.pagination.has_more} onClick={() => setOffset(x => x + pageSize)}>Next</button>
          </div>
        </div>
      </PanelFooter>
    </Panel>
  </>
}
