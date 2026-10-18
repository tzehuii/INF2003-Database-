// Create/rename and company-link forms. Every form saves only to the database selected in the header.

import { useState } from 'react'
import type { FormEvent } from 'react'
import { apiRequest } from '../../api/client'
import { InlineError, Panel, RegistryStatusBadge } from '../../components/ui'
import { FormButtons, SaveTarget, useDatabaseGuard } from '../tendersAwards/forms'
import { Field, dbLabel } from '../tendersAwards/shared'
import { API } from './shared'
import type { Candidates, Supplier } from './shared'

const SWITCHED = 'The request finished for the previous database. Your draft is kept; check that database for its result.'

// One form for create and rename. New suppliers are matched to a company by name when saved.
export function SupplierForm({ supplier, onDone, onCancel }: { supplier?: Supplier; onDone: (supplier: Supplier) => void; onCancel: () => void }) {
  const { database, changed } = useDatabaseGuard()
  const [name, setName] = useState(supplier?.name ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: FormEvent) {
    event.preventDefault(); setError('')
    if (!/[a-z0-9]/i.test(name)) { setError('The supplier name needs at least one letter or digit.'); return }
    setBusy(true)
    const result = supplier
      ? await apiRequest<Supplier>(API.supplier, database, { name: supplier.name }, { method: 'PATCH', body: { name: name.trim() } })
      : await apiRequest<Supplier>(API.suppliers, database, {}, { method: 'POST', body: { name: name.trim() } })
    setBusy(false)
    if (changed(database)) { setError(SWITCHED); return }
    if (result.state === 'success') onDone(result.body)
    else setError(result.message)
  }

  return <Panel title={supplier ? `Rename ${supplier.name}` : 'Add supplier'}>
    <form onSubmit={submit}>
      <SaveTarget />
      <fieldset disabled={busy} className="company-form-grid">
        <Field label="Supplier name" wide hint={supplier
          ? 'Awards and the company link stay with the supplier. The normalized name is recalculated; use Change link → Match again by name to re-check the company.'
          : `Must differ from every existing supplier in more than letter case. When saved, the supplier is linked to a company if exactly one registered company has the same normalized name${database === 'mongodb' ? ' (MongoDB checks every company, so saving takes a few seconds)' : ''}.`}>
          <input className="input" required maxLength={500} placeholder="e.g. ALPHA ZETTA PTE. LTD." value={name} onChange={e => setName(e.target.value)} />
        </Field>
      </fieldset>
      {error && <div className="company-form-error"><InlineError title="Could not save supplier">{error}</InlineError></div>}
      <FormButtons busy={busy} label={busy && !supplier ? 'Saving and matching…' : 'Save supplier'} onCancel={onCancel} />
    </form>
  </Panel>
}

type Mode = 'company' | 'none' | 'match'

// Link the supplier to one company by UEN, remove the link, or match again by normalized name.
export function LinkForm({ supplier, onDone, onCancel }: { supplier: Supplier; onDone: (supplier: Supplier) => void; onCancel: () => void }) {
  const { database, changed } = useDatabaseGuard()
  const [mode, setMode] = useState<Mode>('company')
  const [uen, setUen] = useState(supplier.link.company?.uen ?? '')
  const [candidates, setCandidates] = useState<Candidates | null>(null)
  const [searching, setSearching] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function findCandidates() {
    setSearching(true); setError('')
    const result = await apiRequest<Candidates>(API.candidates, database, { name: supplier.name })
    setSearching(false)
    if (result.state === 'success') setCandidates(result.body)
    else setError(result.message)
  }

  async function submit(event: FormEvent) {
    event.preventDefault(); setError('')
    if (mode === 'company' && !uen.trim()) { setError('Enter the UEN of the company to link, or choose one from the matching companies.'); return }
    setBusy(true)
    const result = await apiRequest<Supplier>(API.link, database, { name: supplier.name },
      { method: 'PATCH', body: mode === 'company' ? { mode, uen: uen.trim() } : { mode } })
    setBusy(false)
    if (changed(database)) { setError(SWITCHED); return }
    if (result.state === 'success') onDone(result.body)
    else setError(result.message)
  }

  const choice = (value: Mode, title: string, text: string) => <label className="supplier-link-choice">
    <input type="radio" name="link-mode" value={value} checked={mode === value} onChange={() => setMode(value)} />
    <span><span className="supplier-link-choice-title">{title}</span><span className="supplier-link-choice-text">{text}</span></span>
  </label>

  return <Panel title={`Change company link · ${supplier.name}`}>
    <form onSubmit={submit}>
      <SaveTarget />
      <fieldset disabled={busy} className="supplier-link-form">
        <legend className="visually-hidden">How to link this supplier</legend>
        {choice('company', 'Link to one company', 'The public pages then credit this supplier\'s awards to that company.')}
        {mode === 'company' && <div className="supplier-link-company">
          <Field label="Company UEN" hint="For example 201628078H. The company must exist in the selected database.">
            <input className="input input-mono" maxLength={20} value={uen} onChange={e => setUen(e.target.value.toUpperCase().replace(/\s/g, ''))} />
          </Field>
          <div className="supplier-candidates">
            <button type="button" className="button button-secondary button-sm" disabled={searching} onClick={findCandidates}>
              {searching ? 'Searching…' : `Find companies named "${supplier.normalized_name}"`}
            </button>
            {database === 'mongodb' && !candidates && <span className="field-hint">MongoDB has no index on company names, so this reads every company and takes a few seconds.</span>}
            {candidates && (candidates.items.length === 0
              ? <p className="company-note">No registered company has the normalized name "{candidates.normalized_name}" in {dbLabel(database)}.</p>
              : <table className="company-table supplier-candidate-table">
                <thead><tr><th>UEN</th><th>Company</th><th>Status</th><th><span className="visually-hidden">Choose</span></th></tr></thead>
                <tbody>{candidates.items.map(company => <tr key={company.uen}>
                  <td className="mono">{company.uen}</td><td>{company.name ?? '—'}</td>
                  <td>{company.status && <RegistryStatusBadge status={company.status} />}</td>
                  <td><button type="button" className="button company-edit-button button-sm" aria-pressed={uen === company.uen} onClick={() => setUen(company.uen)}>{uen === company.uen ? 'Chosen' : 'Use this'}</button></td>
                </tr>)}</tbody>
              </table>)}
            {candidates?.more && <p className="company-note">Showing the first {candidates.items.length} matches in UEN order.</p>}
          </div>
        </div>}
        {choice('none', 'Remove the link', 'The supplier keeps its awards but is no longer credited to any company.')}
        {choice('match', 'Match again by name', 'Links the supplier if exactly one company has the same normalized name; marks it as having several possible companies if more do.')}
      </fieldset>
      {error && <div className="company-form-error"><InlineError title="Could not change the link">{error}</InlineError></div>}
      <FormButtons busy={busy} label="Save link" onCancel={onCancel} />
    </form>
  </Panel>
}
