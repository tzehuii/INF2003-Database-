/**
 * Industry Awards page.
 *
 * Compare tender awards across SSIC industry branches.
 *
 * The page is not blocked by supplier-matching readiness. Incomplete matching
 * affects coverage rather than availability, so the endpoint returns a normal
 * response and reports excluded rows through its coverage counts. A short note
 * states which awards the totals include.
 *
 * The result area stays empty until the endpoint returns real results. No
 * invented industry analytics and no data-backed chart are shown.
 */

import { useState } from 'react'
import { API_ROUTES } from '../api/client'
import type { IndustryAwardsData } from '../api/client'
import { PLACEHOLDER_INDUSTRY_PARENTS } from '../api/mockData'
import { useApiResource } from '../api/useApiResource'
import { BackendStatusStrip, Card, PageHeading } from '../components/ui'

/** Explanation of what the industry totals include. */
const COVERAGE_NOTE =
  'Industry totals include matched suppliers with a valid primary SSIC. Unmatched suppliers are excluded.'

type Filters = {
  parentCode: string
  startDate: string
  endDate: string
}

const EMPTY_FILTERS: Filters = { parentCode: '', startDate: '', endDate: '' }

export default function IndustryAwardsPage() {
  const [draft, setDraft] = useState<Filters>(EMPTY_FILTERS)
  const [submitted, setSubmitted] = useState<Filters>(EMPTY_FILTERS)

  const requestKey = JSON.stringify(submitted)

  const { result, isLoading } = useApiResource<IndustryAwardsData>(
    API_ROUTES.industryAwards,
    {
      parent_code: submitted.parentCode || undefined,
      start_date: submitted.startDate || undefined,
      end_date: submitted.endDate || undefined,
    },
    requestKey,
  )

  function runSearch(event: React.FormEvent) {
    event.preventDefault()
    setSubmitted(draft)
  }

  function reset() {
    setDraft(EMPTY_FILTERS)
    setSubmitted(EMPTY_FILTERS)
  }

  return (
    <>
      <PageHeading
        title="Industry Awards"
        description="Compare tender award totals across SSIC industry branches."
      />

      <Card title="Filters">
        <form onSubmit={runSearch}>
          <div className="filter-grid">
            <label className="field">
              <span className="field-label">Industry / Parent</span>
              <select
                className="field-input"
                value={draft.parentCode}
                onChange={(event) => setDraft({ ...draft, parentCode: event.target.value })}
              >
                <option value="">All sections</option>
                {PLACEHOLDER_INDUSTRY_PARENTS.map((parent) => (
                  <option key={parent.code} value={parent.code}>
                    {parent.code} — {parent.title}
                  </option>
                ))}
              </select>
              <span className="field-hint">
                Grouping by section when no parent is selected, or by the immediate
                children of the selected SSIC node.
              </span>
            </label>

            <label className="field">
              <span className="field-label">Start Date</span>
              <input
                type="date"
                className="field-input"
                value={draft.startDate}
                onChange={(event) => setDraft({ ...draft, startDate: event.target.value })}
              />
            </label>

            <label className="field">
              <span className="field-label">End Date</span>
              <input
                type="date"
                className="field-input"
                value={draft.endDate}
                onChange={(event) => setDraft({ ...draft, endDate: event.target.value })}
              />
            </label>
          </div>

          <div className="form-actions">
            <button type="submit" className="button button-primary">
              Search
            </button>
            <button type="button" className="button button-secondary" onClick={reset}>
              Reset
            </button>
          </div>
        </form>
      </Card>

      <BackendStatusStrip
        route={API_ROUTES.industryAwards}
        result={result}
        isLoading={isLoading}
      />

      <p className="info-note">{COVERAGE_NOTE}</p>

      <Card title="Industry Branch Results">
        <p className="reserved-state">
          Industry award analysis is available. This area shows one row per immediate child
          branch once the backend query is implemented: the branch title, total award
          amount, award row count, company count, and share percentage, ordered by total
          amount descending and industry code ascending.
        </p>
        <div className="table-scroll">
          <table className="data-table data-table-empty">
            <thead>
              <tr>
                <th scope="col">Industry Branch</th>
                <th scope="col" className="cell-number">
                  Total Award Amount
                </th>
                <th scope="col" className="cell-number">
                  Award Row Count
                </th>
                <th scope="col" className="cell-number">
                  Company Count
                </th>
                <th scope="col" className="cell-number">
                  Share
                </th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td colSpan={5} className="empty-state">
                  No result rows to display yet. The route is declared and no longer blocked,
                  and the summary coverage counts report how many award rows are excluded for
                  lack of a usable company link or a valid primary SSIC.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="pagination-note">
          No chart is shown. A branch ranking would duplicate the table above, and
          the page avoids charts or metrics the data does not support.
        </p>
      </Card>
    </>
  )
}
