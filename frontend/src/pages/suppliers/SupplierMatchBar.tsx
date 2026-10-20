// How the suppliers in the selected database are linked to registered companies: one bar split into
// linked, several possible companies, and not linked. Each part filters the directory below.

import { useApiResource } from '../../api/useApiResource'
import { Panel } from '../../components/ui'
import { useDatabase } from '../../databaseContext'
import { dbLabel } from '../tendersAwards/shared'
import { API } from './shared'
import type { LinkStatus } from './shared'

type Summary = Record<LinkStatus, number> & { total: number }

const PARTS: { status: LinkStatus; label: string; note: string }[] = [
  { status: 'accepted', label: 'Linked to one company', note: 'Awards credited to that company.' },
  { status: 'ambiguous', label: 'Several possible companies', note: 'Needs someone to choose the right one.' },
  { status: 'unmatched', label: 'Not linked', note: 'No company has the same normalized name.' },
]

export default function SupplierMatchBar({ active, onSelect }: { active: string; onSelect: (status: LinkStatus | '') => void }) {
  const { database } = useDatabase()
  const resource = useApiResource<Summary>(`${API.suppliers}/summary`, {}, '', {}, true)
  const result = resource.result
  const data = result?.state === 'success' ? result.body : null
  if (!data || data.total === 0) return null

  const percent = (n: number) => `${Math.round((100 * n) / data.total)}%`
  return <Panel title="Company links" badge={<span className="supplier-match-total">{data.total.toLocaleString()} suppliers in {dbLabel(database)}</span>}
    actions={active ? <button type="button" className="button button-secondary button-sm" onClick={() => onSelect('')}>Show all</button> : undefined}>
    <div className="supplier-match">
      <div className="supplier-match-bar" role="img" aria-label={PARTS.map(p => `${p.label}: ${data[p.status].toLocaleString()}`).join(', ')}>
        {PARTS.map(p => data[p.status] > 0 && <span key={p.status} className={`supplier-match-part supplier-match-${p.status}${active && active !== p.status ? ' supplier-match-dim' : ''}`}
          style={{ flexGrow: data[p.status] }} title={`${p.label}: ${data[p.status].toLocaleString()} (${percent(data[p.status])})`} />)}
      </div>
      <div className="supplier-match-legend">
        {PARTS.map(p => <button key={p.status} type="button" className="supplier-match-item" aria-pressed={active === p.status}
          onClick={() => onSelect(active === p.status ? '' : p.status)}>
          <span className="supplier-match-label"><i className={`supplier-match-swatch supplier-match-${p.status}`} aria-hidden="true" />{p.label}</span>
          <strong>{data[p.status].toLocaleString()} · {percent(data[p.status])}</strong>
          <span className="supplier-match-note">{p.note} {active === p.status ? 'Showing these below.' : 'Show these below.'}</span>
        </button>)}
      </div>
    </div>
  </Panel>
}
