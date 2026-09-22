/**
 * API access layer.
 *
 * This module builds requests against the `/api` routes, always sends the
 * selected `database` query parameter, and turns each response into one of the
 * states a page can render.
 *
 * It contains no business query logic. It keeps only request construction, JSON
 * parsing, and response states. Deciding what a result means belongs to the
 * backend.
 */

/** The one selected database. Exactly one value is used per request. */
export type DatabaseMode = 'mariadb' | 'mongodb'

/** The API routes this module calls. */
export const API_ROUTES = {
  companyStatuses: '/api/company-statuses',
  companies: '/api/companies',
  companyDetail: (uen: string) => `/api/companies/${encodeURIComponent(uen)}`,
  companyAwards: (uen: string) => `/api/companies/${encodeURIComponent(uen)}/awards`,
  agencies: '/api/agencies',
  agencyAwards: '/api/agency-awards',
  industries: '/api/industries',
  industryAwards: '/api/industry-awards',
  savedLists: '/api/saved-lists',
  savedListDetail: (listId: string) => `/api/saved-lists/${encodeURIComponent(listId)}`,
} as const

/**
 * Backend base URL.
 *
 * In development Vite proxies `/api` to the local backend, so the empty
 * default keeps requests same-origin and needs no backend CORS change.
 */
const configuredBaseUrl = import.meta.env.VITE_API_BASE_URL

export const API_BASE_URL = configuredBaseUrl ? configuredBaseUrl.replace(/\/+$/, '') : ''

/** Response states a caller has to tell apart. */
export type ApiStateName =
  | 'success'
  | 'supplier_matching_not_ready'
  | 'not_implemented'
  | 'validation_error'
  | 'api_error'
  | 'network_error'

/** A successful call. `body` is the parsed `data` envelope value. */
export type ApiSuccess<T> = {
  state: 'success'
  status: number
  database: DatabaseMode | null
  body: T
}

/**
 * Any non-success state.
 *
 * `code` is the documented domain error code when the backend supplied one.
 * `message` is always safe to show: a failed request never exposes credentials,
 * query text, stack traces, connector messages, or local paths.
 */
export type ApiFailure = {
  state: Exclude<ApiStateName, 'success'>
  status: number | null
  database: DatabaseMode | null
  code: string | null
  message: string
}

export type ApiResult<T> = ApiSuccess<T> | ApiFailure

/** Success and failure states share these fields, so narrowing reads them safely. */
export type ApiOutcome<T> = ApiResult<T>

/** Optional request inputs. */
export type ApiRequestOptions = {
  /** Response envelope field to return. Defaults to `data`. */
  pick?: 'data' | 'meta'
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  /** Request body for the saved-list write routes. */
  body?: unknown
  /** Abort signal, so a page can cancel a request it no longer needs. */
  signal?: AbortSignal
}

/** Query values the API accepts. Arrays repeat the parameter. */
export type QueryValue = string | number | boolean | null | undefined | string[]

const GENERIC_FAILURE_MESSAGE =
  'The request could not be completed. The API reported an error.'

const NETWORK_FAILURE_MESSAGE =
  'The backend API could not be reached. Start the FastAPI backend on 127.0.0.1:8000 and try again.'

function buildQueryString(query: Record<string, QueryValue>): string {
  const params = new URLSearchParams()

  for (const [key, value] of Object.entries(query)) {
    if (value === null || value === undefined || value === '') {
      continue
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        params.append(key, item)
      }
      continue
    }
    params.append(key, String(value))
  }

  const queryString = params.toString()
  return queryString ? `?${queryString}` : ''
}

/** Read the documented domain error code and safe message from an error body. */
function readDomainError(body: unknown): { code: string | null; message: string | null } {
  if (typeof body !== 'object' || body === null || !('detail' in body)) {
    return { code: null, message: null }
  }

  const detail = (body as { detail: unknown }).detail

  // A documented domain error is `{ detail: { code, message } }`.
  if (typeof detail === 'object' && detail !== null && !Array.isArray(detail)) {
    const record = detail as { code?: unknown; message?: unknown }
    return {
      code: typeof record.code === 'string' ? record.code : null,
      message: typeof record.message === 'string' ? record.message : null,
    }
  }

  // FastAPI's own validation response is `{ detail: [ { msg, loc, ... } ] }`.
  if (Array.isArray(detail)) {
    const summaries: string[] = []
    for (const entry of detail) {
      if (typeof entry === 'object' && entry !== null && 'msg' in entry) {
        const msg = (entry as { msg: unknown }).msg
        if (typeof msg === 'string') {
          summaries.push(msg)
        }
      }
    }
    return {
      code: null,
      message: summaries.length > 0 ? `Validation failed. ${summaries.join(' ')}` : null,
    }
  }

  return { code: null, message: null }
}

