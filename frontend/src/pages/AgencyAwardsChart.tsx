// Top suppliers for one agency as a horizontal bar chart, shown above the Agency Awards table.
//
// It asks for the first 10 suppliers with the page's filters, so the chart stays the same while
// the table below is paged. The API already sorts suppliers by total award value, highest first.
// One colour throughout: the bars compare amounts, and every bar carries its name and value.
//
// The chart can be hidden. The choice is remembered in this browser, and a hidden chart sends no request.

import { useState } from 'react'
import { API_ROUTES, isLiveData } from '../api/client'
import type { AgencyAwardsData } from '../api/client'
import { useApiResource } from '../api/useApiResource'
import { formatMoney, formatPercent } from '../format'

const TOP = 10
const HIDDEN_KEY = 'bta.agencyAwards.chartHidden'

// Short amounts for bar labels (S$1.81B, S$520.3M); the tooltip and the table keep the exact figure.
function compactSgd(value: number) {
  if (value >= 1e9) return `S$${(value / 1e9).toFixed(2)}B`
  if (value >= 1e6) return `S$${(value / 1e6).toFixed(1)}M`
  if (value >= 1e3) return `S$${(value / 1e3).toFixed(0)}K`
  return `S$${value.toFixed(value > 0 && value < 1 ? 2 : 0)}`
}

// Browser storage can be unavailable (private windows, blocked site data); the chart then simply starts shown.
function readHidden() {
  try { return window.localStorage.getItem(HIDDEN_KEY) === 'true' } catch { return false }
}
function saveHidden(hidden: boolean) {
  try { window.localStorage.setItem(HIDDEN_KEY, String(hidden)) } catch { /* keep the choice for this visit only */ }
}

type Filters = { agency: string; start: string; end: string; above: boolean }

export default function AgencyAwardsChart({ agency, start, end, above }: Filters) {
  const [hidden, setHidden] = useState(readHidden)
  const { result } = useApiResource<AgencyAwardsData>(agency && !hidden ? API_ROUTES.agencyAwards : null,
    { agency_name: agency, start_date: start, end_date: end, above_average_only: above, limit: TOP, offset: 0 }, '', {}, true)
  const toggle = () => setHidden(value => { saveHidden(!value); return !value })

  if (hidden) {
    return <div className="agency-chart agency-chart-hidden">
      <span className="agency-chart-title">Top {TOP} suppliers chart hidden</span>
      <button type="button" className="button button-secondary button-sm" onClick={toggle}>Show chart</button>
    </div>
  }

  const data = isLiveData(result) ? result.body : null
  if (!data || data.items.length === 0) return null

  const items = data.items
  const max = Math.max(...items.map(item => Number(item.total_award_amount)), 0)
  const shown = items.reduce((sum, item) => sum + Number(item.total_award_amount), 0)
  const total = Number(data.summary.total_award_amount)
  const others = data.summary.supplier_count - items.length
  const period = start || end ? `${start || 'the start'} to ${end || 'today'}` : 'all years'
  // Near 100%, whole numbers would round a real remainder away, so show two decimals there.
  const sharePercent = total > 0 ? (100 * shown) / total : 0
  const shareText = sharePercent >= 99.5 && sharePercent < 100 ? sharePercent.toFixed(2) : String(Math.round(sharePercent))

  return (
    <figure className="agency-chart">
      <div className="agency-chart-head">
        <figcaption className="agency-chart-title">
          Top {items.length} suppliers by total award value
          <span className="agency-chart-note">{data.summary.agency_name} · {period}{above ? ' · above average only' : ''}</span>
        </figcaption>
        <button type="button" className="button button-secondary button-sm" onClick={toggle}>Hide chart</button>
      </div>
      <ol className="agency-chart-bars">
        {items.map((item, index) => {
          const value = Number(item.total_award_amount)
          const tip = `${item.supplier_name}\nS$${formatMoney(item.total_award_amount)} · ${formatPercent(item.share_percent)} of this agency's awards\n${item.tender_count} tender${item.tender_count === 1 ? '' : 's'}`
          return <li key={item.supplier_name} className="agency-chart-row" tabIndex={0} data-tip={tip} aria-label={tip.replace(/\n/g, '. ')}>
            <span className="agency-chart-rank">{index + 1}</span>
            <span className="agency-chart-name" title={item.supplier_name}>{item.supplier_name}</span>
            <span className="agency-chart-track">
              <span className="agency-chart-bar" style={{ width: `calc((100% - 76px) * ${max > 0 ? Math.max(value / max, 0.004) : 0})` }} />
              <span className="agency-chart-value">{compactSgd(value)}</span>
            </span>
          </li>
        })}
      </ol>
      <p className="agency-chart-footnote">
        These {items.length} suppliers received {compactSgd(shown)}, {shareText}% of the agency's {compactSgd(total)} in awards.
        {others > 0 && ` The other ${others.toLocaleString()} supplier${others === 1 ? '' : 's'} received ${compactSgd(Math.max(0, total - shown))}.`}
      </p>
    </figure>
  )
}
