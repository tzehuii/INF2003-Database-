// One supplier with its company link and awards: rename or delete it, and change its company link.

import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { apiRequest } from '../../api/client'
import { useApiResource } from '../../api/useApiResource'
import { truncateText, useBreadcrumbTrail } from '../../breadcrumbContext'
import { ConfirmationBanner, InlineError, PageHeading, Panel, RegistryStatusBadge, SkeletonRows } from '../../components/ui'
import { useDatabase } from '../../databaseContext'
import { dbLabel, formatSgd, tenderPath } from '../tendersAwards/shared'
import { LinkForm, SupplierForm } from './forms'
import { API, LinkBadge, SUPPLIERS_PATH, supplierPath } from './shared'
import type { Supplier } from './shared'

type Editor = 'name' | 'link'

export function SupplierDetailPage() {
  const { database } = useDatabase()
  const navigate = useNavigate()
  const { name = '' } = useParams()
  const detail = useApiResource<Supplier>(API.supplier, { name })
  const result = detail.result
  const supplier = result?.state === 'success' && result.database === database ? result.body : null
  const [editor, setEditor] = useState<Editor | null>(null)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const label = dbLabel(database)
  useBreadcrumbTrail([{ label: 'Suppliers', to: SUPPLIERS_PATH }, { label: truncateText(name, 60), title: name }])

  // The supplier may differ between databases, so close forms when switching.
  useEffect(() => { setEditor(null); setError('') }, [database])

  function saved(updated: Supplier, message: string) {
    setEditor(null); setNotice(message); setError('')
    // A rename changes the address of this page.
    if (updated.name !== name) navigate(supplierPath(updated.name), { replace: true })
    else detail.reload()
  }

  async function remove(s: Supplier) {
    if (!window.confirm(`Delete supplier ${s.name} from ${label}? Its company link is removed too. This cannot be undone.`)) return
    setBusy(true); setError('')
    const outcome = await apiRequest<void>(API.supplier, database, { name: s.name }, { method: 'DELETE' })
    setBusy(false)
    if (outcome.state !== 'success') { setError(outcome.message); return }
    navigate(SUPPLIERS_PATH)
  }

  const loading = detail.isLoading || (result !== null && result.database !== database)
  const link = supplier?.link

  return <>
    <PageHeading title={supplier ? supplier.name : 'Supplier details'} description={`Supplier record, company link and awards in ${label}.`}
      actions={<button className="button company-navigation-button" onClick={() => navigate(SUPPLIERS_PATH)}>Back to suppliers</button>} />
    {notice && <ConfirmationBanner onDismiss={() => setNotice('')}>{notice}</ConfirmationBanner>}
    {error && <InlineError title="Request failed">{error}</InlineError>}

    {loading && !editor && <Panel><SkeletonRows count={4} label="Loading supplier details" /></Panel>}
    {!loading && result && result.state !== 'success' && <InlineError title="Could not load supplier" action={<button className="button button-secondary" onClick={detail.reload}>Retry</button>}>{result.message}</InlineError>}

    {supplier && editor === 'name' && <SupplierForm supplier={supplier} onCancel={() => setEditor(null)} onDone={s => saved(s, `Supplier renamed in ${label}.`)} />}
    {supplier && editor === 'link' && <LinkForm supplier={supplier} onCancel={() => setEditor(null)} onDone={s => saved(s, `Company link saved to ${label}.`)} />}

    {supplier && link && !loading && !editor && <>
      <Panel title="Supplier" actions={<div className="company-actions">
        <button className="button company-edit-button button-sm" disabled={busy} onClick={() => { setNotice(''); setEditor('name') }}>Rename</button>
        <button className="button company-delete-button button-sm" disabled={busy || supplier.award_count > 0}
          title={supplier.award_count > 0 ? 'Delete or reassign this supplier\'s awards in Tenders & Awards first.' : undefined}
          onClick={() => remove(supplier)}>Delete supplier</button>
      </div>}>
        <div className="company-detail">
          <dl className="company-summary">
            <div><dt>Normalized name</dt><dd className="mono">{supplier.normalized_name}</dd></div>
            <div><dt>Number of awards</dt><dd>{supplier.award_count}</dd></div>
            <div><dt>Total awarded</dt><dd>{formatSgd(supplier.total_amount)}</dd></div>
          </dl>
          {supplier.award_count > 0 && <p className="company-note">A supplier with awards cannot be deleted. Delete its awards, or give them to another supplier, in Tenders &amp; Awards first.</p>}
        </div>
      </Panel>

      <Panel title="Company link" badge={<LinkBadge status={link.status} candidates={link.candidate_count} />}
        actions={<button className="button company-edit-button button-sm" disabled={busy} onClick={() => { setNotice(''); setEditor('link') }}>Change link</button>}>
        <div className="company-detail">
          {link.company ? <>
            <dl className="company-summary">
              <div><dt>Company</dt><dd>{link.company.name ?? 'Not found in this database'}</dd></div>
              <div><dt>UEN</dt><dd className="mono">{link.company.uen}</dd></div>
              <div><dt>Registry status</dt><dd>{link.company.status ? <RegistryStatusBadge status={link.company.status} /> : '—'}</dd></div>
            </dl>
            <div className="company-actions supplier-link-actions">
              <span className="company-note">{link.method === 'manual' ? 'Linked manually.' : 'Matched automatically: the only registered company with the same normalized name.'}</span>
              <button className="button company-navigation-button button-sm" onClick={() => navigate(`/system/companies-addresses/${encodeURIComponent(link.company!.uen)}`)}>Open company</button>
            </div>
          </> : link.status === 'ambiguous'
            ? <p className="company-note">{link.candidate_count} registered companies share the normalized name "{supplier.normalized_name}", so the supplier is not credited to any of them. Use Change link to choose one.</p>
            : <p className="company-note">No company is linked, so this supplier's awards are not credited to a company on the public pages. Use Change link to choose one.</p>}
        </div>
      </Panel>

      <Panel title="Awards">
        {supplier.awards.length === 0 && <p className="company-note tender-panel-note">No awards yet. Add one from a tender in Tenders &amp; Awards.</p>}
        {supplier.awards.length > 0 && <div className="company-table-scroll"><table className="company-table tender-table">
          <thead><tr><th>Tender no.</th><th>Description</th><th>Agency</th><th>Award date</th><th className="tender-number">Amount</th><th><span className="visually-hidden">Actions</span></th></tr></thead>
          <tbody>{supplier.awards.map(award => <tr key={`${award.tender_no}-${award.id}`}>
            <td>{award.tender_no}</td><td><span className="tender-clamp" title={award.description}>{award.description}</span></td>
            <td className="tender-agency">{award.agency}</td><td className="tender-date">{award.award_date}</td>
            <td className="tender-number">{formatSgd(award.amount)}</td>
            <td><button className="button company-navigation-button button-sm" onClick={() => navigate(tenderPath(award.tender_no))}>Open tender</button></td>
          </tr>)}</tbody>
        </table></div>}
      </Panel>
    </>}
  </>
}

export function SupplierCreatePage() {
  const navigate = useNavigate()
  useBreadcrumbTrail([{ label: 'Suppliers', to: SUPPLIERS_PATH }, { label: 'New supplier' }])
  return <>
    <PageHeading title="Add supplier" description="Record a GeBIZ supplier. Awards are added to it from tenders in Tenders & Awards." />
    <SupplierForm onCancel={() => navigate(SUPPLIERS_PATH)} onDone={supplier => navigate(supplierPath(supplier.name))} />
  </>
}
