// Types, API paths, dropdowns, the supplier picker and pagination used by the tender screens.

import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { apiRequest } from '../../api/client'
import type { DatabaseMode } from '../../api/client'
import { useApiResource } from '../../api/useApiResource'
import { useDatabase } from '../../databaseContext'

export const TENDERS_PATH = '/system/tenders-awards'
export const AWARDS_PATH = `${TENDERS_PATH}/awards`
export const tenderPath = (tenderNo: string) => `${TENDERS_PATH}/tenders/${encodeURIComponent(tenderNo)}`

// Backend routes; see backend/app/routes/tenders.py.
export const API = {
  tenders: '/api/system/tenders',
  options: '/api/system/tenders/options',
  suppliers: '/api/system/tenders/suppliers',
  awards: '/api/system/tender-awards',
  tender: (tenderNo: string) => `/api/system/tenders/${encodeURIComponent(tenderNo)}`,
  tenderAwards: (tenderNo: string) => `/api/system/tenders/${encodeURIComponent(tenderNo)}/awards`,
  award: (tenderNo: string, awardId: string) => `/api/system/tenders/${encodeURIComponent(tenderNo)}/awards/${awardId}`,
}

// A tender with this status has no supplier awards; the backend blocks adding awards to it.
export const NO_SUPPLIERS = 'Awarded to No Suppliers'

export type Award = { id: string; supplier: string; amount: string }
export type Tender = {
  tender_no: string; description: string; agency: string; status: string; award_date: string
  award_count: number; total_amount: string; awards?: Award[]
}
export type AwardRow = {
  id: string; tender_no: string; tender_description: string; agency: string; status: string
  award_date: string; supplier: string; amount: string
}
export type ResultPage<T> = { items: T[]; total: number; page: number; limit: number; has_more: boolean }

export const emptyTenderFilters = { q: '', agency: '', status: '', supplier: '', award_from: '', award_to: '', min_amount: '', max_amount: '', sort: 'date_desc' }
export const emptyAwardFilters = { q: '', agency: '', status: '', award_from: '', award_to: '', min_amount: '', max_amount: '', sort: 'date_desc' }
export type TenderFilters = typeof emptyTenderFilters
export type AwardFilters = typeof emptyAwardFilters

// Search state lives in the section layout so it survives opening a tender and coming back.
export type ListState<F> = { applied: F; setApplied: (filters: F) => void; page: number; setPage: (page: number) => void }
export type SectionState = { tenders: ListState<TenderFilters>; awards: ListState<AwardFilters> }

export const dbLabel = (database: DatabaseMode) => database === 'mariadb' ? 'MariaDB' : 'MongoDB'

// Local date as YYYY-MM-DD, used as the latest allowed award date.
export const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10)

// Amounts: 0 or more with up to two decimal places, matching the backend check.
export const AMOUNT_PATTERN = '[0-9]{1,16}(\\.[0-9]{1,2})?'
export const isAmount = (value: string) => new RegExp(`^${AMOUNT_PATTERN}$`).test(value.trim())

// Reject reversed ranges before sending a request; the backend repeats these checks.
export function rangeError(filters: { award_from: string; award_to: string; min_amount: string; max_amount: string }) {
  if (filters.award_from && filters.award_to && filters.award_from > filters.award_to) return '"Awarded from" must be on or before "Awarded to".'
  for (const key of ['min_amount', 'max_amount'] as const) {
    if (filters[key] && !isAmount(filters[key])) return 'Amounts must be numbers with at most 2 decimal places, for example 50000 or 1250.50.'
  }
  if (filters.min_amount && filters.max_amount && Number(filters.min_amount) > Number(filters.max_amount)) return 'The minimum amount must not be more than the maximum amount.'
  return ''
}

// Show S$ amounts with thousands separators, keeping the exact cents from the API string.
export function formatSgd(amount: string) {
  const [whole, cents = '00'] = amount.split('.')
  return `S$${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${cents}`
}

// Colour tenders by outcome; the text always shows the exact GeBIZ status.
export function TenderStatusBadge({ status }: { status: string }) {
  // Keep the four source statuses distinct in both the directory and detail page.
  const colours: Record<string, string> = {
    'Awarded to Suppliers': 'suppliers',
    'Awarded by Items': 'items',
    'Awarded to No Suppliers': 'no-suppliers',
    'Award by interface record': 'interface',
  }
  return <span className={`badge tender-status tender-status-${colours[status] ?? 'other'}`}><span className="badge-dot" aria-hidden="true" />{status}</span>
}

