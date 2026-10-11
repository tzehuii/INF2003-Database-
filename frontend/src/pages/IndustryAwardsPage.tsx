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
 * invented industry analytics and no data-backed chart are shown. A branch
 * ranking chart would duplicate the table, and the page avoids charts or metrics
 * the data does not support.
 *
 * Once the backend query is implemented, the table shows one row per immediate
 * child branch: the branch title, total award amount, award row count, company
 * count, and share percentage, ordered by total amount descending and industry
 * code ascending. The summary coverage counts report how many award rows are
 * excluded for lack of a usable company link or a valid primary SSIC.
 */

import { useState } from 'react'
import { API_ROUTES, isLiveData } from '../api/client'
import type { IndustryAwardsData } from '../api/client'
import { PLACEHOLDER_INDUSTRY_PARENTS } from '../api/mockData'
import { useApiResource } from '../api/useApiResource'
import {
  BackendStatusStrip,
  EmptyState,
  PageHeading,
  Panel,
  PanelFooter,
  PanelNotes,
} from '../components/ui'

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
        icon="industry"
        title="Industry Awards"
        description="Compare tender award totals across SSIC industry branches."
      />

      <Panel title="Industry Branch Results">
        <form className="toolbar" onSubmit={runSearch}>
          <div className="toolbar-row toolbar-row-fields">
            <label className="field field-grow">
              <span className="field-label">Industry / Parent</span>
              <select
                className="input"
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
            </label>

            <label className="field">
              <span className="field-label">Start Date</span>
              <input
                type="date"
                className="input"
                value={draft.startDate}
                onChange={(event) => setDraft({ ...draft, startDate: event.target.value })}
              />
            </label>

            <label className="field">
              <span className="field-label">End Date</span>
              <input
                type="date"
                className="input"
                value={draft.endDate}
                onChange={(event) => setDraft({ ...draft, endDate: event.target.value })}
              />
            </label>

            <div className="toolbar-end">
              <button type="submit" className="button button-primary">
                Search
              </button>
              <button type="button" className="button button-secondary" onClick={reset}>
                Reset
              </button>
            </div>
          </div>
        </form>

        <BackendStatusStrip
          route={API_ROUTES.industryAwards}
          result={result}
          isLoading={isLoading}
        />

        <EmptyState title="No results yet">
          {!isLiveData(result) && 'Results appear here once the route is implemented.'}
        </EmptyState>

        <PanelFooter>
          <PanelNotes>
            <p>{COVERAGE_NOTE}</p>
            <p>
              Grouping is by section when no parent is selected, or by the immediate children
              of the selected SSIC node.
            </p>
          </PanelNotes>
        </PanelFooter>
      </Panel>
    </>
  )
}
