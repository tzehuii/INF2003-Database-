/**
 * Companies page.
 *
 * Search and filter Singapore companies.
 *
 * The page calls `GET /api/companies` and renders the result. While that route
 * returns HTTP 501, the table falls back to clearly labelled placeholder values
 * so the layout remains reviewable.
 */

import { useId, useState } from 'react'
import { Link } from 'react-router-dom'
import { API_ROUTES, isLiveData, isSupplierMatchingNotReady } from '../api/client'
import type { CompaniesData, CompanySummary } from '../api/client'
import { PLACEHOLDER_COMPANIES, PLACEHOLDER_COMPANY_STATUSES } from '../api/mockData'
import { useApiResource } from '../api/useApiResource'
import {
  BackendStatusStrip,
  EmptyState,
  LinkedAwardBadge,
  PageHeading,
  Pagination,
  Panel,
  PanelFooter,
  PanelNotes,
  PlaceholderNotice,
  RegistryStatusBadge,
  SampleDataBadge,
  SearchInput,
  ToggleChip,
} from '../components/ui'
import { EMPTY_VALUE, formatDate } from '../format'

/** Page size for the offset pagination the API uses. */
const PAGE_SIZE = 5

/** The API requires at least two characters in `q` when it is supplied. */
const MIN_SEARCH_LENGTH = 2

type Filters = {
  q: string
  requireLinkedAward: boolean
  statuses: string[]
}

const EMPTY_FILTERS: Filters = { q: '', requireLinkedAward: false, statuses: [] }

/**
 * The API refuses a company search that supplies no usable filter, so the page
 * asks for one instead of sending a request the backend must reject with
 * `422 invalid_search`.
 *
 * This mirrors the backend rule: text blank after trimming does not count, and
 * a supplied `q` must reach the minimum length even when another filter is
 * present. The message the backend returns is the authoritative wording.
 */
function hasAnyFilter(filters: Filters): boolean {
  const trimmed = filters.q.trim()
  const hasUsableText = trimmed.length >= MIN_SEARCH_LENGTH
  return hasUsableText || filters.statuses.length > 0 || filters.requireLinkedAward
}

/** True when the page must explain why Search will not send a request. */
function hasTextBelowMinimum(filters: Filters): boolean {
  const trimmed = filters.q.trim()
  return trimmed.length > 0 && trimmed.length < MIN_SEARCH_LENGTH
}

/**
 * Apply the filters to the placeholder rows so pagination and the results
 * layout can be reviewed.
 *
 * The real backend rule is an exact UEN match or a literal name substring. This
 * placeholder also accepts a partial UEN so the sample table responds while the
 * route returns 501. Both this function and the sample rows are removed once the
 * route returns real data.
 */
function applyPlaceholderFilters(rows: CompanySummary[], filters: Filters): CompanySummary[] {
  const term = filters.q.trim().toLowerCase()

  return rows.filter((row) => {
    if (term !== '') {
      const matchesUen = row.uen.toLowerCase().includes(term)
      const matchesName = (row.name ?? '').toLowerCase().includes(term)
      if (!matchesUen && !matchesName) {
        return false
      }
    }

    if (filters.statuses.length > 0 && !filters.statuses.includes(row.status)) {
      return false
    }

    // No company has an accepted linked award while supplier matching is not
    // ready, so this filter would match nothing rather than show wrong rows.
    if (filters.requireLinkedAward && row.has_linked_award !== true) {
      return false
    }

    return true
  })
}

