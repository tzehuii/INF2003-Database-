// Section layout plus the tender and award search lists.
//
// Features this file covers:
// - Switch between the Tenders list and the flat Awards list.
// - Search, filter, sort and page through either list in the selected database.
// - Edit or delete an award straight from the Awards list.

import { useEffect, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { NavLink, Outlet, useNavigate, useOutletContext } from 'react-router-dom'
import { apiRequest } from '../../api/client'
import { useApiResource } from '../../api/useApiResource'
import type { ApiResource } from '../../api/useApiResource'
import { useBreadcrumbTrail } from '../../breadcrumbContext'
import { ConfirmationBanner, EmptyState, InlineError, PageHeading, Panel, PanelFooter } from '../../components/ui'
import { useDatabase } from '../../databaseContext'
import { AwardForm } from './forms'
import { API, AWARDS_PATH, Field, OptionSelect, Paging, TENDERS_PATH, TenderStatusBadge, dbLabel, emptyAwardFilters, emptyTenderFilters, formatSgd, rangeError, tenderPath, useTenderOptions } from './shared'
import type { AwardFilters, AwardRow, ListState, ResultPage, SectionState, Tender, TenderFilters } from './shared'

const PAGE_SIZE = 25

// Hold both lists' submitted filters and page numbers while detail screens are open.
export default function TendersAwardsPage() {
  const [tenderFilters, setTenderFilters] = useState(emptyTenderFilters)
  const [tenderPage, setTenderPage] = useState(1)
  const [awardFilters, setAwardFilters] = useState(emptyAwardFilters)
  const [awardPage, setAwardPage] = useState(1)
  const state: SectionState = {
    tenders: { applied: tenderFilters, setApplied: setTenderFilters, page: tenderPage, setPage: setTenderPage },
    awards: { applied: awardFilters, setApplied: setAwardFilters, page: awardPage, setPage: setAwardPage },
  }
  return <Outlet context={state} />
}

export function useSectionState() {
  return useOutletContext<SectionState>()
}

// Heading and the Tenders / Awards switch shared by both list screens.
function ListHeading({ actions }: { actions?: ReactNode }) {
  const { database } = useDatabase()
  return <>
    <PageHeading title="Tenders & Awards" description={`Manage GeBIZ tenders and their supplier awards in ${dbLabel(database)}.`} actions={actions} />
    <div className="segmented tender-tabs" role="group" aria-label="Choose list">
      <NavLink end to={TENDERS_PATH} className={({ isActive }) => isActive ? 'segmented-option segmented-option-active' : 'segmented-option'}>Tenders</NavLink>
      <NavLink to={AWARDS_PATH} className={({ isActive }) => isActive ? 'segmented-option segmented-option-active' : 'segmented-option'}>Awards</NavLink>
    </div>
  </>
}

// retain rows and paging during switches; old database actions stay disabled until refreshed.
function useStableResults<T>(resource: ApiResource<ResultPage<T>>) {
  const { database } = useDatabase()
  const previous = useRef<ResultPage<T> | null>(null)
  const result = resource.result
  const current = result?.state === 'success' && result.database === database ? result.body : null
  if (current) previous.current = current
  const refreshing = resource.isLoading || (result !== null && result.database !== database)
  return { data: current ?? (refreshing ? previous.current : null), refreshing, failure: !refreshing && result && result.state !== 'success' ? result.message : null }
}

// Shared filter controls: agency, status, date range and amount range.
function CommonFilters<F extends TenderFilters | AwardFilters>({ filters, setFilters, amountLabel }: { filters: F; setFilters: (update: (f: F) => F) => void; amountLabel: string }) {
  const options = useTenderOptions()
  const set = (key: keyof F) => (value: string) => setFilters(f => ({ ...f, [key]: value }))
  return <>
    <Field label="Government agency"><OptionSelect value={filters.agency} onChange={set('agency')} options={options.agencies} placeholder="All agencies" /></Field>
    <Field label="Tender status"><OptionSelect value={filters.status} onChange={set('status')} options={options.statuses} placeholder="All statuses" /></Field>
    <Field label="Awarded from"><input className="input" type="date" value={filters.award_from} onChange={e => set('award_from')(e.target.value)} /></Field>
    <Field label="Awarded to"><input className="input" type="date" value={filters.award_to} onChange={e => set('award_to')(e.target.value)} /></Field>
    <Field label={`Minimum ${amountLabel} (S$)`}><input className="input" inputMode="decimal" placeholder="e.g. 50000" value={filters.min_amount} onChange={e => set('min_amount')(e.target.value)} /></Field>
    <Field label={`Maximum ${amountLabel} (S$)`}><input className="input" inputMode="decimal" placeholder="e.g. 1000000" value={filters.max_amount} onChange={e => set('max_amount')(e.target.value)} /></Field>
  </>
}

// Draft filters stay local until "Search / filter" submits them to the section state.
function useFilterForm<F extends TenderFilters | AwardFilters>(list: ListState<F>, empty: F, reload: () => void) {
  const [filters, setFilters] = useState<F>(list.applied)
  const [error, setError] = useState('')
  function apply(event: FormEvent) {
    event.preventDefault()
    const problem = rangeError(filters)
    setError(problem)
    if (problem) return
    // Re-running an identical search still refreshes the results.
    if (JSON.stringify(filters) === JSON.stringify(list.applied) && list.page === 1) reload()
    list.setApplied({ ...filters }); list.setPage(1)
  }
  function reset() { setFilters(empty); setError(''); list.setApplied(empty); list.setPage(1) }
  return { filters, setFilters, error, apply, reset }
}

// ------------------------------------------------------------------ tenders --

export function TendersListPage() {
  const { database } = useDatabase()
  const navigate = useNavigate()
  const { tenders: list } = useSectionState()
  const resource = useApiResource<ResultPage<Tender>>(API.tenders, { ...list.applied, page: list.page, limit: PAGE_SIZE }, '', {}, true)
  const { data, refreshing, failure } = useStableResults<Tender>(resource)
  const form = useFilterForm<TenderFilters>(list, emptyTenderFilters, resource.reload)
  const set = (key: keyof TenderFilters) => (value: string) => form.setFilters(f => ({ ...f, [key]: value }))

  return <>
    <ListHeading actions={<button className="button button-primary" onClick={() => navigate(`${TENDERS_PATH}/new`)}>Add tender</button>} />
    {form.error && <InlineError title="Check the filters">{form.error}</InlineError>}
    <Panel title="Tender directory">
      <form onSubmit={form.apply} className="company-filters"><fieldset className="company-form-grid tender-filter-grid">
        <Field label="Tender number or description" wide><input className="input" type="search" maxLength={500} placeholder="e.g. ACR000ETT21000001 or cleaning services" value={form.filters.q} onChange={e => set('q')(e.target.value)} /></Field>
        <Field label="Supplier name contains"><input className="input" maxLength={500} value={form.filters.supplier} onChange={e => set('supplier')(e.target.value)} /></Field>
        <CommonFilters filters={form.filters} setFilters={form.setFilters} amountLabel="total" />
        <Field label="Sort by"><select className="input" value={form.filters.sort} onChange={e => set('sort')(e.target.value)}>
          <option value="date_desc">Newest award date</option><option value="date_asc">Oldest award date</option>
          <option value="amount_desc">Highest total amount</option><option value="amount_asc">Lowest total amount</option>
          <option value="tender_no">Tender number</option>
        </select></Field>
        <div className="company-actions"><button className="button button-primary">Search / filter</button><button type="button" className="button button-secondary" onClick={form.reset}>Reset</button></div>
      </fieldset></form>
      <div className="company-results-region" aria-busy={refreshing}>
        {refreshing && <div className="company-table-loading" role="status"><span>Loading {dbLabel(database)} results…</span></div>}
        {failure ? <InlineError title="Could not load tenders" action={<button className="button button-secondary" onClick={resource.reload}>Retry</button>}>{failure}</InlineError>
          : data?.items.length === 0 ? <EmptyState title="No matching tenders">Try another search or reset the filters.</EmptyState>
          : <div className="company-table-scroll"><table className="company-table tender-table">
            <thead><tr><th>Tender no.</th><th>Description</th><th>Agency</th><th>Status</th><th>Award date</th><th className="tender-number">Awards</th><th className="tender-number">Total awarded</th><th><span className="visually-hidden">Actions</span></th></tr></thead>
            <tbody>{data?.items.map(t => <tr key={t.tender_no}>
              <td>{t.tender_no}</td><td><span className="tender-clamp" title={t.description}>{t.description}</span></td><td className="tender-agency">{t.agency}</td>
              <td><TenderStatusBadge status={t.status} /></td><td className="tender-date">{t.award_date}</td><td className="tender-number">{t.award_count}</td>
              <td className="tender-number">{formatSgd(t.total_amount)}</td>
              <td><button className="button company-navigation-button button-sm" disabled={refreshing} onClick={() => navigate(tenderPath(t.tender_no))}>Manage</button></td>
            </tr>)}</tbody>
          </table></div>}
      </div>
      <PanelFooter><Paging page={list.page} total={data?.total ?? 0} limit={PAGE_SIZE} noun="tenders" disabled={refreshing} onPage={list.setPage} /></PanelFooter>
    </Panel>
  </>
}

// ------------------------------------------------------------------- awards --

export function AwardsListPage() {
  const { database } = useDatabase()
  const navigate = useNavigate()
  const { awards: list } = useSectionState()
  const resource = useApiResource<ResultPage<AwardRow>>(API.awards, { ...list.applied, page: list.page, limit: PAGE_SIZE }, '', {}, true)
  const { data, refreshing, failure } = useStableResults<AwardRow>(resource)
  const form = useFilterForm<AwardFilters>(list, emptyAwardFilters, resource.reload)
  const set = (key: keyof AwardFilters) => (value: string) => form.setFilters(f => ({ ...f, [key]: value }))
  const [editing, setEditing] = useState<AwardRow | null>(null)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useBreadcrumbTrail([{ label: 'Tenders & Awards', to: TENDERS_PATH }, { label: 'Awards' }])

  // An open edit form belongs to one database's award IDs, so close it on a switch.
  useEffect(() => setEditing(null), [database])

  async function remove(row: AwardRow) {
    if (!window.confirm(`Delete the award to ${row.supplier} (${formatSgd(row.amount)}) on tender ${row.tender_no} from ${dbLabel(database)}? This cannot be undone.`)) return
    setBusy(true); setError(''); setNotice('')
    const outcome = await apiRequest<void>(API.award(row.tender_no, row.id), database, {}, { method: 'DELETE' })
    setBusy(false)
    if (outcome.state !== 'success') { setError(outcome.message); return }
    setNotice(`Award deleted from ${dbLabel(database)}.`); resource.reload()
  }

  return <>
    <ListHeading />
    {notice && <ConfirmationBanner onDismiss={() => setNotice('')}>{notice}</ConfirmationBanner>}
    {(form.error || error) && <InlineError title={form.error ? 'Check the filters' : 'Request failed'}>{form.error || error}</InlineError>}
    {editing && <AwardForm key={`${editing.tender_no}-${editing.id}`} tenderNo={editing.tender_no} award={editing}
      onCancel={() => setEditing(null)} onDone={() => { setEditing(null); setNotice(`Award saved to ${dbLabel(database)}.`); resource.reload() }} />}
    {!editing && <Panel title="Award records">
      <form onSubmit={form.apply} className="company-filters"><fieldset className="company-form-grid tender-filter-grid">
        <Field label="Supplier name or tender number" wide><input className="input" type="search" maxLength={500} placeholder="e.g. ALPHA ZETTA or HDB000ETT25000219" value={form.filters.q} onChange={e => set('q')(e.target.value)} /></Field>
        <CommonFilters filters={form.filters} setFilters={form.setFilters} amountLabel="award" />
        <Field label="Sort by"><select className="input" value={form.filters.sort} onChange={e => set('sort')(e.target.value)}>
          <option value="date_desc">Newest award date</option><option value="date_asc">Oldest award date</option>
          <option value="amount_desc">Highest amount</option><option value="amount_asc">Lowest amount</option>
          <option value="supplier">Supplier name</option>
        </select></Field>
        <div className="company-actions"><button className="button button-primary">Search / filter</button><button type="button" className="button button-secondary" onClick={form.reset}>Reset</button></div>
      </fieldset></form>
      <div className="company-results-region" aria-busy={refreshing}>
        {refreshing && <div className="company-table-loading" role="status"><span>Loading {dbLabel(database)} results…</span></div>}
        {failure ? <InlineError title="Could not load awards" action={<button className="button button-secondary" onClick={resource.reload}>Retry</button>}>{failure}</InlineError>
          : data?.items.length === 0 ? <EmptyState title="No matching awards">Try another search or reset the filters.</EmptyState>
          : <div className="company-table-scroll"><table className="company-table tender-table">
            <thead><tr><th>Tender no.</th><th>Supplier</th><th className="tender-number">Amount</th><th>Agency</th><th>Award date</th><th><span className="visually-hidden">Actions</span></th></tr></thead>
            <tbody>{data?.items.map(a => <tr key={`${a.tender_no}-${a.id}`}>
              <td>{a.tender_no}</td><td>{a.supplier}</td><td className="tender-number">{formatSgd(a.amount)}</td><td className="tender-agency">{a.agency}</td>
              <td className="tender-date">{a.award_date}</td>
              <td><div className="company-actions">
                <button className="button company-navigation-button button-sm" disabled={busy || refreshing} onClick={() => navigate(tenderPath(a.tender_no))}>Open tender</button>
                <button className="button company-edit-button button-sm" disabled={busy || refreshing} onClick={() => { setNotice(''); setError(''); setEditing(a) }}>Edit</button>
                <button className="button company-delete-button button-sm" disabled={busy || refreshing} onClick={() => remove(a)}>Delete</button>
              </div></td>
            </tr>)}</tbody>
          </table></div>}
      </div>
      <PanelFooter><Paging page={list.page} total={data?.total ?? 0} limit={PAGE_SIZE} noun="awards" disabled={refreshing} onPage={list.setPage} /></PanelFooter>
    </Panel>}
  </>
}
