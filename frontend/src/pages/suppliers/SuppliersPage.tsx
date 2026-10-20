// Section layout plus the supplier search list.
//
// Features this file covers:
// - Search suppliers by name in the selected database.
// - Filter by company link, awards, government agency and total awarded amount, with sorting and paging.
// - See how many suppliers are linked to a company, and jump to each group from the company-links bar.
// - Open a supplier to manage it, or add a new one.

import { useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Outlet, useNavigate, useOutletContext } from 'react-router-dom'
import { useApiResource } from '../../api/useApiResource'
import { EmptyState, InlineError, PageHeading, Panel, PanelFooter } from '../../components/ui'
import { useDatabase } from '../../databaseContext'
import { Field, OptionSelect, Paging, dbLabel, formatSgd, isAmount, useTenderOptions } from '../tendersAwards/shared'
import type { ResultPage } from '../tendersAwards/shared'
import { API, LINK_OPTIONS, LinkBadge, SUPPLIERS_PATH, emptySupplierFilters, supplierPath } from './shared'
import type { SupplierFilters, SupplierListState, SupplierRow } from './shared'
import SupplierMatchBar from './SupplierMatchBar'

const PAGE_SIZE = 25

// Hold the submitted filters and page number while a supplier is open.
export default function SuppliersPage() {
  const [applied, setApplied] = useState(emptySupplierFilters)
  const [page, setPage] = useState(1)
  const state: SupplierListState = { applied, setApplied, page, setPage }
  return <Outlet context={state} />
}

function useListState() {
  return useOutletContext<SupplierListState>()
}

// Reject a bad amount range before sending a request; the backend repeats the check.
function rangeError(filters: SupplierFilters) {
  for (const key of ['min_total', 'max_total'] as const) {
    if (filters[key] && !isAmount(filters[key])) return 'Amounts must be numbers with at most 2 decimal places, for example 50000 or 1250.50.'
  }
  if (filters.min_total && filters.max_total && Number(filters.min_total) > Number(filters.max_total)) return 'The minimum amount must not be more than the maximum amount.'
  return ''
}

