/**
 * Company Detail page.
 *
 * Display company information for one selected company.
 *
 * Only fields the API returns are shown. Former names are names only, because
 * no effective-from or effective-to dates are returned. The linked-awards area
 * shows the unavailable state rather than fake award rows.
 */

import { Link, useParams } from 'react-router-dom'
import { API_ROUTES, isSupplierMatchingNotReady } from '../api/client'
import type { CompanyDetail } from '../api/client'
import { PLACEHOLDER_COMPANY_DETAILS } from '../api/mockData'
import { useApiResource } from '../api/useApiResource'
import { BackendStatusStrip, Card, LinkedAwardBadge, PlaceholderNotice, StatusBadge } from '../components/ui'
import { EMPTY_VALUE, formatAddressLine, formatDate, formatLevelAndUnit } from '../format'

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="detail-row">
      <dt className="detail-label">{label}</dt>
      <dd className="detail-value">{children}</dd>
    </div>
  )
}

function ActivityBlock({
  heading,
  activity,
}: {
  heading: string
  activity: CompanyDetail['activities']['primary']
}) {
  if (activity === null) {
    return (
      <div className="activity-block">
        <h3 className="activity-heading">{heading}</h3>
        <p className="muted-text">
          No {heading.toLowerCase()} activity is recorded for this company.
        </p>
      </div>
    )
  }

  return (
    <div className="activity-block">
      <h3 className="activity-heading">{heading}</h3>
      <dl className="detail-list detail-list-compact">
        <DetailRow label="Activity code">{activity.code ?? EMPTY_VALUE}</DetailRow>
        <DetailRow label="Activity title">{activity.title ?? EMPTY_VALUE}</DetailRow>
        <DetailRow label="Source description">
          {activity.source_description ?? EMPTY_VALUE}
        </DetailRow>
      </dl>
    </div>
  )
}

export default function CompanyDetailPage() {
  const { uen = '' } = useParams<{ uen: string }>()

  const { result, isLoading } = useApiResource<CompanyDetail>(
    API_ROUTES.companyDetail(uen),
  )

  const company = PLACEHOLDER_COMPANY_DETAILS[uen] ?? null
  const supplierMatchingBlocked = result !== null && isSupplierMatchingNotReady(result)

  return (
    <>
      <div className="page-heading">
        <div className="page-heading-copy">
          <p className="breadcrumb">
            <Link to="/companies">Companies</Link>
            <span aria-hidden="true"> / </span>
            <span>{uen}</span>
          </p>
          <h1>{company?.name ?? 'Company Detail'}</h1>
          <p className="page-description">
            Registered details, activities, and linked awards for one company.
          </p>
        </div>
        <Link to="/companies" className="button button-secondary detail-back-link">
          Back to search
        </Link>
      </div>

      <BackendStatusStrip
        route={API_ROUTES.companyDetail(uen)}
        result={result}
        isLoading={isLoading}
      />

      {company === null ? (
        <Card title="Company">
          <p className="empty-state">
            No company is available for UEN <strong>{uen}</strong> in the current
            sample data. Real company detail loading arrives once the route is
            implemented.
          </p>
          <p className="empty-state">
            <Link to="/companies">Return to the company search</Link>
          </p>
        </Card>
      ) : (
        <>
          <Card title="Summary">
            <PlaceholderNotice />
            <dl className="detail-list detail-list-columns">
              <DetailRow label="Company Name">{company.name ?? EMPTY_VALUE}</DetailRow>
              <DetailRow label="UEN">{company.uen}</DetailRow>
              <DetailRow label="Registry Status">
                <span className="status-text">{company.status}</span>
              </DetailRow>
              <DetailRow label="Incorporation Date">
                {formatDate(company.incorporation_date)}
              </DetailRow>
              <DetailRow label="Primary Activity">
                {company.activities.primary
                  ? `${company.activities.primary.code ?? EMPTY_VALUE} ${company.activities.primary.title ?? ''}`.trim()
                  : EMPTY_VALUE}
              </DetailRow>
              <DetailRow label="Linked Award">
                <LinkedAwardBadge hasLinkedAward={company.has_linked_award} />
              </DetailRow>
            </dl>
            <div className="card-actions card-actions-bottom">
              <button type="button" className="button button-primary" disabled>
                Save to List
              </button>
              <span className="inline-note">
                Saved-list persistence is unavailable while the backend route returns
                HTTP 501.
              </span>
            </div>
          </Card>

          <div className="detail-grid">
            <Card title="Address">
              <dl className="detail-list">
                <DetailRow label="Address type">{company.address?.type ?? EMPTY_VALUE}</DetailRow>
                <DetailRow label="Block / Street">
                  {formatAddressLine(company.address?.block, company.address?.street_name)}
                </DetailRow>
                <DetailRow label="Level / Unit">
                  {formatLevelAndUnit(company.address?.level_no, company.address?.unit_no)}
                </DetailRow>
                <DetailRow label="Building">
                  {company.address?.building_name ?? EMPTY_VALUE}
                </DetailRow>
                <DetailRow label="Postal code">
                  {company.address?.postal_code ?? EMPTY_VALUE}
                </DetailRow>
                <DetailRow label="Other address line 1">
                  {company.address?.other_address_line1 ?? EMPTY_VALUE}
                </DetailRow>
                <DetailRow label="Other address line 2">
                  {company.address?.other_address_line2 ?? EMPTY_VALUE}
                </DetailRow>
              </dl>
            </Card>

            <Card title="Activities">
              <ActivityBlock heading="Primary Activity" activity={company.activities.primary} />
              <ActivityBlock heading="Secondary Activity" activity={company.activities.secondary} />
            </Card>
          </div>

          <Card title="Former Names">
            {company.former_names.length === 0 ? (
              <p className="empty-state">No former names are recorded for this company.</p>
            ) : (
              <ul className="plain-list">
                {company.former_names.map((formerName) => (
                  <li key={formerName}>{formerName}</li>
                ))}
              </ul>
            )}
            <p className="pagination-note">
              Former names are shown as names only. No effective-from or effective-to
              dates are returned, so none are shown.
            </p>
          </Card>

          <Card title="Linked Awards">
            <div className="unavailable-state">
              <StatusBadge tone="warning">Unavailable</StatusBadge>
              <div>
                <p className="unavailable-title">Linked awards are not available yet.</p>
                <p className="unavailable-message">
                  Linked awards are reached through accepted supplier-company links.
                  Supplier-to-company matching is not ready, so the backend blocks this
                  section with HTTP 409 <code>supplier_matching_not_ready</code> instead
                  of returning award rows.
                </p>
                {supplierMatchingBlocked && (
                  <p className="unavailable-message">
                    The request just returned that blocked state for the selected
                    database.
                  </p>
                )}
              </div>
            </div>
          </Card>
        </>
      )}
    </>
  )
}
