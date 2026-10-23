import { useState } from 'react'
import { API_ROUTES, isLiveData } from '../api/client'
import type { IndustriesData, IndustryAwardsData, IndustryItem } from '../api/client'
import { useApiResource } from '../api/useApiResource'
import { EmptyState, PageHeading, Panel } from '../components/ui'
import { formatMoney, formatPercent } from '../format'
import IndustryAwardsChart from './IndustryAwardsChart'
import { ResourceStatus } from './publicShared'
type SortKey = 'code' | 'title' | 'total_award_amount' | 'award_row_count' | 'company_count' | 'share_percent'
const COLUMNS: { key: SortKey; label: string }[] = [
  { key: 'code', label: 'SSIC code' }, { key: 'title', label: 'Industry name' },
  { key: 'total_award_amount', label: 'Total awards (SGD)' }, { key: 'award_row_count', label: 'Awards' },
  { key: 'company_count', label: 'Companies' }, { key: 'share_percent', label: 'Share' },
]
const EMPTY = { parent: '', start: '', end: '' }
export default function IndustryAwardsPage() {
  const [sort, setSort] = useState<{ key: SortKey; ascending: boolean }>({ key: 'total_award_amount', ascending: false })
  const [draft, setDraft] = useState(EMPTY)
  const [filters, setFilters] = useState(EMPTY)
  const [path, setPath] = useState<IndustryItem[]>([])
  const nodes = useApiResource<IndustriesData>(API_ROUTES.industries, { parent_code: draft.parent }, '', {}, true)
  const { result, isLoading } = useApiResource<IndustryAwardsData>(API_ROUTES.industryAwards, { parent_code: filters.parent, start_date: filters.start, end_date: filters.end }, '', {}, true)
  const data = isLiveData(result) ? result.body : null
  // This endpoint returns every branch row, so sort the complete result without another request.
  const sortedRows = [...(data?.items ?? [])].sort((a, b) => {
    const left = a[sort.key], right = b[sort.key]
    if (left == null || right == null) return left == null ? (right == null ? 0 : 1) : -1
    const order = sort.key === 'code' || sort.key === 'title'
      ? String(left).localeCompare(String(right), undefined, { numeric: true, sensitivity: 'base' })
      : Number(left) - Number(right)
    return (sort.ascending ? order : -order) || a.code.localeCompare(b.code, undefined, { numeric: true })
  })
  // Clicking the active heading reverses it; a new heading starts in ascending order.
  function toggleSort(key: SortKey) {
    setSort(previous => ({ key, ascending: previous.key === key ? !previous.ascending : true }))
  }
  function drill(node: IndustryItem) {
    setPath(old => [...old, node]); setDraft(old => ({ ...old, parent: node.code })); setFilters(old => ({ ...old, parent: node.code }))
  }
  return <>
    <PageHeading icon="industry" title="Industry Awards" description="Compare awards across industries. SSIC codes and industry names are shown separately. Select a branch to explore its children." />
    <Panel title="Industry awards">
      <form className="toolbar" onSubmit={e => { e.preventDefault(); setFilters(draft) }}><div className="toolbar-row toolbar-row-fields">
        <label className="field field-grow"><span className="field-label">Industry branch</span><select className="input" value="" onChange={e => { const node = isLiveData(nodes.result) ? nodes.result.body.items.find(x => x.code === e.target.value) : null; if (node) drill(node) }}><option value="">{path.length ? 'Explore a child branch…' : 'Explore an industry section…'}</option>{isLiveData(nodes.result) && nodes.result.body.items.filter(x => x.has_children).map(x => <option key={x.code} value={x.code}>{x.code} — {x.title}</option>)}</select></label>
        <label className="field"><span className="field-label">Start date</span><input className="input" type="date" value={draft.start} onChange={e => setDraft({ ...draft, start: e.target.value })} /></label><label className="field"><span className="field-label">End date</span><input className="input" type="date" min={draft.start || undefined} value={draft.end} onChange={e => setDraft({ ...draft, end: e.target.value })} /></label>
        <button className="button button-primary">Search</button><button type="button" className="button button-secondary" onClick={() => { setDraft(EMPTY); setFilters(EMPTY); setPath([]) }}>Reset</button>
      </div><div className="toolbar-row"><button type="button" className="button button-ghost button-sm" onClick={() => { setPath([]); setDraft(x => ({ ...x, parent: '' })); setFilters(x => ({ ...x, parent: '' })) }}>All sections</button>{path.map((node, index) => <button key={node.code} type="button" className="button button-ghost button-sm" onClick={() => { setPath(path.slice(0, index + 1)); setDraft(x => ({ ...x, parent: node.code })); setFilters(x => ({ ...x, parent: node.code })) }}>› {node.code} {node.title}</button>)}</div></form>
      <ResourceStatus result={nodes.result} loading={false} /><ResourceStatus result={result} loading={isLoading && !data} />
      {data && <>
        <div className="stat-band"><dl className="stat-strip"><div className="stat"><dt className="stat-label">Total awards (SGD)</dt><dd className="stat-value">{formatMoney(data.summary.total_award_amount)}</dd></div><div className="stat"><dt className="stat-label">Award rows</dt><dd className="stat-value">{data.summary.award_row_count}</dd></div><div className="stat"><dt className="stat-label">Companies</dt><dd className="stat-value">{data.summary.company_count}</dd></div></dl></div>
        <IndustryAwardsChart data={data} branch={path.length ? `${path[path.length - 1].code} ${path[path.length - 1].title ?? ''}` : 'All sections'} onDrill={row => drill({ ...row, has_children: true })} />
        {data.items.length ? <div className="table-scroll"><table className="table industry-awards-table"><thead><tr>{COLUMNS.map((column, index) => <th key={column.key} className={index >= 2 ? 'cell-number' : undefined} aria-sort={sort.key === column.key ? (sort.ascending ? 'ascending' : 'descending') : 'none'}><button type="button" className="industry-sort" onClick={() => toggleSort(column.key)} title={`Sort ${column.label} ${sort.key === column.key && sort.ascending ? 'descending' : 'ascending'}`}><span>{column.label}</span><span className={sort.key === column.key ? 'sort-arrow active' : 'sort-arrow'} aria-hidden="true">{sort.key === column.key ? (sort.ascending ? '▲' : '▼') : '▴▾'}</span></button></th>)}</tr></thead><tbody>{sortedRows.map(row => <tr key={row.code}><td className="industry-code">{row.code}</td><td className="cell-primary">{row.level !== 'Sub-class' ? <button className="button button-ghost button-sm" onClick={() => drill({ ...row, has_children: true })}>{row.title}</button> : <>{row.title}</>}</td><td className="cell-number">{formatMoney(row.total_award_amount)}</td><td className="cell-number">{row.award_row_count}</td><td className="cell-number">{row.company_count}</td><td className="cell-number">{formatPercent(row.share_percent)}</td></tr>)}</tbody></table></div> : <EmptyState title="No industry results">Try another branch or period.</EmptyState>}
        <p className="panel-pad muted-text">Totals use suppliers with an unambiguous company link and valid primary SSIC. Excluded award rows: {data.summary.coverage.excluded_no_accepted_link_award_row_count} without an accepted company link; {data.summary.coverage.excluded_unresolved_primary_ssic_award_row_count} without a valid primary SSIC.</p>
      </>}
    </Panel>
  </>
}
