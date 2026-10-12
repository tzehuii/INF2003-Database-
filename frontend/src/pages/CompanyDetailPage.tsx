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
import { API_ROUTES, isLiveData, isSupplierMatchingNotReady } from '../api/client'
import type { CompanyDetail } from '../api/client'
import { PLACEHOLDER_COMPANY_DETAILS } from '../api/mockData'
import { useApiResource } from '../api/useApiResource'
import {
  Attribute,
  AttributeList,
  BackendStatusStrip,
  EmptyState,
  LinkedAwardBadge,
  PageHeading,
  Panel,
  PanelFooter,
  PanelNotes,
  PlaceholderNotice,
  RegistryStatusBadge,
  SampleDataBadge,
  StatusBadge,
} from '../components/ui'
import { EMPTY_VALUE, formatAddressLine, formatDate, formatLevelAndUnit } from '../format'

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
      <AttributeList>
        <Attribute label="Activity code">
          {activity.code ? <span className="mono">{activity.code}</span> : EMPTY_VALUE}
        </Attribute>
        <Attribute label="Activity title">{activity.title ?? EMPTY_VALUE}</Attribute>
        <Attribute label="Source description" raw>
          {activity.source_description ?? EMPTY_VALUE}
        </Attribute>
      </AttributeList>
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
  const live = isLiveData(result)

  const primary = company?.activities.primary ?? null
  const linkedAwardsUnavailable = company?.has_linked_award === null || !live

  return (
    <>
      <PageHeading
        icon="companies"
        title={company?.name ?? 'Company Detail'}
        description={
          company === null
            ? 'Registered details, activities, and linked awards for one company.'
            : undefined
        }
        meta={
          company !== null ? (
            <>
              <span className="mono">{company.uen}</span>
              <RegistryStatusBadge status={company.status} />
            </>
          ) : undefined
        }
        actions={
          <Link to="/companies" className="button button-secondary">
            Back to search
          </Link>
        }
      />

      <BackendStatusStrip
        route={API_ROUTES.companyDetail(uen)}
        result={result}
        isLoading={isLoading}
        variant="standalone"
      />

      {company === null ? (
        <Panel title="Company">
          <EmptyState title="Company not found">
            <p>
              No company with UEN <strong>{uen}</strong>.
            </p>
            <p>
              <Link to="/companies">Return to the company search</Link>
            </p>
          </EmptyState>
        </Panel>
      ) : (
        <>
          <Panel
            title="Summary"
            badge={!live ? <SampleDataBadge /> : undefined}
            actions={
              <>
                {!live && (
                  <span className="panel-action-note">
                    Unavailable until saved lists are implemented (HTTP 501).
                  </span>
                )}
                <button type="button" className="button button-primary" disabled>
                  Save to List
                </button>
              </>
            }
          >
            <AttributeList columns={2}>
              <Attribute label="UEN">
                <span className="mono">{company.uen}</span>
              </Attribute>
              <Attribute label="Registry status">
                <RegistryStatusBadge status={company.status} />
              </Attribute>
              <Attribute label="Incorporation date">
                {formatDate(company.incorporation_date)}
              </Attribute>
              <Attribute label="Primary activity">
                {primary ? (
                  <>
                    <span className="activity-code">{primary.code ?? EMPTY_VALUE}</span>{' '}
                    {primary.title ?? ''}
                  </>
                ) : (
                  EMPTY_VALUE
                )}
              </Attribute>
              <Attribute label="Linked award">
                <LinkedAwardBadge hasLinkedAward={company.has_linked_award} />
              </Attribute>
            </AttributeList>
            {!live && (
              <PanelFooter>
                <PanelNotes>
                  <PlaceholderNotice />
                </PanelNotes>
              </PanelFooter>
            )}
          </Panel>

          <div className="panel-grid">
            <Panel title="Address">
              <AttributeList>
                <Attribute label="Address type">{company.address?.type ?? EMPTY_VALUE}</Attribute>
                <Attribute label="Block / Street">
                  {formatAddressLine(company.address?.block, company.address?.street_name)}
                </Attribute>
                <Attribute label="Level / Unit" optional>
                  {formatLevelAndUnit(company.address?.level_no, company.address?.unit_no)}
                </Attribute>
                <Attribute label="Building" optional>
                  {company.address?.building_name ?? EMPTY_VALUE}
                </Attribute>
                <Attribute label="Postal code">
                  {company.address?.postal_code ? (
                    <span className="mono">{company.address.postal_code}</span>
                  ) : (
                    EMPTY_VALUE
                  )}
                </Attribute>
                <Attribute label="Other address line 1" optional>
                  {company.address?.other_address_line1 ?? EMPTY_VALUE}
                </Attribute>
                <Attribute label="Other address line 2" optional>
                  {company.address?.other_address_line2 ?? EMPTY_VALUE}
                </Attribute>
              </AttributeList>
            </Panel>

            <Panel title="Activities">
              <div className="panel-pad">
                <ActivityBlock heading="Primary Activity" activity={company.activities.primary} />
                <ActivityBlock
                  heading="Secondary Activity"
                  activity={company.activities.secondary}
                />
              </div>
            </Panel>
          </div>

          <Panel title="Former Names">
            {company.former_names.length === 0 ? (
              <EmptyState title="No former names">
                No former names are recorded for this company.
              </EmptyState>
            ) : (
              <ul className="plain-list">
                {company.former_names.map((formerName) => (
                  <li key={formerName}>{formerName}</li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel
            title="Linked Awards"
            badge={linkedAwardsUnavailable ? <StatusBadge tone="warning">Unavailable</StatusBadge> : undefined}
          >
            {linkedAwardsUnavailable ? (
              <EmptyState tone="warning" icon="warning" title="Linked awards are not available yet.">
                <p>
                  Supplier-to-company matching is not ready (HTTP 409{' '}
                  <code>supplier_matching_not_ready</code>).
                </p>
                {supplierMatchingBlocked && (
                  <p>The request just returned that blocked state for the selected database.</p>
                )}
              </EmptyState>
            ) : (
              // TODO: a linked-awards data route is not wired yet, so no rows are listed.
              <EmptyState title="Linked award rows will appear here." />
            )}
          </Panel>
        </>
      )}
    </>
  )
}
