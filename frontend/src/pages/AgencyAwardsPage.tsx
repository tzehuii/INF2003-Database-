import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { API_ROUTES, isLiveData } from '../api/client'
import type { AgenciesData, AgencyAwardsData } from '../api/client'
import { useApiResource } from '../api/useApiResource'
import { EmptyState, PageHeading, Pagination, Panel, PanelFooter } from '../components/ui'
import { formatMoney, formatPercent } from '../format'
import { ResourceStatus } from './publicShared'
const SIZE = 25
const EMPTY = { agency: '', start: '', end: '', above: false }
export default function AgencyAwardsPage() {
  const [draft, setDraft] = useState(EMPTY)
  const [filters, setFilters] = useState(EMPTY)
  const [offset, setOffset] = useState(0)
  const agencies = useApiResource<AgenciesData>(API_ROUTES.agencies, { limit: 100 })
  const moreAgencies = useApiResource<AgenciesData>(API_ROUTES.agencies, { limit: 100, offset: 100 })
  const names = [...(isLiveData(agencies.result) ? agencies.result.body.items : []), ...(isLiveData(moreAgencies.result) ? moreAgencies.result.body.items : [])]
  const firstAgency = names[0]?.agency_name ?? ''
  useEffect(() => { setDraft(EMPTY); setFilters(EMPTY); setOffset(0) }, [agencies.result?.database])
  const agency = filters.agency || firstAgency
  const { result, isLoading } = useApiResource<AgencyAwardsData>(agency ? API_ROUTES.agencyAwards : null, { agency_name: agency, start_date: filters.start, end_date: filters.end, above_average_only: filters.above, limit: SIZE, offset })
  const data = isLiveData(result) ? result.body : null
  return <>
    <PageHeading icon="agency" title="Agency Awards" description="Compare supplier awards for a government agency and period." />
    <Panel title="Supplier awards">
      <form className="toolbar" onSubmit={e => { e.preventDefault(); setFilters({ ...draft, agency: draft.agency || firstAgency }); setOffset(0) }}>
        <div className="toolbar-row toolbar-row-fields">
          <label className="field field-grow"><span className="field-label">Agency</span><select className="input" value={draft.agency || firstAgency} onChange={e => setDraft({ ...draft, agency: e.target.value })}>{!names.length && <option value="">Loading agencies…</option>}{names.map(x => <option key={x.agency_name}>{x.agency_name}</option>)}</select></label>
          <label className="field"><span className="field-label">Start date</span><input className="input" type="date" value={draft.start} onChange={e => setDraft({ ...draft, start: e.target.value })} /></label>
          <label className="field"><span className="field-label">End date</span><input className="input" type="date" min={draft.start || undefined} value={draft.end} onChange={e => setDraft({ ...draft, end: e.target.value })} /></label>
          <label className="checkbox-item"><input type="checkbox" checked={draft.above} onChange={e => setDraft({ ...draft, above: e.target.checked })} />Above average only</label>
          <button className="button button-primary" disabled={!firstAgency}>Search</button><button type="button" className="button button-secondary" onClick={() => { setDraft(EMPTY); setFilters(EMPTY); setOffset(0) }}>Reset</button>
        </div>
      </form>
      <ResourceStatus result={agencies.result} loading={agencies.isLoading} /><ResourceStatus result={moreAgencies.result} loading={false} /><ResourceStatus result={result} loading={isLoading} />
      {data && <>
        <div className="stat-band"><dl className="stat-strip"><div className="stat"><dt className="stat-label">Suppliers</dt><dd className="stat-value">{data.summary.supplier_count}</dd></div><div className="stat"><dt className="stat-label">Tenders</dt><dd className="stat-value">{data.summary.tender_count}</dd></div><div className="stat"><dt className="stat-label">Total awards (SGD)</dt><dd className="stat-value">{formatMoney(data.summary.total_award_amount)}</dd></div></dl><p className="stat-footnote">{data.summary.excluded_no_supplier_tender_count} tenders without supplier awards excluded. Average supplier total: {formatMoney(data.summary.average_supplier_total)}.</p></div>
        {data.items.length ? <div className="table-scroll"><table className="table"><thead><tr><th>Supplier</th><th className="cell-number">Total awards (SGD)</th><th className="cell-number">Tenders</th><th className="cell-number">Share</th><th>Linked company</th></tr></thead><tbody>{data.items.map(row => <tr key={row.supplier_name}><td className="cell-primary">{row.supplier_name}</td><td className="cell-number">{formatMoney(row.total_award_amount)}</td><td className="cell-number">{row.tender_count}</td><td className="cell-number">{formatPercent(row.share_percent)}</td><td>{row.company_link.uen ? <Link className="row-link" to={`/companies/${encodeURIComponent(row.company_link.uen)}`}>{row.company_link.name ?? row.company_link.uen}</Link> : 'No confirmed company link'}</td></tr>)}</tbody></table></div> : <EmptyState title="No awards found">Try a different date range or agency.</EmptyState>}
      </>}
      <PanelFooter><Pagination count={data?.items.length ?? 0} hasPrevious={!isLoading && offset > 0} hasNext={!isLoading && isLiveData(result) && !!result.meta?.pagination.has_more} onPrevious={() => setOffset(x => Math.max(0, x - SIZE))} onNext={() => setOffset(x => x + SIZE)} /></PanelFooter>
    </Panel>
  </>
}
