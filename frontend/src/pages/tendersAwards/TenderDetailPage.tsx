// One tender with its awards: edit or delete the tender, and add, edit or delete awards.

import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { apiRequest } from '../../api/client'
import { useApiResource } from '../../api/useApiResource'
import { truncateText, useBreadcrumbTrail } from '../../breadcrumbContext'
import { ConfirmationBanner, InlineError, PageHeading, Panel, SkeletonRows } from '../../components/ui'
import { useDatabase } from '../../databaseContext'
import { AwardForm, TenderForm } from './forms'
import { API, NO_SUPPLIERS, TENDERS_PATH, TenderStatusBadge, dbLabel, formatSgd, tenderPath } from './shared'
import type { Award, Tender } from './shared'

type Editor = { kind: 'tender' } | { kind: 'award'; award?: Award }

export function TenderDetailPage() {
  const { database } = useDatabase()
  const navigate = useNavigate()
  const { tenderNo = '' } = useParams()
  const detail = useApiResource<Tender>(API.tender(tenderNo))
  const result = detail.result
  const tender = result?.state === 'success' && result.database === database ? result.body : null
  const [editor, setEditor] = useState<Editor | null>(null)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const label = dbLabel(database)
  useBreadcrumbTrail([{ label: 'Tenders & Awards', to: TENDERS_PATH }, { label: tenderNo, mono: true }])

  // Award IDs and the record itself differ per database, so close forms when switching.
  useEffect(() => { setEditor(null); setError('') }, [database])

  function saved(message: string) {
    setEditor(null); setNotice(message); setError(''); detail.reload()
  }

  async function removeTender(t: Tender) {
    const awards = t.award_count ? ` Its ${t.award_count} award${t.award_count === 1 ? '' : 's'} will also be deleted.` : ''
    if (!window.confirm(`Delete tender ${t.tender_no} from ${label}?${awards} This cannot be undone.`)) return
    setBusy(true); setError('')
    const outcome = await apiRequest<void>(API.tender(t.tender_no), database, {}, { method: 'DELETE' })
    setBusy(false)
    if (outcome.state !== 'success') { setError(outcome.message); return }
    navigate(TENDERS_PATH)
  }

  async function removeAward(t: Tender, award: Award) {
    if (!window.confirm(`Delete the award to ${award.supplier} (${formatSgd(award.amount)}) from ${label}? This cannot be undone.`)) return
    setBusy(true); setError(''); setNotice('')
    const outcome = await apiRequest<void>(API.award(t.tender_no, award.id), database, {}, { method: 'DELETE' })
    setBusy(false)
    if (outcome.state !== 'success') { setError(outcome.message); return }
    saved(`Award deleted from ${label}.`)
  }

  const loading = detail.isLoading || (result !== null && result.database !== database)

  return <>
    <PageHeading title={tender ? truncateText(tender.description, 120) : 'Tender details'} description={`Tender record and supplier awards in ${label}.`}
      actions={<button className="button company-navigation-button" onClick={() => navigate(TENDERS_PATH)}>Back to tenders</button>} />
    {notice && <ConfirmationBanner onDismiss={() => setNotice('')}>{notice}</ConfirmationBanner>}
    {error && <InlineError title="Request failed">{error}</InlineError>}

    {loading && !editor && <Panel><SkeletonRows count={4} label="Loading tender details" /></Panel>}
    {!loading && result && result.state !== 'success' && <InlineError title="Could not load tender" action={<button className="button button-secondary" onClick={detail.reload}>Retry</button>}>{result.message}</InlineError>}

    {tender && editor?.kind === 'tender' && <TenderForm tender={tender} onCancel={() => setEditor(null)} onDone={() => saved(`Tender saved to ${label}.`)} />}
    {tender && editor?.kind === 'award' && <AwardForm key={editor.award?.id ?? 'new'} tenderNo={tender.tender_no} award={editor.award} onCancel={() => setEditor(null)} onDone={() => saved(`Award saved to ${label}.`)} />}

    {tender && !loading && !editor && <>
      <Panel title={tender.tender_no} actions={<div className="company-actions">
        <button className="button company-edit-button button-sm" disabled={busy} onClick={() => { setNotice(''); setEditor({ kind: 'tender' }) }}>Edit tender</button>
        <button className="button company-delete-button button-sm" disabled={busy} onClick={() => removeTender(tender)}>Delete tender</button>
      </div>}>
        <div className="company-detail">
          <dl className="company-summary">
            <div><dt>Government agency</dt><dd>{tender.agency}</dd></div>
            <div><dt>Status</dt><dd><TenderStatusBadge status={tender.status} /></dd></div>
            <div><dt>Award date</dt><dd>{tender.award_date}</dd></div>
            <div><dt>Number of awards</dt><dd>{tender.award_count}</dd></div>
            <div><dt>Total awarded</dt><dd>{formatSgd(tender.total_amount)}</dd></div>
          </dl>
          <dl className="company-summary tender-description"><div><dt>Description</dt><dd>{tender.description}</dd></div></dl>
        </div>
      </Panel>

      <Panel title="Supplier awards" actions={<button className="button company-edit-button button-sm" disabled={busy || tender.status === NO_SUPPLIERS} onClick={() => { setNotice(''); setEditor({ kind: 'award' }) }}>Add award</button>}>
        {tender.status === NO_SUPPLIERS && <p className="company-note tender-panel-note">This tender is marked "{NO_SUPPLIERS}". Edit the tender and change its status to add awards.</p>}
        {tender.awards?.length === 0 && tender.status !== NO_SUPPLIERS && <p className="company-note tender-panel-note">No awards recorded. Use Add award to create one, or change the status to "{NO_SUPPLIERS}".</p>}
        {!!tender.awards?.length && <div className="company-table-scroll"><table className="company-table tender-table">
          <thead><tr><th>Award ID</th><th>Supplier</th><th className="tender-number">Amount</th><th><span className="visually-hidden">Actions</span></th></tr></thead>
          <tbody>{tender.awards.map(award => <tr key={award.id}>
            <td>{award.id}</td><td>{award.supplier}</td><td className="tender-number">{formatSgd(award.amount)}</td>
            <td><div className="company-actions">
              <button className="button company-edit-button button-sm" disabled={busy} onClick={() => { setNotice(''); setEditor({ kind: 'award', award }) }}>Edit</button>
              <button className="button company-delete-button button-sm" disabled={busy} onClick={() => removeAward(tender, award)}>Delete</button>
            </div></td>
          </tr>)}</tbody>
        </table></div>}
      </Panel>
    </>}
  </>
}

export function TenderCreatePage() {
  const navigate = useNavigate()
  useBreadcrumbTrail([{ label: 'Tenders & Awards', to: TENDERS_PATH }, { label: 'New tender' }])
  return <>
    <PageHeading title="Add tender" description="Record a GeBIZ tender and, optionally, its supplier awards." />
    <TenderForm onCancel={() => navigate(TENDERS_PATH)} onDone={tender => navigate(tenderPath(tender.tender_no))} />
  </>
}
