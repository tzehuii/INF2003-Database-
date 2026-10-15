// Create/edit forms. Every form saves only to the database selected in the header.

import { useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { apiRequest } from '../../api/client'
import { InlineError, Panel, PanelFooter } from '../../components/ui'
import { useDatabase } from '../../databaseContext'
import { API, AMOUNT_PATTERN, Field, NO_SUPPLIERS, OptionSelect, SupplierInput, dbLabel, isAmount, today, useTenderOptions } from './shared'
import type { Award, Tender } from './shared'

// Warn when a save finishes after the user switched databases, instead of showing the wrong result.
function useDatabaseGuard() {
  const { database } = useDatabase()
  const current = useRef(database)
  current.current = database
  return { database, changed: (sent: string) => current.current !== sent }
}

function SaveTarget() {
  const { database } = useDatabase()
  return <p className="company-save-target" role="status">Saving to <strong>{dbLabel(database)}</strong>. Switching databases keeps your draft; Save writes only to the selected database.</p>
}

function FormButtons({ busy, label, onCancel }: { busy: boolean; label: string; onCancel: () => void }) {
  return <PanelFooter><div className="company-actions address-form-actions">
    <button className="button address-save-button" disabled={busy}>{busy ? 'Saving…' : label}</button>
    <button type="button" className="button company-cancel-button" disabled={busy} onClick={onCancel}>Cancel</button>
  </div></PanelFooter>
}

type AwardDraft = { key: number; supplier: string; amount: string }

// One form for create and edit. The tender number and first awards are only entered on create.
export function TenderForm({ tender, onDone, onCancel }: { tender?: Tender; onDone: (tender: Tender) => void; onCancel: () => void }) {
  const { database, changed } = useDatabaseGuard()
  const options = useTenderOptions()
  const [tenderNo, setTenderNo] = useState(tender?.tender_no ?? '')
  const [description, setDescription] = useState(tender?.description ?? '')
  const [agency, setAgency] = useState(tender?.agency ?? '')
  const [status, setStatus] = useState(tender?.status ?? '')
  const [awardDate, setAwardDate] = useState(tender?.award_date ?? '')
  const [awards, setAwards] = useState<AwardDraft[]>(tender ? [] : [{ key: 0, supplier: '', amount: '' }])
  const nextKey = useRef(1)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const noSuppliers = status === NO_SUPPLIERS

  function updateAward(key: number, change: Partial<AwardDraft>) {
    setAwards(rows => rows.map(row => row.key === key ? { ...row, ...change } : row))
  }

  async function submit(event: FormEvent) {
    event.preventDefault(); setError('')
    if (!agency || !status) { setError('Choose an agency and a status.'); return }
    if (tender && noSuppliers && tender.award_count > 0) { setError(`Delete this tender's awards before marking it "${NO_SUPPLIERS}".`); return }
    // Blank award rows are ignored; a no-supplier tender sends no awards at all.
    const filled = noSuppliers ? [] : awards.filter(row => row.supplier.trim() || row.amount.trim())
    if (filled.some(row => !row.supplier.trim() || !isAmount(row.amount))) { setError('Each award needs a supplier and an amount (0 or more, up to 2 decimal places).'); return }
    const names = filled.map(row => row.supplier.trim().toLowerCase())
    if (new Set(names).size !== names.length) { setError('Each supplier can only be awarded once per tender.'); return }

    setBusy(true)
    const fields = { description: description.trim(), agency, status, award_date: awardDate }
    const body = tender ? fields : { ...fields, tender_no: tenderNo, awards: filled.map(row => ({ supplier: row.supplier.trim(), amount: row.amount.trim() })) }
    const result = await apiRequest<Tender>(tender ? API.tender(tender.tender_no) : API.tenders, database, {}, { method: tender ? 'PATCH' : 'POST', body })
    setBusy(false)
    if (changed(database)) { setError('The request finished for the previous database. Your draft is kept; check that database for its result.'); return }
    if (result.state === 'success') onDone(result.body)
    else setError(result.message)
  }

  return <Panel title={tender ? `Edit ${tender.tender_no}` : 'Add tender'}>
    <form onSubmit={submit}>
      <SaveTarget />
      <fieldset disabled={busy} className="company-form-grid">
        <Field label="Tender number" hint={tender ? 'The tender number cannot be changed after creation.' : 'Letters and digits only, for example ACR000ETT21000001. Cannot be changed later.'}>
          <input className="input" required pattern="[A-Z0-9]+" title="Letters and digits only" maxLength={100} value={tenderNo} disabled={!!tender} onChange={e => setTenderNo(e.target.value.toUpperCase().replace(/\s/g, ''))} />
        </Field>
        <Field label="Award date" hint="Cannot be in the future.">
          <input className="input" type="date" required min="2000-01-01" max={today()} value={awardDate} onChange={e => setAwardDate(e.target.value)} />
        </Field>
        <Field label="Government agency" error={options.failed ? 'Could not load agencies. Restart the backend if it has not loaded the new routes.' : undefined}>
          <OptionSelect required value={agency} onChange={setAgency} options={options.agencies} placeholder="Select agency" />
        </Field>
        <Field label="Tender status" hint={noSuppliers ? 'A tender with this status cannot have awards.' : undefined}>
          <OptionSelect required value={status} onChange={setStatus} options={options.statuses} placeholder="Select status" />
        </Field>
        <Field label="Description" wide>
          <textarea className="input tender-textarea" required maxLength={2000} rows={3} value={description} onChange={e => setDescription(e.target.value)} />
        </Field>
      </fieldset>

      {!tender && !noSuppliers && <div className="tender-award-drafts">
        <div className="company-address-heading"><h3>Awards</h3>
          <button type="button" className="button company-edit-button button-sm" disabled={busy || awards.length >= 200} onClick={() => setAwards(rows => [...rows, { key: nextKey.current++, supplier: '', amount: '' }])}>Add another award</button>
        </div>
        <p className="company-note">Optional. Suppliers must already exist in {dbLabel(database)}. You can also add awards after saving.</p>
        {awards.map((row, index) => <div className="tender-award-draft" key={row.key}>
          <Field label={`Supplier ${index + 1}`}><SupplierInput id={`draft-supplier-${row.key}`} value={row.supplier} onChange={supplier => updateAward(row.key, { supplier })} /></Field>
          <Field label="Amount (S$)"><input className="input" inputMode="decimal" pattern={AMOUNT_PATTERN} title="0 or more, up to 2 decimal places" value={row.amount} onChange={e => updateAward(row.key, { amount: e.target.value })} /></Field>
          <button type="button" className="button company-delete-button button-sm" disabled={busy} onClick={() => setAwards(rows => rows.filter(r => r.key !== row.key))}>Remove</button>
        </div>)}
      </div>}

      {error && <div className="company-form-error"><InlineError title="Could not save tender">{error}</InlineError></div>}
      <FormButtons busy={busy} label="Save tender" onCancel={onCancel} />
    </form>
  </Panel>
}

// Add or edit one supplier award on a tender.
export function AwardForm({ tenderNo, award, onDone, onCancel }: { tenderNo: string; award?: Award; onDone: (tender: Tender) => void; onCancel: () => void }) {
  const { database, changed } = useDatabaseGuard()
  const [originalDatabase] = useState(database)
  const [supplier, setSupplier] = useState(award?.supplier ?? '')
  const [amount, setAmount] = useState(award?.amount ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: FormEvent) {
    event.preventDefault(); setError('')
    if (!isAmount(amount)) { setError('Enter an amount of 0 or more with at most 2 decimal places.'); return }
    // Award IDs differ between databases, so an edit cannot follow a database switch.
    if (award && database !== originalDatabase) { setError(`This award was opened from ${dbLabel(originalDatabase)}. Cancel and open it again from ${dbLabel(database)}.`); return }
    setBusy(true)
    const result = await apiRequest<Tender>(award ? API.award(tenderNo, award.id) : API.tenderAwards(tenderNo), database, {},
      { method: award ? 'PATCH' : 'POST', body: { supplier: supplier.trim(), amount: amount.trim() } })
    setBusy(false)
    if (changed(database)) { setError('The request finished for the previous database. Your draft is kept; check that database for its result.'); return }
    if (result.state === 'success') onDone(result.body)
    else setError(result.message)
  }

  return <Panel title={`${award ? 'Edit' : 'Add'} award · ${tenderNo}`}>
    <form onSubmit={submit}>
      <SaveTarget />
      <fieldset disabled={busy} className="company-form-grid">
        <Field label="Supplier" hint="Choose an existing supplier from the suggestions."><SupplierInput id="award-supplier" value={supplier} onChange={setSupplier} /></Field>
        <Field label="Awarded amount (S$)" hint="0 or more, up to 2 decimal places."><input className="input" required inputMode="decimal" pattern={AMOUNT_PATTERN} title="0 or more, up to 2 decimal places" value={amount} onChange={e => setAmount(e.target.value)} /></Field>
      </fieldset>
      {error && <div className="company-form-error"><InlineError title="Could not save award">{error}</InlineError></div>}
      <FormButtons busy={busy} label="Save award" onCancel={onCancel} />
    </form>
  </Panel>
}
