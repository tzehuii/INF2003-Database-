// The MariaDB entity-relationship diagram on the Database Schema page.
//
// Features this file covers:
// - Table cards in five columns along the chain of foreign keys, inside three labelled groups.
// - One arrow per foreign key, from the foreign key column to the column it references.
// - Focus a table (hover, click or keyboard) to fade everything not linked to it and show each
//   lit arrow's delete rule. A click keeps the focus until it is cleared.
// - Fit the whole diagram to the panel, or show it full size with scrolling.
//
// Card heights are fixed by the CSS (header, rows and footer), so the layout is computed from the
// column counts alone and the arrows can start and end on exact rows.

import { useEffect, useMemo, useRef, useState } from 'react'
import { formatCount } from './shared'
import { DELETE_RULES, GROUPS, TABLE_INFO, shortType, tableLabel } from './schemaModel'
import type { Table } from './schemaModel'

const CARD_W = 236, GAP_X = 80, PAD_X = 36, TOP = 64, GROUP_PAD = 20, GROUP_HEAD = 30
// Must match .schema-card in styles.css: 1px border, 40px header, 5px list padding, 24px rows, 48px footer.
const HEAD = 40, LIST_PAD = 5, ROW = 24, FOOT = 48, BORDER = 1
const cardHeight = (table: Table) => BORDER * 2 + HEAD + LIST_PAD * 2 + ROW * table.columns.length + FOOT
const rowY = (table: Table, column: string) =>
  BORDER + HEAD + LIST_PAD + ROW * Math.max(0, table.columns.findIndex(c => c.name === column)) + ROW / 2

type Box = { x: number; y: number; h: number }

// Place every card. Known tables follow the arranged layout; any other table is stacked under column 0.
function layout(tables: Record<string, Table>) {
  const pos: Record<string, Box> = {}
  const has = (n: string) => n in tables
  const h = (n: string) => cardHeight(tables[n])
  const column = (n: string) => TABLE_INFO[n]?.column ?? 0
  const place = (n: string, y: number) => { if (has(n)) pos[n] = { x: PAD_X + column(n) * (CARD_W + GAP_X), y: Math.round(y), h: h(n) } }
  const bottom = (n: string) => (pos[n] ? pos[n].y + pos[n].h : 0)
  const mid = (n: string) => (pos[n] ? pos[n].y + pos[n].h / 2 : 0)

  // Tables that hang off Company, stacked in column 1, with BusinessActivity beside CompanyActivity.
  let y = TOP
  for (const n of ['companyactivity', 'address', 'formerentityname']) {
    if (has(n)) { place(n, y); y = bottom(n) + 44 }
  }
  const companiesBottom = y - 44
  place('businessactivity', pos.companyactivity?.y ?? TOP)
  if (has('company')) place('company', (TOP + companiesBottom) / 2 - h('company') / 2)

  // Saved lists sit below, in their own group.
  const listsTop = companiesBottom + 2 * GROUP_PAD + GROUP_HEAD + 36
  place('savedlistentry', listsTop)
  place('savedlist', listsTop)

  // Supplier links and awards in column 3; Supplier between them, then Tender and the agency.
  place('supplierentitymatch', (pos.company?.y ?? TOP) - 40)
  place('tenderaward', bottom('supplierentitymatch') + 110)
  if (has('supplier')) place('supplier', (mid('supplierentitymatch') + mid('tenderaward')) / 2 - h('supplier') / 2)
  place('tender', Math.max(bottom('supplier') + 56, (pos.tenderaward?.y ?? TOP) + 60))
  place('governmentagency', bottom('tender') + 56)

  // Anything the layout does not know about.
  let extra = Math.max(TOP, ...Object.keys(pos).filter(n => column(n) === 0).map(n => bottom(n) + 60))
  for (const n of Object.keys(tables).sort()) {
    if (!pos[n]) { pos[n] = { x: PAD_X, y: extra, h: h(n) }; extra += h(n) + 44 }
  }

  const width = PAD_X * 2 + 5 * CARD_W + 4 * GAP_X
  const height = Math.max(...Object.values(pos).map(p => p.y + p.h)) + GROUP_PAD + 28
  return { pos, width, height }
}

type Line = { from: string; to: string; column: string; referenced: string; rule: string; d: string; mid: { x: number; y: number } }

