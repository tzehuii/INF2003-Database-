// Types, API paths and the company-link badge used by the supplier screens.

import { StatusBadge } from '../../components/ui'

export const SUPPLIERS_PATH = '/system/suppliers'
// Supplier names can contain "/", so the name is encoded as one path segment.
export const supplierPath = (name: string) => `${SUPPLIERS_PATH}/detail/${encodeURIComponent(name)}`

// Backend routes; see backend/app/routes/suppliers.py. One supplier is addressed by ?name=.
export const API = {
  suppliers: '/api/system/suppliers',
  supplier: '/api/system/suppliers/item',
  link: '/api/system/suppliers/item/link',
  candidates: '/api/system/suppliers/item/candidates',
}

export type LinkStatus = 'accepted' | 'ambiguous' | 'unmatched'
export type CompanyRef = { uen: string; name: string | null; status: string | null }

export type SupplierRow = {
  name: string; normalized_name: string; award_count: number; total_amount: string
  link: { status: LinkStatus; candidate_count: number; company_uen: string | null; company_name: string | null }
}
export type SupplierAward = { id: string; tender_no: string; description: string; agency: string; award_date: string; amount: string }
export type Supplier = {
  name: string; normalized_name: string; award_count: number; total_amount: string; awards: SupplierAward[]
  link: { status: LinkStatus; candidate_count: number; method: 'name' | 'manual' | null; company: CompanyRef | null }
}
export type Candidates = { normalized_name: string; more: boolean; items: CompanyRef[] }

export const emptySupplierFilters = { q: '', link: '', awards: '', agency: '', min_total: '', max_total: '', sort: 'name_asc' }
export type SupplierFilters = typeof emptySupplierFilters

// Search state lives in the section layout so it survives opening a supplier and coming back.
export type SupplierListState = {
  applied: SupplierFilters; setApplied: (filters: SupplierFilters) => void; page: number; setPage: (page: number) => void
}

export const LINK_OPTIONS: { value: LinkStatus; label: string }[] = [
  { value: 'accepted', label: 'Linked to a company' },
  { value: 'ambiguous', label: 'Several possible companies' },
  { value: 'unmatched', label: 'Not linked' },
]

// The link status in words; the colour only repeats what the words say.
export function LinkBadge({ status, candidates }: { status: LinkStatus; candidates: number }) {
  if (status === 'accepted') return <StatusBadge tone="success" dot>Linked</StatusBadge>
  if (status === 'ambiguous') return <StatusBadge tone="warning" dot>{candidates} possible companies</StatusBadge>
  return <StatusBadge tone="neutral" dot>Not linked</StatusBadge>
}