// Agencies and statuses for the dropdowns, read from the selected database.
export function useTenderOptions() {
  const { database } = useDatabase()
  const resource = useApiResource<{ agencies: string[]; statuses: string[] }>(API.options)
  const result = resource.result
  const ok = result?.state === 'success' && result.database === database
  return {
    agencies: ok ? result.body.agencies : [], statuses: ok ? result.body.statuses : [],
    failed: !resource.isLoading && result !== null && result.state !== 'success', reload: resource.reload,
  }
}

// A plain dropdown that keeps the current value even before the options have loaded.
export function OptionSelect({ value, onChange, options, placeholder, required = false, id }: {
  value: string; onChange: (value: string) => void; options: string[]; placeholder: string; required?: boolean; id?: string
}) {
  const choices = Array.from(new Set([...(value ? [value] : []), ...options]))
  return <select id={id} className="input" required={required} value={value} onChange={event => onChange(event.target.value)}>
    <option value="">{placeholder}</option>
    {choices.map(choice => <option key={choice} value={choice}>{choice}</option>)}
  </select>
}

// Supplier name input that suggests existing suppliers once 2 or more characters are typed.
export function SupplierInput({ value, onChange, id, invalid }: { value: string; onChange: (value: string) => void; id: string; invalid?: boolean }) {
  const { database } = useDatabase()
  const [suggestions, setSuggestions] = useState<string[]>([])
  useEffect(() => {
    const text = value.trim()
    if (text.length < 2) { setSuggestions([]); return }
    // Wait for a short pause in typing so every keystroke does not send a request.
    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      const result = await apiRequest<{ items: string[] }>(API.suppliers, database, { q: text }, { signal: controller.signal })
      if (result.state === 'success') setSuggestions(result.body.items)
    }, 250)
    return () => { window.clearTimeout(timer); controller.abort() }
  }, [value, database])
  return <>
    <input id={id} className="input" required maxLength={500} list={`${id}-options`} autoComplete="off" aria-invalid={invalid}
      placeholder="Type 2+ letters to search suppliers" value={value} onChange={event => onChange(event.target.value)} />
    <datalist id={`${id}-options`}>{suggestions.map(name => <option key={name} value={name} />)}</datalist>
  </>
}

// Result summary with Previous / Next and a jump-to-page box.
export function Paging({ page, total, limit, noun, disabled, onPage }: {
  page: number; total: number; limit: number; noun: string; disabled: boolean; onPage: (page: number) => void
}) {
  const pages = Math.max(1, Math.ceil(total / limit))
  const [input, setInput] = useState(String(page))
  useEffect(() => setInput(String(page)), [page])
  return <div className="company-pagination">
    <span>Page {page} of {pages.toLocaleString()} · {total.toLocaleString()} {noun}</span>
    <div className="company-actions">
      <form className="company-page-jump" onSubmit={event => { event.preventDefault(); const next = Number(input); if (Number.isInteger(next) && next >= 1 && next <= pages) onPage(next) }}>
        <label htmlFor={`${noun}-page-number`}>Jump to page</label>
        <input id={`${noun}-page-number`} className="input" type="number" min="1" max={pages} step="1" required value={input} disabled={disabled} onChange={event => setInput(event.target.value)} />
      </form>
      <button type="button" className="button button-secondary button-sm" disabled={disabled || page <= 1} onClick={() => onPage(page - 1)}>Previous</button>
      <button type="button" className="button button-secondary button-sm" disabled={disabled || page >= pages} onClick={() => onPage(page + 1)}>Next</button>
    </div>
  </div>
}

// Label + control wrapper matching the company forms.
export function Field({ label, hint, error, children, wide = false }: { label: string; hint?: string; error?: string; children: ReactNode; wide?: boolean }) {
  return <label className={wide ? 'field tender-field-wide' : 'field'}>{label}{children}
    {hint && !error && <small>{hint}</small>}
    {error && <small className="address-field-error" role="alert">{error}</small>}
  </label>
}
