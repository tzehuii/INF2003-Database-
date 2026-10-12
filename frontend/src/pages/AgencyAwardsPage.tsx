/**
 * Agency Awards page.
 *
 * View suppliers and awarded amounts for a selected government agency.
 *
 * It shows three summary figures only, with no top-suppliers chart, and reports
 * the excluded no-supplier tender count as a small informational line rather
 * than a fourth figure.
 */

import { useState } from 'react'
import { API_ROUTES, isLiveData } from '../api/client'
import type { AgencyAwardsData } from '../api/client'
import {
  PLACEHOLDER_AGENCIES,
  PLACEHOLDER_AGENCY_SUPPLIERS,
  PLACEHOLDER_AGENCY_SUMMARY,
} from '../api/mockData'
import { useApiResource } from '../api/useApiResource'
import {
  BackendStatusStrip,
  EmptyState,
  PageHeading,
  Pagination,
  Panel,
  PanelFooter,
  PanelNotes,
  PlaceholderNotice,
  SampleDataBadge,
  StatusBadge,
} from '../components/ui'
import { formatMoney, formatPercent } from '../format'

/** Page size for the offset pagination the API uses. */
const PAGE_SIZE = 5

type Filters = {
  agencyName: string
  startDate: string
  endDate: string
  aboveAverageOnly: boolean
}

const DEFAULT_AGENCY = PLACEHOLDER_AGENCIES[0]

const EMPTY_FILTERS: Filters = {
  agencyName: DEFAULT_AGENCY,
  startDate: '',
  endDate: '',
  aboveAverageOnly: false,
}

export default function AgencyAwardsPage() {
  const [draft, setDraft] = useState<Filters>(EMPTY_FILTERS)
  const [submitted, setSubmitted] = useState<Filters>(EMPTY_FILTERS)
  const [offset, setOffset] = useState(0)

  const requestKey = `${JSON.stringify(submitted)}|${offset}`

  const { result, isLoading } = useApiResource<AgencyAwardsData>(
    API_ROUTES.agencyAwards,
    {
      agency_name: submitted.agencyName,
      start_date: submitted.startDate || undefined,
      end_date: submitted.endDate || undefined,
      above_average_only: submitted.aboveAverageOnly ? true : undefined,
      limit: PAGE_SIZE,
      offset,
    },
    requestKey,
  )

  // The summary is calculated from the full filtered result, before pagination
  // and before the above-average option removes supplier rows, which is the rule
  // the API states. The date range is not applied to the placeholder rows because
  // the sample data carries no award dates. Suppliers without an accepted company
  // link stay visible with a null company identity, as the API defines.
  const allSuppliers = PLACEHOLDER_AGENCY_SUPPLIERS
  const averageTotal =
    allSuppliers.length === 0
      ? 0
      : allSuppliers.reduce((sum, row) => sum + Number(row.total_award_amount), 0) /
        allSuppliers.length

  const visibleSuppliers = submitted.aboveAverageOnly
    ? allSuppliers.filter((row) => Number(row.total_award_amount) > averageTotal)
    : allSuppliers

  const rows = visibleSuppliers.slice(offset, offset + PAGE_SIZE)
  const hasPrevious = offset > 0
  const hasNext = offset + PAGE_SIZE < visibleSuppliers.length


  const supplierMatchingWarning =
    result !== null && result.state === 'not_implemented'
      ? 'Agency analysis does not depend on supplier matching.'
      : undefined

  function runSearch(event: React.FormEvent) {
    event.preventDefault()
    setSubmitted(draft)
    setOffset(0)
  }

  function reset() {
    setDraft(EMPTY_FILTERS)
    setSubmitted(EMPTY_FILTERS)
    setOffset(0)
  }

  return (
    <>
      <PageHeading
        icon="agency"
        title="Agency Awards"
        description="Suppliers and awarded amounts for one government agency and period."
      />

      <Panel title="Suppliers" badge={!isLiveData(result) ? <SampleDataBadge /> : undefined}>
        <form className="toolbar" onSubmit={runSearch}>
          <div className="toolbar-row toolbar-row-fields">
            <label className="field field-grow">
              <span className="field-label">Agency</span>
              <select
                className="input"
                value={draft.agencyName}
                onChange={(event) => setDraft({ ...draft, agencyName: event.target.value })}
              >
                {PLACEHOLDER_AGENCIES.map((agency) => (
                  <option key={agency} value={agency}>
                    {agency}
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

            <label className="checkbox-item">
              <input
                type="checkbox"
                checked={draft.aboveAverageOnly}
                onChange={(event) =>
                  setDraft({ ...draft, aboveAverageOnly: event.target.checked })
                }
              />
              <span>Above Average Only</span>
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

          {draft.aboveAverageOnly && (
            <p className="field-hint">
              Keeps suppliers whose total is above the average across the filtered result
              {allSuppliers.length > 0 && <> ({formatMoney(averageTotal.toFixed(2))})</>}.
            </p>
          )}
        </form>

        <BackendStatusStrip
          route={API_ROUTES.agencyAwards}
          result={result}
          isLoading={isLoading}
          note={supplierMatchingWarning}
        />

        <div className="stat-band" role="group" aria-label="Agency summary">
          <dl className="stat-strip">
            <div className="stat">
              <dt className="stat-label">Supplier Count</dt>
              <dd className="stat-value">{PLACEHOLDER_AGENCY_SUMMARY.supplier_count}</dd>
            </div>
            <div className="stat">
              <dt className="stat-label">Tender Count</dt>
              <dd className="stat-value">{PLACEHOLDER_AGENCY_SUMMARY.tender_count}</dd>
            </div>
            <div className="stat">
              <dt className="stat-label">Total Award Amount</dt>
              <dd className="stat-value">
                {formatMoney(PLACEHOLDER_AGENCY_SUMMARY.total_award_amount)}
              </dd>
            </div>
          </dl>
          <p className="stat-footnote">
            {PLACEHOLDER_AGENCY_SUMMARY.excluded_no_supplier_tender_count} tenders without a
            named supplier were excluded from this analysis.
          </p>
        </div>

        {rows.length === 0 ? (
          <EmptyState title="No suppliers found">
            No suppliers match the current filters.
          </EmptyState>
        ) : (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Supplier</th>
                  <th scope="col" className="cell-number">
                    Total award amount
                  </th>
                  <th scope="col" className="cell-number">
                    Tender count
                  </th>
                  <th scope="col" className="cell-number">
                    Share
                  </th>
                  <th scope="col">Company</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.supplier_name}>
                    <td className="cell-primary">{row.supplier_name}</td>
                    <td className="cell-number">{formatMoney(row.total_award_amount)}</td>
                    <td className="cell-number">{row.tender_count}</td>
                    <td className="cell-number">{formatPercent(row.share_percent)}</td>
                    <td>
                      {row.company_link.status === 'accepted' ? (
                        <StatusBadge tone="success">Linked</StatusBadge>
                      ) : (
                        <StatusBadge tone="neutral">Not linked</StatusBadge>
                      )}
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