// One cubic curve per foreign key. Arrows between columns run edge to edge; within a column
// (or a table pointing at itself) they loop out on the diagram's outer side.
function arrows(tables: Record<string, Table>, pos: Record<string, Box>): Line[] {
  const lines: Line[] = []
  for (const [name, table] of Object.entries(tables)) {
    for (const fk of table.foreign_keys) {
      const target = tables[fk.table]
      if (!target || !pos[name] || !pos[fk.table]) continue
      const a = { left: pos[name].x, right: pos[name].x + CARD_W, y: pos[name].y + rowY(table, fk.column) }
      const b = { left: pos[fk.table].x, right: pos[fk.table].x + CARD_W, y: pos[fk.table].y + rowY(target, fk.column_referenced) }
      const ca = TABLE_INFO[name]?.column ?? 0, cb = TABLE_INFO[fk.table]?.column ?? 0
      let p0, p1, p2, p3
      if (ca === cb) {
        const left = ca === 0, bend = left ? -48 : 48
        const x1 = left ? a.left : a.right, x2 = left ? b.left : b.right
        p0 = [x1, a.y]; p1 = [x1 + bend, a.y]; p2 = [x2 + bend, b.y]; p3 = [x2 + (left ? -3 : 3), b.y]
      } else {
        const right = cb > ca
        const x1 = right ? a.right : a.left, x2 = right ? b.left : b.right, dx = Math.max(36, Math.abs(x2 - x1) / 2)
        p0 = [x1, a.y]; p1 = [x1 + (right ? dx : -dx), a.y]; p2 = [x2 + (right ? -dx : dx), b.y]; p3 = [x2 + (right ? -3 : 3), b.y]
      }
      // The curve's midpoint, where the delete-rule label sits: (P0 + 3P1 + 3P2 + P3) / 8.
      const mid = { x: (p0[0] + 3 * p1[0] + 3 * p2[0] + p3[0]) / 8, y: (p0[1] + 3 * p1[1] + 3 * p2[1] + p3[1]) / 8 }
      lines.push({ from: name, to: fk.table, column: fk.column, referenced: fk.column_referenced, rule: fk.on_delete, mid,
        d: `M${p0[0]},${p0[1]} C${p1[0]},${p1[1]} ${p2[0]},${p2[1]} ${p3[0]},${p3[1]}` })
    }
  }
  return lines
}

