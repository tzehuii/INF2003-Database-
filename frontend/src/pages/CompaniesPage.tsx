/**
 * Companies page.
 *
 * Search and filter Singapore companies.
 *
 * The page calls `GET /api/companies` and renders the result. While that route
 * returns HTTP 501, the table falls back to clearly labelled placeholder values
 * so the layout remains reviewable.
 */

import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { API_ROUTES, isSupplierMatchingNotReady } from '../api/client'
import type { CompaniesData, CompanySummary } from '../api/client'
import { PLACEHOLDER_COMPANIES, PLACEHOLDER_COMPANY_STATUSES } from '../api/mockData'
import { useApiResource } from '../api/useApiResource'
import { BackendStatusStrip, Card, LinkedAwardBadge, PageHeading, PlaceholderNotice } from '../components/ui'
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
  const navigate = useNavigate()

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
        title="Companies"
        description="Search Singapore companies by UEN or name and filter by registry status."
      />

      <Card title="Search">
        <form onSubmit={runSearch}>
          <div className="filter-grid">
            <label className="field field-wide">
              <span className="field-label">UEN or company name</span>
              <input
                type="search"
                className="field-input"
                placeholder="For example 201234567A or a company name"
                value={draft.q}
                onChange={(event) => setDraft({ ...draft, q: event.target.value })}
              />
              <span className="field-hint">
                Search matches an exact UEN or literal text in the current and former
                company names. Enter at least {MIN_SEARCH_LENGTH} characters.
              </span>
              {hasTextBelowMinimum(draft) && (
                <span className="field-warning">
                  Search text shorter than {MIN_SEARCH_LENGTH} characters is rejected by
                  the backend with HTTP 422 invalid_search.
                </span>
              )}
            </label>

            <fieldset className="field field-statuses">
              <legend className="field-label">Registry status</legend>
              <div className="checkbox-list">
                {PLACEHOLDER_COMPANY_STATUSES.map((status) => (
                  <label key={status} className="checkbox-item">
                    <input
                      type="checkbox"
                      checked={draft.statuses.includes(status)}
                      onChange={() => toggleStatus(status)}
                    />
                    <span>{status}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          </div>

          <div className="linked-award-row">
            <label className="checkbox-item">
              <input
                type="checkbox"
                checked={draft.requireLinkedAward}
                onChange={(event) =>
                  setDraft({ ...draft, requireLinkedAward: event.target.checked })
                }
              />
              <span>Require linked award</span>
            </label>
            <p className="inline-note">
              Unavailable. Accepted supplier-company links are not ready, so the
              backend blocks this filter with HTTP 409
              <code> supplier_matching_not_ready</code>.
            </p>
          </div>

          <div className="form-actions">
            <button type="submit" className="button button-primary">
              Search
            </button>
            <button type="button" className="button button-secondary" onClick={clearFilters}>
              Clear Filters
            </button>
          </div>
        </form>
      </Card>

      <BackendStatusStrip
        route={API_ROUTES.companies}
        result={result}
        isLoading={isLoading}
        note={
          textBelowMinimum
            ? `The backend requires at least ${MIN_SEARCH_LENGTH} characters in the search text, because a one-character substring returns nothing useful. It rejects a shorter value with HTTP 422 invalid_search.`
            : !canRequest
              ? 'No request has been sent yet. The API rejects a company search that supplies no usable filter, so enter at least two characters of a UEN or name, or choose a registry status, and press Search.'
              : supplierMatchingBlocked
                ? 'Remove the linked-award requirement to search companies without that filter.'
                : undefined
        }
      />

      <Card title="Results">
        <PlaceholderNotice />

        {rows.length === 0 ? (
          <p className="empty-state">No companies match the current filters on this page.</p>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">UEN</th>
                  <th scope="col">Company Name</th>
                  <th scope="col">Registry Status</th>
                  <th scope="col">Incorporation Date</th>
                  <th scope="col">Primary Activity</th>
                  <th scope="col">Linked Award</th>
                  <th scope="col" className="cell-actions">
                    <span className="visually-hidden">Open</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.uen}>
                    <td className="cell-uen">
                      <Link to={`/companies/${encodeURIComponent(row.uen)}`}>{row.uen}</Link>
                    </td>
                    <td>{row.name ?? EMPTY_VALUE}</td>
                    <td>
                      <span className="status-text">{row.status}</span>
                    </td>
                    <td className="cell-nowrap">{formatDate(row.incorporation_date)}</td>
                    <td>
                      {row.primary_activity ? (
                        <span className="activity-cell">
                          <span className="activity-code">{row.primary_activity.code ?? EMPTY_VALUE}</span>
                          <span className="activity-title">
                            {row.primary_activity.title ?? EMPTY_VALUE}
                          </span>
                        </span>
                      ) : (
                        EMPTY_VALUE
                      )}
                    </td>
                    <td>
                      <LinkedAwardBadge hasLinkedAward={row.has_linked_award} />
                    </td>
                    <td className="cell-actions">
                      <button
                        type="button"
                        className="button button-link"
                        onClick={() => navigate(`/companies/${encodeURIComponent(row.uen)}`)}
                      >
                        View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="pagination">
          <span className="pagination-summary">
            Showing {rows.length} {rows.length === 1 ? 'result' : 'results'} on this page
          </span>
          <div className="pagination-controls">
            <button
              type="button"
              className="button button-secondary"
              disabled={!hasPrevious}
              onClick={() => setOffset((current) => Math.max(0, current - PAGE_SIZE))}
            >
              Previous
            </button>
            <button
              type="button"
              className="button button-secondary"
              disabled={!hasNext}
              onClick={() => setOffset((current) => current + PAGE_SIZE)}
            >
              Next
            </button>
          </div>
        </div>

        <p className="pagination-note">
          Pagination uses <code>limit</code>, <code>offset</code>,{' '}
          <code>has_more</code>, and <code>next_offset</code>. The API does not return a total
          result count, so no total is shown.
        </p>
      </Card>
    </>
  )
}