export function SuppliersListPage() {
  const { database } = useDatabase()
  const navigate = useNavigate()
  const list = useListState()
  const options = useTenderOptions()
  const resource = useApiResource<ResultPage<SupplierRow>>(API.suppliers, { ...list.applied, page: list.page, limit: PAGE_SIZE })
  const [filters, setFilters] = useState(list.applied)
  const [error, setError] = useState('')
  const set = (key: keyof SupplierFilters) => (value: string) => setFilters(f => ({ ...f, [key]: value }))

  // Keep the previous rows visible (but inactive) while a new page or database loads.
  const previous = useRef<ResultPage<SupplierRow> | null>(null)
  const result = resource.result
  const current = result?.state === 'success' && result.database === database ? result.body : null
  if (current) previous.current = current
  const refreshing = resource.isLoading || (result !== null && result.database !== database)
  const data = current ?? (refreshing ? previous.current : null)
  const failure = !refreshing && result && result.state !== 'success' ? result.message : null

  function apply(event: FormEvent) {
    event.preventDefault()
    const problem = rangeError(filters)
    setError(problem)
    if (problem) return
    // Re-running an identical search still refreshes the results.
    if (JSON.stringify(filters) === JSON.stringify(list.applied) && list.page === 1) resource.reload()
    list.setApplied({ ...filters }); list.setPage(1)
  }

  function reset() { setFilters(emptySupplierFilters); setError(''); list.setApplied(emptySupplierFilters); list.setPage(1) }

  // A part of the company-links bar sets only the link filter and searches straight away.
  function showLinkStatus(link: string) {
    const next = { ...list.applied, link }
    setFilters(f => ({ ...f, link })); setError('')
    list.setApplied(next); list.setPage(1)
  }

  return <>
    <PageHeading title="Suppliers" description={`Manage GeBIZ suppliers and their links to registered companies in ${dbLabel(database)}.`}
      actions={<button className="button button-primary" onClick={() => navigate(`${SUPPLIERS_PATH}/new`)}>Add supplier</button>} />
    {error && <InlineError title="Check the filters">{error}</InlineError>}
    <SupplierMatchBar active={list.applied.link} onSelect={showLinkStatus} />
    <Panel title="Supplier directory">
      <form onSubmit={apply} className="company-filters"><fieldset className="company-form-grid tender-filter-grid">
        <Field label="Supplier name contains" wide><input className="input" type="search" maxLength={500} placeholder="e.g. ALPHA ZETTA or engineering" value={filters.q} onChange={e => set('q')(e.target.value)} /></Field>
        <Field label="Company link"><select className="input" value={filters.link} onChange={e => set('link')(e.target.value)}>
          <option value="">Any link status</option>
          {LINK_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select></Field>
        <Field label="Awards"><select className="input" value={filters.awards} onChange={e => set('awards')(e.target.value)}>
          <option value="">With or without awards</option><option value="with">Has awards</option><option value="without">No awards yet</option>
        </select></Field>
        <Field label="Awarded by agency"><OptionSelect value={filters.agency} onChange={set('agency')} options={options.agencies} placeholder="Any agency" /></Field>
        <Field label="Sort by"><select className="input" value={filters.sort} onChange={e => set('sort')(e.target.value)}>
          <option value="name_asc">Name A–Z</option><option value="name_desc">Name Z–A</option>
          <option value="total_desc">Highest total awarded</option><option value="total_asc">Lowest total awarded</option>
          <option value="awards_desc">Most awards</option>
        </select></Field>
        <Field label="Minimum total awarded (S$)"><input className="input" inputMode="decimal" placeholder="e.g. 50000" value={filters.min_total} onChange={e => set('min_total')(e.target.value)} /></Field>
        <Field label="Maximum total awarded (S$)"><input className="input" inputMode="decimal" placeholder="e.g. 1000000" value={filters.max_total} onChange={e => set('max_total')(e.target.value)} /></Field>
        <div className="company-actions"><button className="button button-primary">Search / filter</button><button type="button" className="button button-secondary" onClick={reset}>Reset</button></div>
      </fieldset></form>
      <div className="company-results-region" aria-busy={refreshing}>
        {refreshing && <div className="company-table-loading" role="status"><span>Loading {dbLabel(database)} results…</span></div>}
        {failure ? <InlineError title="Could not load suppliers" action={<button className="button button-secondary" onClick={resource.reload}>Retry</button>}>{failure}</InlineError>
          : data?.items.length === 0 ? <EmptyState title="No matching suppliers">Try another search or reset the filters.</EmptyState>
          : <div className="company-table-scroll"><table className="company-table tender-table supplier-table">
            <thead><tr><th>Supplier</th><th>Company link</th><th className="tender-number">Awards</th><th className="tender-number">Total awarded</th><th><span className="visually-hidden">Actions</span></th></tr></thead>
            <tbody>{data?.items.map(s => <tr key={s.name}>
              <td>{s.name}</td>
              <td><div className="supplier-link-cell">
                <LinkBadge status={s.link.status} candidates={s.link.candidate_count} />
                {s.link.company_uen && <span className="supplier-company">{s.link.company_name ?? 'Unknown company'} <span className="mono">{s.link.company_uen}</span></span>}
              </div></td>
              <td className="tender-number">{s.award_count}</td>
              <td className="tender-number">{formatSgd(s.total_amount)}</td>
              <td><button className="button company-navigation-button button-sm" disabled={refreshing} onClick={() => navigate(supplierPath(s.name))}>Manage</button></td>
            </tr>)}</tbody>
          </table></div>}
      </div>
      <PanelFooter><Paging page={list.page} total={data?.total ?? 0} limit={PAGE_SIZE} noun="suppliers" disabled={refreshing} onPage={list.setPage} /></PanelFooter>
    </Panel>
  </>
}