export default function SchemaDiagram({ tables: list }: { tables: Table[] }) {
  const tables = useMemo(() => Object.fromEntries(list.map(t => [t.name, t])), [list])
  const { pos, width, height } = useMemo(() => layout(tables), [tables])
  const lines = useMemo(() => arrows(tables, pos), [tables, pos])
  const [hovered, setHovered] = useState<string | null>(null)
  const [pinned, setPinned] = useState<string | null>(null)
  const [fit, setFit] = useState(true)
  const [panelWidth, setPanelWidth] = useState(width)
  const viewport = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const node = viewport.current
    if (!node) return
    const observer = new ResizeObserver(() => setPanelWidth(node.clientWidth))
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const clear = (event: KeyboardEvent) => { if (event.key === 'Escape') setPinned(null) }
    document.addEventListener('keydown', clear)
    return () => document.removeEventListener('keydown', clear)
  }, [])

  const current = hovered ?? pinned
  const lit = lines.filter(l => current && (l.from === current || l.to === current))
  const related = new Set(lit.flatMap(l => [l.from, l.to]))
  const litRows = new Set(lit.flatMap(l => [`${l.from}.${l.column}`, `${l.to}.${l.referenced}`]))
  const pinnedLinks = pinned ? lines.filter(l => l.from === pinned || l.to === pinned).length : 0
  const scale = fit ? Math.min(1, (panelWidth - 2) / width) : 1
  const togglePin = (name: string) => setPinned(p => (p === name ? null : name))

  const groupBoxes = GROUPS.map(group => {
    const members = Object.keys(pos).filter(n => TABLE_INFO[n]?.group === group.key).map(n => pos[n])
    if (!members.length) return null
    const x0 = Math.min(...members.map(p => p.x)) - GROUP_PAD, x1 = Math.max(...members.map(p => p.x)) + CARD_W + GROUP_PAD
    const y0 = Math.min(...members.map(p => p.y)) - GROUP_PAD - GROUP_HEAD, y1 = Math.max(...members.map(p => p.y + p.h)) + GROUP_PAD
    return { ...group, x0, x1, y0, y1 }
  })

  return <>
    <div className="schema-toolbar">
      <span className="schema-hint">Hover or click a table to see only its links. Esc clears.</span>
      <div className="schema-tools">
        {pinned && <span className="schema-pin">Focused on {tableLabel(pinned)} · {pinnedLinks} link{pinnedLinks === 1 ? '' : 's'}
          <button type="button" onClick={() => setPinned(null)} aria-label="Clear the focused table">Clear</button></span>}
        <div className="segmented" role="group" aria-label="Diagram size">
          <button type="button" className={fit ? 'segmented-option segmented-option-active' : 'segmented-option'} aria-pressed={fit} onClick={() => setFit(true)}>Fit to panel</button>
          <button type="button" className={!fit ? 'segmented-option segmented-option-active' : 'segmented-option'} aria-pressed={!fit} onClick={() => setFit(false)}>Full size</button>
        </div>
      </div>
    </div>
    <div className="schema-viewport" ref={viewport}>
      <div className="schema-stage" style={{ width: width * scale, height: height * scale }}>
        <div className={current ? 'schema-er schema-er-focused' : 'schema-er'} style={{ width, height, transform: `scale(${scale})` }}>
          <svg className="schema-layer" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
            <defs>
              {['schema-arrow', 'schema-arrow-lit'].map(id => <marker key={id} id={id} viewBox="0 0 8 8" refX={7} refY={4} markerWidth={7} markerHeight={7} orient="auto-start-reverse">
                <path d="M0,0 L8,4 L0,8 Z" className={id === 'schema-arrow' ? 'schema-arrow-head' : 'schema-arrow-head-lit'} />
              </marker>)}
            </defs>
            {groupBoxes.map(g => g && <g key={g.key}>
              <rect x={g.x0} y={g.y0} width={g.x1 - g.x0} height={g.y1 - g.y0} rx={14} className="schema-group-box" />
              <text x={g.x0 + 16} y={g.y0 + 21} className="schema-group-label">{g.label}</text>
            </g>)}
            {/* Lit arrows are drawn last so they sit over the faded ones. */}
            {[...lines].sort((a, b) => Number(lit.includes(a)) - Number(lit.includes(b))).map(l => {
              const on = lit.includes(l)
              return <path key={`${l.from}.${l.column}`} d={l.d} className={on ? 'schema-fk schema-fk-lit' : 'schema-fk'} markerEnd={`url(#${on ? 'schema-arrow-lit' : 'schema-arrow'})`} />
            })}
          </svg>

          {Object.entries(pos).map(([name, p]) => {
            const table = tables[name]
            const info = TABLE_INFO[name]
            const fks = new Map(table.foreign_keys.map(fk => [fk.column, fk]))
            const uniques = new Set(table.indexes.filter(i => i.unique && i.name !== 'PRIMARY' && i.columns.length === 1).map(i => i.columns[0]))
            const state = name === current ? ' schema-card-current' : current && related.has(name) ? ' schema-card-related' : ''
            return <div key={name} className={`schema-card${state}`} style={{ left: p.x, top: p.y, width: CARD_W }}
              role="button" tabIndex={0} aria-pressed={pinned === name}
              aria-label={`${tableLabel(name)}: ${table.columns.length} columns, ${formatCount(table.rows)} rows.${info ? ` In MongoDB: ${info.target}, ${info.kind}.` : ''} Press Enter to focus its links.`}
              onMouseEnter={() => setHovered(name)} onMouseLeave={() => setHovered(null)}
              onFocus={() => setHovered(name)} onBlur={() => setHovered(null)}
              onClick={() => togglePin(name)}
              onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); togglePin(name) } }}>
              <div className="schema-card-head"><span className="schema-card-name">{tableLabel(name)}</span><span className="schema-card-rows">{formatCount(table.rows)} rows</span></div>
              <ul>{table.columns.map(c => {
                const fk = fks.get(c.name)
                const tip = fk ? `${c.name} → ${tableLabel(fk.table)}.${fk.column_referenced}. When that ${tableLabel(fk.table)} row is deleted, this row ${DELETE_RULES[fk.on_delete]?.meaning ?? fk.on_delete}.` : c.name
                return <li key={c.name} title={tip} className={litRows.has(`${name}.${c.name}`) ? 'schema-row-lit' : undefined}>
                  <span>{c.primary_key ? <i className="schema-key schema-key-pk">PK</i> : fk ? <i className="schema-key schema-key-fk">FK</i> : uniques.has(c.name) ? <i className="schema-key schema-key-uq">UQ</i> : null}</span>
                  <span className={c.nullable ? 'schema-col schema-col-null' : 'schema-col'}>{c.name}</span>
                  <span className="schema-col-type">{shortType(c.type)}</span>
                </li>
              })}</ul>
              <div className="schema-card-foot">{info ? <>MongoDB: <b>{info.target}</b> · {info.kind}</> : 'Not mapped to MongoDB'}</div>
            </div>
          })}

          {/* Delete-rule labels above the cards, shown only on the lit arrows. */}
          <svg className="schema-layer schema-labels" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
            {lit.map(l => {
              const text = DELETE_RULES[l.rule]?.short ?? l.rule
              const w = text.length * 7 + 16
              return <g key={`${l.from}.${l.column}`} className="schema-rule">
                <rect x={l.mid.x - w / 2} y={l.mid.y - 10} width={w} height={20} rx={10} />
                <text x={l.mid.x} y={l.mid.y + 4} textAnchor="middle">{text}</text>
              </g>
            })}
          </svg>
        </div>
      </div>
    </div>
  </>
}