export default function CompaniesPage() {
  const [draft, setDraft] = useState<Filters>(EMPTY_FILTERS)
  const [submitted, setSubmitted] = useState<Filters>(EMPTY_FILTERS)
  const [offset, setOffset] = useState(0)

  // The request signature changes only when Search or Clear Filters is pressed
  // or the page changes, so typing does not send a request on every keystroke.
  const requestKey = `${JSON.stringify(submitted)}|${offset}`
  const canRequest = hasAnyFilter(submitted)
  const textBelowMinimum = hasTextBelowMinimum(submitted)

  const { result, isLoading } = useApiResource<CompaniesData>(
    canRequest ? API_ROUTES.companies : null,
    {
      q: submitted.q.trim() || undefined,
      status: submitted.statuses.length > 0 ? submitted.statuses : undefined,
      require_linked_award: submitted.requireLinkedAward ? true : undefined,
      limit: PAGE_SIZE,
      offset,
    },
    requestKey,
  )

  const filtered = applyPlaceholderFilters(PLACEHOLDER_COMPANIES, submitted)
  const rows = filtered.slice(offset, offset + PAGE_SIZE)
  const hasPrevious = offset > 0
  const hasNext = offset + PAGE_SIZE < filtered.length

  const supplierMatchingBlocked =
    result !== null && isSupplierMatchingNotReady(result)

  // The 409 hint stays until live rows prove supplier matching is ready: every
  // returned row must carry a non-null `has_linked_award`.
  const linkedAwardHintId = useId()
  const linkedAwardReady =
    isLiveData(result) &&
    result.body.items.length > 0 &&
    result.body.items.every((item) => item.has_linked_award !== null)
  const showLinkedAwardHint = supplierMatchingBlocked || !linkedAwardReady

  function toggleStatus(status: string) {
    setDraft((current) => ({
      ...current,
      statuses: current.statuses.includes(status)
        ? current.statuses.filter((value) => value !== status)
        : [...current.statuses, status],
    }))
  }

  function runSearch(event: React.FormEvent) {
    event.preventDefault()
    setSubmitted(draft)
    setOffset(0)
  }

  function clearFilters() {
    setDraft(EMPTY_FILTERS)
    setSubmitted(EMPTY_FILTERS)
    setOffset(0)
  }

  return (
    <>
      <PageHeading
        icon="companies"
        title="Companies"
        description="Search Singapore companies by UEN or name and filter by registry status."
      />

      <Panel title="Results" badge={!isLiveData(result) ? <SampleDataBadge /> : undefined}>
        <form className="toolbar" onSubmit={runSearch}>
          <div className="toolbar-row">
            <SearchInput
              aria-label="UEN or company name"
              placeholder={`Search UEN or company name (at least ${MIN_SEARCH_LENGTH} characters)`}
              value={draft.q}
              onChange={(event) => setDraft({ ...draft, q: event.target.value })}
            />
            <div className="toolbar-end">
              <button type="submit" className="button button-primary">
                Search
              </button>
              <button type="button" className="button button-secondary" onClick={clearFilters}>
                Clear Filters
              </button>
            </div>
          </div>

          {hasTextBelowMinimum(draft) ? (
            <p className="field-warning">
              Enter at least {MIN_SEARCH_LENGTH} characters (shorter text is rejected with HTTP
              422).
            </p>
          ) : (
            <p className="field-hint">
              Exact UEN, or part of a current or former name. At least {MIN_SEARCH_LENGTH}{' '}
              characters.
            </p>
          )}

          <div className="toolbar-row">
            <div className="chip-group" role="group" aria-label="Registry status">
              <span className="field-label" aria-hidden="true">
                Registry status
              </span>
              {PLACEHOLDER_COMPANY_STATUSES.map((status) => (
                <ToggleChip
                  key={status}
                  pressed={draft.statuses.includes(status)}
                  onClick={() => toggleStatus(status)}
                >
                  {status}
                </ToggleChip>
              ))}
            </div>
          </div>

          <div className="filter-option">
            <label className="checkbox-item">
              <input
                type="checkbox"
                checked={draft.requireLinkedAward}
                aria-describedby={showLinkedAwardHint ? linkedAwardHintId : undefined}
                onChange={(event) =>
                  setDraft({ ...draft, requireLinkedAward: event.target.checked })
                }
              />
              <span>Require linked award</span>
            </label>
            {showLinkedAwardHint && (
              <p className="field-hint" id={linkedAwardHintId}>
                Unavailable until supplier matching is ready. The backend blocks this filter
                with HTTP 409 <code>supplier_matching_not_ready</code>.
              </p>
            )}
          </div>        </form>

        <BackendStatusStrip
          route={API_ROUTES.companies}
          result={result}
          isLoading={isLoading}
          note={
            textBelowMinimum
              ? `Enter at least ${MIN_SEARCH_LENGTH} characters.`
              : !canRequest
                ? 'Enter a UEN or name, choose a status, or tick Require linked award, then press Search.'
                : supplierMatchingBlocked
                  ? 'Remove the linked-award requirement to search companies without that filter.'
                  : undefined
          }
        />

        {rows.length === 0 ? (
          <EmptyState title="No companies found">
            No companies match the current filters on this page.
          </EmptyState>
        ) : (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Company name</th>
                  <th scope="col">UEN</th>
                  <th scope="col">Registry status</th>
                  <th scope="col">Incorporation date</th>
                  <th scope="col">Primary activity</th>
                  <th scope="col">Linked award</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.uen}>
                    <td className="cell-primary">
                      <Link
                        className="row-link"
                        to={`/companies/${encodeURIComponent(row.uen)}`}
                      >
                        {row.name ?? row.uen}
                      </Link>
                    </td>
                    <td className="cell-id">{row.uen}</td>
                    <td>
                      <RegistryStatusBadge status={row.status} />
                    </td>
                    <td className="cell-nowrap">{formatDate(row.incorporation_date)}</td>
                    <td>
                      {row.primary_activity ? (
                        <span className="activity-line">
                          <span className="activity-code">
                            {row.primary_activity.code ?? EMPTY_VALUE}
                          </span>{' '}
                          {row.primary_activity.title ?? EMPTY_VALUE}
                        </span>
                      ) : (
                        <span className="empty-value">{EMPTY_VALUE}</span>
                      )}
                    </td>
                    <td>
                      <LinkedAwardBadge hasLinkedAward={row.has_linked_award} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <PanelFooter>
          <Pagination
            count={rows.length}
            hasPrevious={hasPrevious}
            hasNext={hasNext}
            onPrevious={() => setOffset((current) => Math.max(0, current - PAGE_SIZE))}
            onNext={() => setOffset((current) => current + PAGE_SIZE)}
          />
          {/* Pagination uses limit/offset/has_more/next_offset. The API returns no total
              count, so none is shown. */}
          {!isLiveData(result) && (
            <PanelNotes>
              <PlaceholderNotice />
            </PanelNotes>
          )}
        </PanelFooter>
      </Panel>
    </>
  )
}