function classifyFailure(
  status: number,
  code: string | null,
  message: string | null,
  database: DatabaseMode | null,
): ApiFailure {
  if (status === 409 && code === 'supplier_matching_not_ready') {
    // Accepted supplier-company links are not available in the selected
    // database, so the request is blocked rather than answered with fake data.
    return {
      state: 'supplier_matching_not_ready',
      status,
      database,
      code,
      message:
        message ??
        'Accepted supplier-company links are not available in the selected database.',
    }
  }

  if (status === 501) {
    // The route exists but its business logic is not implemented yet. This is
    // expected behaviour, not a frontend fault.
    return {
      state: 'not_implemented',
      status,
      database,
      code: code ?? 'not_implemented',
      message:
        message ??
        'This API route is declared but its business logic is not implemented yet.',
    }
  }

  if (status === 422) {
    return {
      state: 'validation_error',
      status,
      database,
      code,
      message: message ?? 'The request was rejected. Check the supplied values.',
    }
  }

  return {
    state: 'api_error',
    status,
    database,
    code,
    message: message ?? GENERIC_FAILURE_MESSAGE,
  }
}

/**
 * Send one API request and return exactly one response state.
 *
 * Every call adds the selected `database` parameter, because the API requires
 * it on every business route.
 */
export async function apiRequest<T>(
  path: string,
  database: DatabaseMode,
  query: Record<string, QueryValue> = {},
  options: ApiRequestOptions = {},
): Promise<ApiResult<T>> {
  const { pick = 'data', method = 'GET', body, signal } = options
  const url = `${API_BASE_URL}${path}${buildQueryString({ ...query, database })}`

  let response: Response
  try {
    response = await fetch(url, {
      method,
      signal,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    // Covers an unreachable backend, a refused connection, DNS failure, and an
    // aborted request. The message stays generic and never echoes the URL.
    return {
      state: 'network_error',
      status: null,
      database,
      code: null,
      message: NETWORK_FAILURE_MESSAGE,
    }
  }

  // 204 has no body and carries no metadata, which is the documented shape for
  // the saved-list delete routes.
  if (response.status === 204) {
    return {
      state: 'success',
      status: response.status,
      database,
      body: undefined as T,
    }
  }

  let parsed: unknown = null
  try {
    parsed = await response.json()
  } catch {
    parsed = null
  }

  if (response.ok) {
    const envelope = parsed as Record<string, unknown> | null
    const payload = envelope && pick in envelope ? envelope[pick] : (undefined as unknown)
    return {
      state: 'success',
      status: response.status,
      database,
      body: payload as T,
    }
  }

  const { code, message } = readDomainError(parsed)
  return classifyFailure(response.status, code, message, database)
}

/** True when the route exists but its business logic is not implemented yet. */
export function isNotImplemented<T>(result: ApiResult<T>): boolean {
  return result.state === 'not_implemented'
}

/** True when the request is blocked because supplier matching is not ready. */
export function isSupplierMatchingNotReady<T>(result: ApiResult<T>): boolean {
  return result.state === 'supplier_matching_not_ready'
}

/** A short, safe sentence for any non-success state. */
export function describeFailure(result: ApiFailure): string {
  switch (result.state) {
    case 'not_implemented':
      return 'This backend route currently returns HTTP 501 Not Implemented.'
    case 'supplier_matching_not_ready':
      return 'Supplier-to-company matching is not ready yet, so this request is blocked.'
    case 'validation_error':
      return 'The backend rejected the request.'
    case 'network_error':
      return 'The backend API could not be reached.'
    default:
      return 'The backend reported an error.'
  }
}

// --------------------------------------------------------------------------
// Response types used by the pages
// --------------------------------------------------------------------------

/**
 * TypeScript shapes mirroring the API response fields the pages need. They
 * describe the interface only and hold no query logic.
 */

export type IndustryActivity = {
  code: string | null
  title: string | null
  source_description: string | null
}

export type CompanyActivities = {
  primary: IndustryActivity | null
  secondary: IndustryActivity | null
}

export type Address = {
  type: string | null
  block: string | null
  street_name: string | null
  level_no: string | null
  unit_no: string | null
  building_name: string | null
  postal_code: string | null
  other_address_line1: string | null
  other_address_line2: string | null
}

/** One company row from `GET /api/companies`. */
export type CompanySummary = {
  uen: string
  name: string | null
  status: string
  incorporation_date: string | null
  primary_activity: IndustryActivity | null
  /** Boolean only when supplier matching is ready, otherwise null. */
  has_linked_award: boolean | null
}

/** One company from `GET /api/companies/{uen}`. */
export type CompanyDetail = {
  uen: string
  name: string | null
  status: string
  incorporation_date: string | null
  address: Address | null
  former_names: string[]
  activities: CompanyActivities
  has_linked_award: boolean | null
}

export type CompaniesData = { items: CompanySummary[] }

/** Pagination metadata. No total count is provided. */
export type Pagination = {
  limit: number
  offset: number
  returned: number
  has_more: boolean
  next_offset: number | null
}

export type PaginatedMeta = {
  database: DatabaseMode
  pagination: Pagination
}

/** One award row from `GET /api/companies/{uen}/awards`. */
export type CompanyAward = {
  tender_no: string
  tender_description: string | null
  agency_name: string | null
  award_date: string | null
  supplier_name: string
  amount: string
}

export type CompanyAwardsData = { items: CompanyAward[] }

/** Agency totals from `GET /api/agency-awards`. */
export type AgencyAwardsSummary = {
  agency_name: string
  period: { start_date: string | null; end_date: string | null }
  supplier_count: number
  award_row_count: number
  tender_count: number
  total_award_amount: string
  average_supplier_total: string | null
  excluded_no_supplier_tender_count: number
}

/** One supplier row from `GET /api/agency-awards`. */
export type AgencySupplierItem = {
  supplier_name: string
  total_award_amount: string
  award_row_count: number
  tender_count: number
  share_percent: string | null
  company_link: {
    status: 'accepted' | 'not_accepted'
    uen: string | null
    name: string | null
  }
}

export type AgencyAwardsData = {
  summary: AgencyAwardsSummary
  items: AgencySupplierItem[]
}

export type AgencyItem = { agency_name: string }
export type AgenciesData = { items: AgencyItem[] }

export type IndustryItem = {
  code: string
  title: string | null
  level: string | null
  has_children: boolean
}

export type IndustriesData = { items: IndustryItem[] }

/** One child branch from `GET /api/industry-awards`. */
export type IndustryAwardChild = {
  code: string
  title: string | null
  level: string | null
  total_award_amount: string
  award_row_count: number
  company_count: number
  share_percent: string | null
}

export type IndustryAwardsSummary = {
  parent_code: string | null
  period: { start_date: string | null; end_date: string | null }
  total_award_amount: string
  award_row_count: number
  company_count: number
  coverage: {
    excluded_no_accepted_link_award_row_count: number
    excluded_unresolved_primary_ssic_award_row_count: number
  }
}

export type IndustryAwardsData = {
  summary: IndustryAwardsSummary
  items: IndustryAwardChild[]
}

export type ReviewStatus = 'to_check' | 'reviewed'

/** Saved-list metadata from `GET /api/saved-lists`. */
export type SavedListSummary = {
  id: string
  name: string
  entry_count: number
}

/** One entry from `GET /api/saved-lists/{list_id}`. */
export type SavedListEntry = {
  company_uen: string
  company_name: string | null
  company_status: string | null
  review_status: ReviewStatus
}

export type SavedListDetail = {
  id: string
  name: string
  entry_count: number
  entries: SavedListEntry[]
}

export type SavedListsData = { items: SavedListSummary[] }
export type CompanyStatusesData = { items: string[] }
