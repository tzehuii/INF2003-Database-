// OWNER: Tzehui - Companies & Addresses page (System view)
// Company/address forms, directory search, combined filters and pagination.
//
// Features this file covers:
// - Display companies and addresses from the selected database.
// - Submit create/edit forms and request confirmed deletions.
// - Show validation errors and refresh records after successful changes.

// Import React state, API helpers and shared interface components.
import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import type { FormEvent } from 'react'
import { apiRequest } from '../api/client'
import type { Address } from '../api/client'
import { useApiResource } from '../api/useApiResource'
import { useDatabase } from '../databaseContext'
import AddressMap from '../components/AddressMap'
import { ConfirmationBanner, EmptyState, InlineError, PageHeading, Panel, PanelFooter, RegistryStatusBadge, SkeletonRows } from '../components/ui'

const BASE = '/api/system/companies'
type CompanyAddress = Address & { id: string }
type Company = { uen: string; name: string | null; status: string | null; registration_date: string | null; addresses: CompanyAddress[]; former_names?: string[] }
type Results = { items: Company[]; has_more: boolean; next_after: string | null }
// Shared field definitions keep address forms and detail labels consistent.
const addressLabels: [keyof Address, string, number][] = [
  ['type', 'Address type', 30], ['block', 'Block', 30], ['street_name', 'Street name', 255],
  ['level_no', 'Level', 20], ['unit_no', 'Unit', 20], ['building_name', 'Building name', 255],
  ['postal_code', 'Postal code', 20], ['other_address_line1', 'Other address line 1', 500],
  ['other_address_line2', 'Other address line 2', 500],
]
// Same ACRA UEN formats the backend accepts: business, local company and other entities.
const UEN_PATTERN = '[0-9]{8}[A-Z]|[0-9]{9}[A-Z]|[STR][0-9]{2}[A-Z]{2}[0-9]{4}[A-Z]'
// Local date as YYYY-MM-DD, used as the latest allowed registration date.
const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10)
const emptyFilters ={ q: '', status: '', postal_code: '', street: '', registered_from: '', registered_to: '' }
type Editor = { kind: 'company'; company?: Company } | { kind: 'address'; company: Company; address?: CompanyAddress }

// Load status choices from the selected database, retaining an existing draft selection.
function StatusSelect({ value, onChange, required = false }: { value: string; onChange: (value: string) => void; required?: boolean }) {
  const statuses = useApiResource<{ items: string[] }>(`${BASE}/statuses`, {}, '', {}, true)
  const result = statuses.result
  const items = result?.state === 'success' ? result.body.items : []
  const choices = Array.from(new Set([...(value ? [value] : []), ...items])).sort()
  // A positioned menu always opens below the field; the browser cannot flip it upward.
  return <>
    <details className="status-picker" onKeyDown={event => { if (event.key === 'Escape') event.currentTarget.open = false }}>
      <summary className="input">{value || (required ? 'Select registration status' : 'All statuses')}<span aria-hidden="true">▾</span></summary>
      <ul className="status-options" aria-label="Registration status options">
        {['', ...choices].map(status => <li key={status}><button type="button" aria-pressed={value === status} onClick={event => { onChange(status); event.currentTarget.closest('details')?.removeAttribute('open') }}>{status || (required ? 'Select registration status' : 'All statuses')}</button></li>)}
      </ul>
    </details>
    {statuses.isLoading && !items.length && <small>Loading available statuses…</small>}
    {!statuses.isLoading && result && result.state !== 'success' && <small role="alert">Could not load statuses. Restart the backend if it has not loaded the new route. <button type="button" onClick={statuses.reload}>Retry</button></small>}
  </>
}

