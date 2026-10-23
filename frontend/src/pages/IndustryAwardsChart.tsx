// Top industries in the current branch as a horizontal bar chart, shown above the Industry Awards table.
//
// It draws from the page's own response, which already holds every child row, so changing the
// measure re-sorts locally and sends no request. It reuses the Agency Awards chart styles: one
// colour, a linear scale from zero, and a name and value on every bar.
//
// The chart can be hidden. The choice is remembered in this browser; the measure always starts at award value.

import { useState } from 'react'
import type { IndustryAwardChild, IndustryAwardsData } from '../api/client'
import { compactSgd, formatMoney, formatPercent } from '../format'

const TOP = 10
const HIDDEN_KEY = 'bta.industryAwards.chartHidden'

type Measure = 'value' | 'awards' | 'companies'
const MEASURES: { key: Measure; label: string; title: string }[] = [
  { key: 'value', label: 'Award value', title: 'award value' },
  { key: 'awards', label: 'Number of awards', title: 'number of awards' },
  { key: 'companies', label: 'Companies', title: 'number of companies' },
]

function measureOf(row: IndustryAwardChild, measure: Measure) {
  if (measure === 'value') return Number(row.total_award_amount)
  return measure === 'awards' ? row.award_row_count : row.company_count
}

function label(amount: number, measure: Measure) {
  if (measure === 'value') return compactSgd(amount)
  const noun = measure === 'awards' ? (amount === 1 ? 'award' : 'awards') : (amount === 1 ? 'company' : 'companies')
  return `${amount.toLocaleString()} ${noun}`
}

// Browser storage can be unavailable (private windows, blocked site data); the chart then simply starts shown.
function readHidden() {
  try { return window.localStorage.getItem(HIDDEN_KEY) === 'true' } catch { return false }
}
function saveHidden(hidden: boolean) {
  try { window.localStorage.setItem(HIDDEN_KEY, String(hidden)) } catch { /* keep the choice for this visit only */ }
}

type Props = { data: IndustryAwardsData; branch: string; onDrill: (row: IndustryAwardChild) => void }

export default function IndustryAwardsChart({ data, branch, onDrill }: Props) {
  const [hidden, setHidden] = useState(readHidden)
  const [measure, setMeasure] = useState<Measure>('value')
  const toggle = () => setHidden(value => { saveHidden(!value); return !value })

  if (hidden) {
    return <div className="agency-chart agency-chart-hidden">
      <span className="agency-chart-title">Industry chart hidden</span>
      <button type="button" className="button button-secondary button-sm" onClick={toggle}>Show chart</button>
    </div>
  }

  const nonZero = data.items.filter(row => measureOf(row, measure) > 0)
    .sort((a, b) => measureOf(b, measure) - measureOf(a, measure) || a.code.localeCompare(b.code, undefined, { numeric: true }))
  // Hide the chart only when the branch has nothing at all, so a measure switch never makes it vanish.
  if (!data.items.some(row => Number(row.total_award_amount) > 0)) return null

  const rows = nonZero.slice(0, TOP)
  const max = rows.length ? measureOf(rows[0], measure) : 0
  const shown = rows.reduce((sum, row) => sum + measureOf(row, measure), 0)
  const summary = data.summary
  const total = measure === 'value' ? Number(summary.total_award_amount) : measure === 'awards' ? summary.award_row_count : summary.company_count
  const others = nonZero.length - rows.length
  const { start_date: start, end_date: end } = summary.period
  const period = start || end ? `${start || 'the start'} to ${end || 'today'}` : 'all years'
  const verb = measure === 'value' ? 'received' : 'had'

  return (
    <figure className="agency-chart">
      <div className="agency-chart-head">
        <figcaption className="agency-chart-title">
          Top {rows.length} industr{rows.length === 1 ? 'y' : 'ies'} by {MEASURES.find(m => m.key === measure)!.title}
          <span className="agency-chart-note">{branch} · {period}</span>
        </figcaption>
        <div className="industry-chart-controls">
          <div className="segmented" role="group" aria-label="Chart measure">
            {MEASURES.map(m => <button key={m.key} type="button" className={m.key === measure ? 'segmented-option segmented-option-active' : 'segmented-option'} aria-pressed={m.key === measure} onClick={() => setMeasure(m.key)}>{m.label}</button>)}
          </div>
          <button type="button" className="button button-secondary button-sm" onClick={toggle}>Hide chart</button>
        </div>
      </div>
      <ol className="agency-chart-bars">
        {rows.map((row, index) => {
          const amount = measureOf(row, measure)
          const canDrill = row.level !== 'Sub-class'
          const tip = `${row.code} ${row.title ?? ''}\nS$${formatMoney(row.total_award_amount)} · ${formatPercent(row.share_percent)} of award value\n${label(row.award_row_count, 'awards')} · ${label(row.company_count, 'companies')}${canDrill ? '\nClick to open this branch' : ''}`
          return <li key={row.code} className={canDrill ? 'agency-chart-row industry-chart-row-link' : 'agency-chart-row'} tabIndex={0} data-tip={tip} aria-label={tip.replace(/\n/g, '. ')}
            role={canDrill ? 'button' : undefined}
            onClick={canDrill ? () => onDrill(row) : undefined}
            onKeyDown={canDrill ? event => { if (event.key === 'Enter') onDrill(row) } : undefined}>
            <span className="agency-chart-rank">{index + 1}</span>
            <span className="agency-chart-name">{row.title ?? row.code}</span>
            <span className="agency-chart-track">
              <span className="agency-chart-bar" style={{ width: `calc((100% - 96px) * ${max > 0 ? Math.max(amount / max, 0.004) : 0})` }} />
              <span className="agency-chart-value">{label(amount, measure)}</span>
            </span>
          </li>
        })}
      </ol>
      {others > 0 && <p className="agency-chart-footnote">
        The other {others.toLocaleString()} industr{others === 1 ? 'y' : 'ies'} {verb} {label(Math.max(0, total - shown), measure)}.
      </p>}
    </figure>
  )
}
