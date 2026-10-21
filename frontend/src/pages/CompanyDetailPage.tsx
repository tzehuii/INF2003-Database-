import { Link, useParams } from 'react-router-dom'
import { API_ROUTES, isLiveData } from '../api/client'
import type { CompanyDetail, CompanyAwardsData } from '../api/client'
import { useApiResource } from '../api/useApiResource'
import { BookmarkError, SaveCompanyButton } from '../api/bookmarks'
import { Attribute, AttributeList, LinkedAwardBadge, PageHeading, Panel, RegistryStatusBadge } from '../components/ui'
import { formatAddressLine, formatDate, formatLevelAndUnit, formatMoney } from '../format'
import { ResourceStatus } from './publicShared'
import AddressMap from '../components/AddressMap'
export default function CompanyDetailPage() {
  const { uen = '' } = useParams()
  const { result, isLoading } = useApiResource<CompanyDetail>(API_ROUTES.companyDetail(uen))
  const awards = useApiResource<CompanyAwardsData>(API_ROUTES.companyAwards(uen), { limit: 100 })
  const company = isLiveData(result) ? result.body : null
  return <>
    <PageHeading icon="companies" title={company?.name ?? (company ? uen : 'Company details')} meta={company ? <><span className="mono">{uen}</span><RegistryStatusBadge status={company.status} /></> : undefined} actions={<><Link className="button button-secondary" to="/companies">Back to companies</Link>{company && <SaveCompanyButton uen={uen} />}</>} />
    <BookmarkError /><ResourceStatus result={result} loading={isLoading} />
    {company && <>
      {/* OWNER: Tzehui - One card groups readable company sections without large empty panels. */}
      <Panel title="Company information" className="company-info-card">
      <section className="company-info-section" aria-label="Registered details"><h3 className="company-info-heading">Registered details</h3><AttributeList columns={2}><Attribute label="UEN">{company.uen}</Attribute><Attribute label="Registered date">{formatDate(company.incorporation_date)}</Attribute><Attribute label="Linked awards"><LinkedAwardBadge hasLinkedAward={company.has_linked_award} /></Attribute></AttributeList></section>
      {/* Public and System both show the complete address list from the selected database. */}
      <section className="company-info-section" aria-label="Registered addresses"><h3 className="company-info-heading">Registered addresses</h3>
        {(company.addresses ?? (company.address ? [company.address] : [])).length ?
          (company.addresses ?? (company.address ? [company.address] : [])).map((address, index) => <div className="public-company-address" key={index}>
            <h3>Address {index + 1}</h3>
            <AttributeList columns={2}>
              <Attribute label="Address type">{address.type}</Attribute>
              <Attribute label="Address">{formatAddressLine(address.block, address.street_name)}</Attribute>
              <Attribute label="Level / unit">{formatLevelAndUnit(address.level_no, address.unit_no)}</Attribute>
              <Attribute label="Building">{address.building_name}</Attribute>
              <Attribute label="Postal code">{address.postal_code}</Attribute>
              <Attribute label="Other address">{[address.other_address_line1, address.other_address_line2].filter(Boolean).join(', ') || '—'}</Attribute>
            </AttributeList>
          </div>) : <p className="company-info-empty">No address recorded.</p>}
      </section>
      <section className="company-info-section" aria-label="Business activities"><h3 className="company-info-heading">Business activities</h3><AttributeList>{(['primary', 'secondary'] as const).map(kind => <Attribute key={kind} label={`${kind === 'primary' ? 'Primary' : 'Secondary'} activity`}>{company.activities[kind] ? <>{company.activities[kind]?.code} — {company.activities[kind]?.title}<p className="muted-text">{company.activities[kind]?.source_description}</p></> : 'No activity recorded'}</Attribute>)}</AttributeList></section>
      <section className="company-info-section" aria-label="Former names"><h3 className="company-info-heading">Former names</h3>{company.former_names.length ? <ul className="plain-list">{company.former_names.map((name, i) => <li key={i}>{name}</li>)}</ul> : <p className="company-info-empty">No former names recorded.</p>}</section>
      <section className="company-info-section" aria-label="Linked awards"><h3 className="company-info-heading">Linked awards</h3><ResourceStatus result={awards.result} loading={awards.isLoading} />{isLiveData(awards.result) && (awards.result.body.items.length ? <><div className="table-scroll"><table className="table"><thead><tr><th>Tender</th><th>Agency</th><th>Supplier</th><th>Date</th><th className="cell-number">Amount (SGD)</th></tr></thead><tbody>{awards.result.body.items.map((row, i) => <tr key={`${row.tender_no}-${i}`}><td><span className="cell-id">{row.tender_no}</span><p>{row.tender_description}</p></td><td>{row.agency_name}</td><td>{row.supplier_name}</td><td className="cell-nowrap">{formatDate(row.award_date)}</td><td className="cell-number">{formatMoney(row.amount)}</td></tr>)}</tbody></table></div>{awards.result.meta?.pagination.has_more && <p className="panel-pad muted-text">Showing the most recent 100 linked awards.</p>}</> : <p className="company-info-empty">No linked awards. No awards have an accepted supplier link to this company.</p>)}</section>
      </Panel>
      {/* OWNER: Tzehui - Keep optional maps after the company information for easier reading. */}
      <Panel title="Address maps">
        {(company.addresses ?? (company.address ? [company.address] : [])).length ?
          (company.addresses ?? (company.address ? [company.address] : [])).map((address, index) => <div className="public-company-address" key={index}>
            <h3>Address {index + 1}</h3>
            <AddressMap address={address} companyName={company.name} />
          </div>) : <p className="company-info-empty">No address recorded.</p>}
      </Panel>
    </>}
  </>
}