// Reuse one form for create/edit; existing UENs remain unchanged.
function CompanyForm({ company, onDone, onCancel }: { company?: Company; onDone: (company: Company) => void; onCancel: () => void }) {
  const { database } = useDatabase()
  const currentDatabase = useRef(database)
  currentDatabase.current = database
  const [uen, setUen] = useState(company?.uen ?? '')
  const [name, setName] = useState(company?.name ?? '')
  const [status, setStatus] = useState(company?.status ?? '')
  const [registrationDate, setRegistrationDate] = useState(company?.registration_date ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // Save this form through its create/edit API route and display validation errors.
  async function submit(event: FormEvent) {
    event.preventDefault(); setError('')
    if (!status) { setError('Choose a registration status.'); return }
    setBusy(true)
    // Existing companies send editable fields only; new companies also send their UEN.
    const body = { name, status, registration_date: registrationDate || null, ...(company ? {} : { uen }) }
    const result = await apiRequest<Company>(company ? `${BASE}/${encodeURIComponent(company.uen)}` : BASE, database, {}, { method: company ? 'PATCH' : 'POST', body })
    setBusy(false)
    if (currentDatabase.current !== database) { setError('The request finished for the previous database. Your draft is kept; check that database for its result.'); return }
    if (result.state === 'success') onDone(result.body)
    else setError(result.message)
  }
  return <Panel title={company ? `Edit ${company.uen}` : 'Add company'}>
    <form onSubmit={submit}>
      <p className="company-save-target" role="status">Saving to <strong>{database === 'mariadb' ? 'MariaDB' : 'MongoDB'}</strong>. Switching databases keeps your draft; Save writes only to the selected database.</p>
      <fieldset disabled={busy} className="company-form-grid">
        <label className="field">UEN<input className="input" required pattern={UEN_PATTERN} title="9 or 10 characters, for example 53012345D, 196800306E or T08LL1234A" maxLength={10} value={uen} disabled={!!company} onChange={e => setUen(e.target.value.toUpperCase().trim())} /><small>{company ? 'The UEN cannot be changed after creation.' : 'ACRA format, for example 53012345D, 196800306E or T08LL1234A. Cannot be changed later.'}</small></label>
        <label className="field">Company name<input className="input" required maxLength={500} value={name} onChange={e => setName(e.target.value)} /></label>
        <label className="field">Registration status<StatusSelect value={status} onChange={setStatus} required /></label>
        <label className="field">Registration date<input className="input" type="date" min="1800-01-01" max={today()} value={registrationDate} onChange={e => setRegistrationDate(e.target.value)} /><small>Optional. Cannot be in the future.</small></label>
      </fieldset>
      {error && <div className="company-form-error"><InlineError title="Could not save company">{error}</InlineError></div>}
      <PanelFooter><div className="company-actions address-form-actions"><button className="button address-save-button" disabled={busy}>{busy ? 'Saving…' : 'Save company'}</button><button type="button" className="button company-cancel-button" disabled={busy} onClick={onCancel}>Cancel</button></div></PanelFooter>
    </form>
  </Panel>
}

// Address writes go to SQL rows or the MongoDB embedded address through the API.
function AddressForm({ company, address, onDone, onCancel }: { company: Company; address?: CompanyAddress; onDone: (company: Company) => void; onCancel: () => void }) {
  const { database } = useDatabase()
  const currentDatabase = useRef(database)
  currentDatabase.current = database
  const [originalDatabase] = useState(database)
  const [values, setValues] = useState<Record<keyof Address, string>>(() => Object.fromEntries(addressLabels.map(([key]) => [key, address?.[key] ?? ''])) as Record<keyof Address, string>)
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof Address, string>>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // Save this form through its create/edit API route and display validation errors.
  async function submit(event: FormEvent) {
    event.preventDefault(); setError('')
    // Catch an empty address locally; the backend repeats this check before saving.
    const invalid: Partial<Record<keyof Address, string>> = {}
    if (!['LOCAL', 'FOREIGN'].includes(values.type)) invalid.type = 'Choose LOCAL or FOREIGN.'
    if (values.type === 'LOCAL') {
      if (!values.street_name.trim()) invalid.street_name = 'Enter the street name.'
      // Preserve an unchanged imported four-digit code; the backend verifies the target address.
      const unchangedLegacy = address?.type === 'LOCAL' && /^[0-9]{4}$/.test(address.postal_code || '') && values.postal_code.trim() === address.postal_code
      if (!unchangedLegacy && !/^[0-9]{6}$/.test(values.postal_code.trim())) invalid.postal_code = 'Enter exactly 6 digits, or keep the existing historical code unchanged.'
    } else if (values.type === 'FOREIGN' && !values.street_name.trim() && !values.other_address_line1.trim()) {
      invalid.other_address_line1 = 'Enter a street name or address line 1.'
    }
    setFieldErrors(invalid)
    if (Object.keys(invalid).length) { setError('Check the highlighted address fields below.'); return }
    setBusy(true)
    let targetAddressId = address?.id
    if (database !== originalDatabase) {
      // Address IDs differ between databases. Resolve the target company before saving.
      const target = await apiRequest<Company>(`${BASE}/${encodeURIComponent(company.uen)}`, database)
      if (target.state !== 'success') { setBusy(false); setError(target.message); return }
      if (address) {
        if (target.body.addresses.length > 1) {
          setBusy(false); setError('This database has several addresses. Cancel and select the address to edit. Your draft is still here.'); return
        }
        targetAddressId = target.body.addresses[0]?.id
      }
    }
    const path = `${BASE}/${encodeURIComponent(company.uen)}/addresses${targetAddressId ? `/${targetAddressId}` : ''}`
    const result = await apiRequest<Company>(path, database, {}, { method: targetAddressId ? 'PATCH' : 'POST', body: Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v.trim() || null])) })
    setBusy(false)
    if (currentDatabase.current !== database) { setError('The request finished for the previous database. Your draft is kept; check that database for its result.'); return }
    if (result.state === 'success') onDone(result.body)
    else setError(result.message)
  }
  return <Panel title={`${address ? 'Edit' : 'Add'} address · ${company.uen}`}>
    <form onSubmit={submit}>
      <p className="company-save-target" role="status">Saving to <strong>{database === 'mariadb' ? 'MariaDB' : 'MongoDB'}</strong>. Switching databases keeps your draft; Save writes only to the selected database.</p>
      <fieldset disabled={busy} className="company-form-grid">{addressLabels.map(([key, label, max]) => <label className="field" key={key}>{label}{key === 'type' ? <select className="input" value={values.type} aria-invalid={!!fieldErrors.type} onChange={e => setValues(v => ({ ...v, type: e.target.value }))}><option value="">Select address type</option><option value="LOCAL">LOCAL</option><option value="FOREIGN">FOREIGN</option></select> : <input className="input" maxLength={key === 'postal_code' && values.type === 'LOCAL' ? 6 : max} inputMode={key === 'postal_code' && values.type === 'LOCAL' ? 'numeric' : undefined} value={values[key]} aria-invalid={!!fieldErrors[key]} aria-describedby={fieldErrors[key] ? `address-error-${key}` : undefined} onChange={e => setValues(v => ({ ...v, [key]: e.target.value }))} />}{fieldErrors[key] && <small id={`address-error-${key}`} className="address-field-error" role="alert">{fieldErrors[key]}</small>}</label>)}</fieldset>
      {address?.type === 'LOCAL' && /^[0-9]{4}$/.test(address.postal_code || '') && <p className="company-save-target">This address has a historical 4-digit postal code. You may keep it unchanged; a replacement must contain 6 digits.</p>}
      {error && <div className="company-form-error"><InlineError title="Could not save address">{error}</InlineError></div>}
      <PanelFooter><div className="company-actions address-form-actions"><button className="button address-save-button" disabled={busy}>{busy ? 'Saving…' : 'Save address'}</button><button type="button" className="button company-cancel-button" disabled={busy} onClick={onCancel}>Cancel</button></div></PanelFooter>
    </form>
  </Panel>
}

// Submit filters explicitly and request numbered pages for direct navigation.
function Workspace() {
  const { database } = useDatabase()
  const [filters, setFilters] = useState(emptyFilters)
  // Keep typed filters separate from submitted filters until Search / filter is clicked.
  const [applied, setApplied] = useState(emptyFilters)
  // Enter submits a page number; editing the input alone does not send a request.
  const [page, setPage] = useState(1)
  const [pageInput, setPageInput] = useState('1')
  function goToPage(next: number) { setPage(next); setPageInput(String(next)) }
  const [editor, setEditor] = useState<Editor | null>(null)
  const navigate = useNavigate()
  const { '*': companyUen } = useParams()
  const detailMode = Boolean(companyUen)
  // Recently viewed means the last five distinct company details opened during this visit.
  // React state is shared across database switches and cleared on reload or leaving this section.
  const [recentUens, setRecentUens] = useState<string[]>([])
  const [viewedFilter, setViewedFilter] = useState('all')
  const [appliedViewed, setAppliedViewed] = useState('all')
  function rememberCompany(uen: string) {
    setRecentUens(previous => previous[0] === uen ? previous : [uen, ...previous.filter(id => id !== uen)].slice(0, 5))
  }
  const directoryScroll = useRef(0)
  const detailHeading = useRef<HTMLDivElement>(null)
  const detail = useApiResource<Company>(companyUen ? `${BASE}/${encodeURIComponent(companyUen)}` : null, {}, '', {}, true)
  const selected = detail.result?.state === 'success' && detail.result.body.uen === companyUen ? detail.result.body : null

  const detailRefreshing = detail.isLoading || !!(detail.result && detail.result.database !== database)

  // Count a view only after the company actually loads; failed lookups do not enter history.
  useEffect(() => {
    if (selected && !detail.isLoading) rememberCompany(selected.uen)
  }, [selected?.uen, detail.isLoading])

  // Move the company screen to the top and focus its heading after details load.
  useEffect(() => {
    if (detailMode) {
      window.scrollTo({ top: 0, behavior: 'instant' })
      detailHeading.current?.focus({ preventScroll: true })
    } else {
      window.scrollTo({ top: directoryScroll.current, behavior: 'instant' })
    }
  }, [companyUen])

  // Keep filters and pagination mounted while the URL opens a company detail screen.
  function backToDirectory() {
    setEditor(null); setError('')
    navigate('/system/companies-addresses')
  }
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const resource = useApiResource<Results>(BASE, { ...applied, page, limit: 25, viewed: appliedViewed, viewed_uens: appliedViewed === 'all' ? undefined : recentUens })
  const result = resource.result
  // Keep the last rendered rows in place while the newly selected database loads.
  // These rows are a disabled visual placeholder, not results from the new database.
  const previousResults = useRef<Results | null>(null)
  const currentData = result?.state === 'success' && result.database === database ? result.body : null
  if (currentData) previousResults.current = currentData
  const tableRefreshing = resource.isLoading || (result !== null && result.database !== database)
  const data = currentData ?? (tableRefreshing ? previousResults.current : null)
  const label = database === 'mariadb' ? 'MariaDB' : 'MongoDB'
  // Show the saved details and refresh the company directory.
  function saved(company: Company) {
    setEditor(null); setNotice(`Saved to ${label}.`)
    navigate(`/system/companies-addresses/${encodeURIComponent(company.uen)}`)
    detail.reload(); resource.reload()
  }
  // Open a dedicated company URL and remember the row and directory scroll position.
  function openCompany(company: Company) {
    directoryScroll.current = window.scrollY
    setError(''); setEditor(null); setNotice('')
    navigate(`/system/companies-addresses/${encodeURIComponent(company.uen)}`)
  }
  // Confirm deletions; the backend also blocks companies referenced by other records.
  async function remove(company: Company, address?: CompanyAddress) {
    const message = address ? `Delete this address from ${company.uen} in ${label}?` : `Delete ${company.name || company.uen} from ${label}? Its addresses, former names and company activity assignments will also be removed. This cannot be undone.`
    // Cancel leaves the record untouched; confirm sends the delete request.
    if (!window.confirm(message)) return
    setBusy(true); setError('')
    const path = `${BASE}/${encodeURIComponent(company.uen)}${address ? `/addresses/${address.id}` : ''}`
    const outcome = await apiRequest<void>(path, database, {}, { method: 'DELETE' })
    setBusy(false)
    // Keep the detail panel open when the backend rejects the deletion.
    if (outcome.state !== 'success') { setError(outcome.message); return }
    setNotice(`${address ? 'Address' : 'Company'} deleted from ${label}.`)
    if (address) detail.reload()
    else backToDirectory()
    resource.reload()
  }
  // Submit the current filters and restart pagination from the first page.
  function apply(event: FormEvent) {
    event.preventDefault()
    // Catch a reversed date range before sending a request; the backend repeats this check.
    if (filters.registered_from && filters.registered_to && filters.registered_from > filters.registered_to) { setError('"Registered from" must be on or before "Registered to".'); return }
    setError(''); setApplied({ ...filters }); setAppliedViewed(viewedFilter); goToPage(1); setEditor(null); if (JSON.stringify(filters) === JSON.stringify(applied) && viewedFilter === appliedViewed && page === 1) resource.reload() }
  // Clear filters and return to the unfiltered directory.
  function reset() { setFilters(emptyFilters); setApplied(emptyFilters); setViewedFilter('all'); setAppliedViewed('all'); goToPage(1); setEditor(null); resource.reload() }
  const filterLabels: [keyof typeof emptyFilters, string, string][] = [['q', 'Company name or full UEN', 'search'], ['status', 'Registration status (exact)', 'text'], ['postal_code', 'Postal code (exact)', 'text'], ['street', 'Street name contains', 'text'], ['registered_from', 'Registered from', 'date'], ['registered_to', 'Registered to', 'date']]
  return <>
    <div ref={detailHeading} tabIndex={-1} className="company-screen-heading"><PageHeading title={detailMode ? (selected?.name || 'Company details') : 'Companies & Addresses'} description={detailMode ? `Company record and addresses in ${label}.` : `Manage company records and registered addresses in ${label}.`} actions={detailMode ? <><button className="button company-navigation-button" onClick={backToDirectory}>Back to directory</button>{selected && !editor && <div className="company-actions"><button className="button company-edit-button button-sm" disabled={busy || detailRefreshing} onClick={() => setEditor({ kind: 'company', company: selected })}>Edit company</button><button className="button company-delete-button button-sm" disabled={busy || detailRefreshing} onClick={() => remove(selected)}>Delete company</button></div>}</> : <button className="button button-primary" disabled={busy} onClick={() => { setEditor({ kind: 'company' }); setNotice(''); setError('') }}>Add company</button>} /></div>
    {notice && <ConfirmationBanner onDismiss={() => setNotice('')}>{notice}</ConfirmationBanner>}
    {error && <InlineError title="Request failed">{error}</InlineError>}
    {editor?.kind === 'company' && <CompanyForm key={editor.company?.uen ?? 'new'} company={editor.company} onDone={saved} onCancel={() => setEditor(null)} />}
    {editor?.kind === 'address' && <AddressForm key={`${editor.company.uen}-${editor.address?.id ?? 'new'}`} company={editor.company} address={editor.address} onDone={saved} onCancel={() => setEditor(null)} />}
    {detailMode && detail.isLoading && !selected && !editor && <Panel><SkeletonRows count={4} label="Loading company details" /></Panel>}
    {detailMode && !detail.isLoading && detail.result && detail.result.state !== 'success' && <InlineError title="Could not load company" action={<button className="button button-secondary" onClick={detail.reload}>Retry</button>}>{detail.result.message}</InlineError>}
    {selected && !editor && <Panel>
      <div className="company-detail"><dl className="company-summary"><div><dt>Current entity name</dt><dd>{selected.name || 'Not provided'}</dd></div><div><dt>Former entity names</dt><dd>{selected.former_names?.length ? selected.former_names.map((name, index) => <div key={`${index}-${name}`}>{name}</div>) : selected.name || 'Not provided'}</dd></div><div><dt>UEN</dt><dd>{selected.uen}</dd></div><div><dt>Status</dt><dd><RegistryStatusBadge status={selected.status || 'Not provided'} /></dd></div><div><dt>Registration date</dt><dd>{selected.registration_date || '—'}</dd></div></dl>
      <div className="company-address-heading"><h3>Addresses</h3><button className="button company-edit-button button-sm" disabled={busy || detailRefreshing || (database === 'mongodb' && selected.addresses.length > 0)} onClick={() => setEditor({ kind: 'address', company: selected })}>Add address</button></div>
      <p className="company-note">You can manage multiple addresses in MariaDB and one address per company in MongoDB.</p>
      {selected.addresses.length === 0 && <p>No address recorded. Use Add address to create one.</p>}
      {selected.addresses.map(address => <div className="company-address-card" key={address.id}><dl className="company-address-values">{addressLabels.map(([key, text]) => address[key] ? <div key={key}><dt>{text}</dt><dd>{address[key]}</dd></div> : null)}</dl><AddressMap address={address} companyName={selected.name} /><div className="company-actions"><button className="button company-edit-button button-sm" disabled={busy || detailRefreshing} onClick={() => setEditor({ kind: 'address', company: selected, address })}>Edit address</button><button className="button company-delete-button button-sm" disabled={busy || detailRefreshing} onClick={() => remove(selected, address)}>Delete address</button></div></div>)}
      </div>
    </Panel>}
    {!detailMode && !editor && <Panel title="Company directory">
      {/* A collapsible key explains colours; each record still displays its actual status. */}
      <details className="status-legend">
        <summary>Status colour legend</summary>
        <div className="status-legend-items">
          {[
            ['green', 'Live / active'], ['grey', 'Terminated'], ['red', 'Cancelled / revoked'],
            ['orange', 'Ceased / closed'], ['amber', 'Liquidation / pending'],
            ['purple', 'Dissolved / struck off'], ['cyan', 'Other statuses'],
          ].map(([colour, label]) => <span className={`badge registry-status registry-status-${colour}`} key={colour}><span className="badge-dot" aria-hidden="true" />{label}</span>)}
        </div>
        <p className="status-legend-note">Colours group related statuses. The text on each company shows its exact registration status.</p>
      </details>
      {/* Keep search controls enabled during reads so switching databases does not flash their disabled styles. */}
      <form onSubmit={apply} className="company-filters"><fieldset disabled={busy} className="company-form-grid">{filterLabels.map(([key, text, type]) => <label className="field" key={key}>{text}{key === 'status' ? <StatusSelect value={filters.status} onChange={status => setFilters(f => ({ ...f, status }))} /> : <input className="input" type={type} maxLength={key === 'q' ? 500 : key === 'street' ? 255 : 20} value={filters[key]} onChange={e => setFilters(f => ({ ...f, [key]: e.target.value }))} />}</label>)}<label className="field">Viewing history<select className="input" value={viewedFilter} onChange={e => setViewedFilter(e.target.value)}><option value="all">All companies</option><option value="only">Recently viewed only</option><option value="hide">Hide recently viewed</option></select><small>Last 5 companies opened during this visit, shared across both databases. Clears when you leave this section or reload.</small></label><div className="company-actions"><button className="button button-primary">Search / filter</button><button type="button" className="button button-secondary" onClick={reset}>Reset</button></div></fieldset></form>
      {/* Reserve the result area while loading so the page height does not collapse. */}
      <div className="company-results-region" aria-busy={tableRefreshing}>
      {tableRefreshing && <span className="visually-hidden" role="status">Updating company results.</span>}
      {!tableRefreshing && result && result.state !== 'success' ? <InlineError title="Could not load companies" action={<button className="button button-secondary" onClick={resource.reload}>Retry</button>}>{result.message}</InlineError> : data?.items.length === 0 ? <EmptyState title={page > 1 ? "No companies on this page" : "No matching companies"}>{page > 1 ? "Enter a lower page number or return to page 1." : "Try another search or reset the filters."}</EmptyState> : <div className="company-table-scroll"><table className="company-table"><thead><tr><th>UEN</th><th>Company</th><th>Status</th><th>Registered</th><th>Address</th><th><span className="visually-hidden">Actions</span></th></tr></thead><tbody>{data?.items.map(company => <tr key={company.uen} className={recentUens.includes(company.uen) ? 'company-recent-row' : undefined}><td>{company.uen}</td><td>{company.name || 'Unnamed company'}{recentUens.includes(company.uen) && <span className="company-recent-label">Recently viewed</span>}</td><td><RegistryStatusBadge status={company.status || 'Not provided'} /></td><td>{company.registration_date || '—'}</td><td>{company.addresses.map(a => [a.block, a.street_name, a.postal_code].filter(Boolean).join(' ')).join('; ') || '—'}</td><td><button className="button company-navigation-button button-sm" disabled={busy || tableRefreshing} onClick={() => openCompany(company)}>View / manage</button></td></tr>)}</tbody></table></div>}
      </div>
      <PanelFooter><div className="company-pagination"><span>Page {page} · {`${data?.items.length ?? 0} companies`}</span><div className="company-actions"><form className="company-page-jump" onSubmit={event => { event.preventDefault(); const next = Number(pageInput); if (Number.isInteger(next) && next >= 1 && next <= 100000) goToPage(next) }}><label htmlFor="company-page-number">Jump to page</label><input id="company-page-number" className="input" type="number" min="1" max="100000" step="1" required value={pageInput} disabled={busy} onChange={event => setPageInput(event.target.value)} aria-describedby="company-page-hint" /><span id="company-page-hint">Press Enter</span></form><button className="button button-secondary button-sm" disabled={busy || resource.isLoading || page === 1} onClick={() => goToPage(page - 1)}>Previous</button><button className="button button-secondary button-sm" disabled={busy || resource.isLoading || !data?.has_more} onClick={() => goToPage(page + 1)}>Next</button></div></div></PanelFooter>
    </Panel>}
  </>
}

// Keep the workspace mounted so switching databases preserves search inputs and drafts.
export default function CompaniesAddressesPage() {
  return <Workspace />
}
