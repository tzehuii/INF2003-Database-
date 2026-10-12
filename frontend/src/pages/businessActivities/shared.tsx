/**
 * Pieces shared by the Business Activities pages: the route base, the browse
 * state kept while moving between screens, a failure notice, the code and
 * hierarchy presentation, and search highlighting.
 *
 * Nothing here reads sample data. Every value shown comes from an API response.
 */

import { useCallback, useEffect, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { Link, useLocation, useNavigate, useOutletContext } from 'react-router-dom'
import type { ActivityNode, ApiFailure, ApiResult, DatabaseMode } from '../../api/client'
import { InlineError, StatusBadge } from '../../components/ui'

export const ACTIVITIES_PATH = '/system/business-activities'

export const DATABASE_LABELS: Record<DatabaseMode, string> = {
  mariadb: 'MariaDB',
  mongodb: 'MongoDB',
}

/** How long a confirmation banner stays before it hides itself. */
const NOTICE_MS = 6000

/**
 * A short confirmation message that goes away.
 *
 * A screen that finishes an action navigates on with `state: { notice }`. This
 * picks that message up once and clears it from the history entry, so a reload
 * or Back does not bring it back. It hides itself after a few seconds and can
 * be dismissed. `show` raises a message from the page itself.
 */
export function useFlashNotice() {
  const location = useLocation()
  const navigate = useNavigate()
  const incoming = (location.state as { notice?: string } | null)?.notice ?? null
  const [notice, setNotice] = useState<string | null>(incoming)

  useEffect(() => {
    if (incoming !== null) {
      setNotice(incoming)
      navigate(`${location.pathname}${location.search}`, { replace: true, state: null })
    }
  }, [incoming, navigate, location.pathname, location.search])

  useEffect(() => {
    if (notice === null) {
      return
    }
    const timer = window.setTimeout(() => setNotice(null), NOTICE_MS)
    return () => window.clearTimeout(timer)
  }, [notice])

  const show = useCallback((text: string) => setNotice(text), [])
  const dismiss = useCallback(() => setNotice(null), [])

  return { notice, show, dismiss }
}

/** What each level's code looks like, shown beside the code field. */
export const CODE_FORMAT_HINTS: Record<string, string> = {
  Section: 'One uppercase letter from A to Z.',
  Division: 'Exactly 2 digits, for example 01.',
  Group: 'Exactly 3 digits, starting with the parent code.',
  Class: 'Exactly 4 digits, starting with the parent code.',
  'Sub-class': 'Exactly 5 digits, starting with the parent code.',
}

/** Browse state that survives opening a record and coming back to the catalogue. */
export type BrowseState = {
  /** Text in the search box, not yet submitted. */
  draft: string
  setDraft: (value: string) => void
  /** The submitted search. Empty means tree browsing. */
  query: string
  setQuery: (value: string) => void
  /** Selected Section code, or an empty string for All Sections. */
  section: string
  setSection: (value: string) => void
  /** Codes of the tree nodes that are open. */
  expanded: string[]
  toggle: (code: string) => void
  /** Close every open tree node. */
  collapseAll: () => void
}

export function useBrowse(): BrowseState {
  return useOutletContext<BrowseState>()
}

/**
 * Keep a result only if it answers the database that is selected now. The data
 * hook keeps the last answer while the next request is starting, and that answer
 * may belong to the other database.
 */
export function currentFor<T>(
  result: ApiResult<T> | null,
  database: DatabaseMode,
): ApiResult<T> | null {
  return result !== null && result.database === database ? result : null
}

/** An honest failure notice. It never stands in for data. */
export function ActivityError({
  failure,
  title,
  action,
}: {
  failure: ApiFailure
  title?: string
  action?: ReactNode
}) {
  return (
    <InlineError title={title ?? 'The request could not be completed.'} action={action}>
      {failure.message}
    </InlineError>
  )
}

/* ------------------------------------------------------- code and levels -- */

/** A stable class suffix for a level name, for example `Sub-class` to `sub-class`. */
export function levelClass(level: string): string {
  return `level-${level.toLowerCase().replace(/[^a-z]+/g, '-')}`
}

/** The plural of a level name, for panel titles: `Class` to `Classes`. */
export function pluralLevel(level: string): string {
  return /s$/i.test(level) ? `${level}es` : `${level}s`
}

/**
 * An SSIC code with its level treatment.
 *
 * A Section is an outlined tile. Other levels are monospace, and the characters
 * inherited from the parent code render in the tertiary colour so the new ones
 * stand out. The code stays one unbroken text string, so copying it and reading
 * it aloud give the full code.
 */
export function ActivityCode({
  code,
  level,
  parentCode,
}: {
  code: string
  level: string
  parentCode?: string | null
}) {
  if (level === 'Section') {
    return <span className="code-tile">{code}</span>
  }

  const inherited = parentCode && code.startsWith(parentCode) ? parentCode : ''

  return (
    <span className="code">
      {inherited && <span className="code-inherited">{inherited}</span>}
      {code.slice(inherited.length)}
    </span>
  )
}

/* ------------------------------------------------------------- hierarchy -- */

type HierarchyChild = { code: string; title: string; level: string }

/**
 * A static mini-tree: every ancestor indented by level, the current entry
 * highlighted, and its children beneath. Ancestors and children are links.
 *
 * On the create page there is no current entry. A placeholder row shows where
 * the new entry will sit.
 */
export function HierarchyList({
  ancestors,
  current,
  childEntries,
  placeholder,
}: {
  ancestors: ActivityNode[]
  current?: ActivityNode
  childEntries?: HierarchyChild[]
  /** A "New Group" row for the entry being created. */
  placeholder?: { label: string; level: string }
}) {
  const rows: {
    key: string
    node: ActivityNode
    parentCode: string | null
    depth: number
    kind: 'ancestor' | 'current' | 'child'
  }[] = []

  ancestors.forEach((node, index) => {
    rows.push({
      key: node.code,
      node,
      parentCode: index === 0 ? null : ancestors[index - 1].code,
      depth: index,
      kind: 'ancestor',
    })
  })

  const currentParent = ancestors.length === 0 ? null : ancestors[ancestors.length - 1].code
  if (current) {
    rows.push({
      key: current.code,
      node: current,
      parentCode: currentParent,
      depth: ancestors.length,
      kind: 'current',
    })
  }

  const childDepth = ancestors.length + 1
  ;(childEntries ?? []).forEach((child) => {
    rows.push({
      key: child.code,
      node: child,
      parentCode: current?.code ?? null,
      depth: childDepth,
      kind: 'child',
    })
  })

  return (
    <ul className="hierarchy">
      {rows.map((row) => (
        <li key={row.key}>
          <div
            className={`tree-row hierarchy-row ${levelClass(row.node.level)}${
              row.kind === 'current' ? ' hierarchy-row-current' : ''
            }`}
            style={{ '--depth': row.depth } as CSSProperties}
          >
            <span className="tree-code">
              <ActivityCode
                code={row.node.code}
                level={row.node.level}
                parentCode={row.parentCode}
              />
            </span>
            <span className="tree-title">
              {row.kind === 'current' ? (
                <span aria-current="page">{row.node.title}</span>
              ) : (
                <Link className="row-link" to={`${ACTIVITIES_PATH}/${row.node.code}`}>
                  {row.node.title}
                </Link>
              )}
            </span>
            <span className="tree-level">{row.node.level}</span>
          </div>
        </li>
      ))}
      {placeholder && (
        <li>
          <div
            className="tree-row hierarchy-row hierarchy-row-new"
            style={{ '--depth': ancestors.length } as CSSProperties}
          >
            <span className="tree-code" />
            <span className="tree-title">{placeholder.label}</span>
            <StatusBadge tone="outline">New</StatusBadge>
          </div>
        </li>
      )}
    </ul>
  )
}

/* ------------------------------------------------------------ highlighting -- */

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Wrap every case-insensitive occurrence of `query` in `<mark>`. */
export function HighlightMatch({ text, query }: { text: string; query: string }) {
  const needle = query.trim()
  if (needle === '') {
    return <>{text}</>
  }

  // The capture group keeps the matches, which land on the odd indexes.
  const parts = text.split(new RegExp(`(${escapeRegExp(needle)})`, 'gi'))
  return (
    <>
      {parts.map((part, index) => (index % 2 === 1 ? <mark key={index}>{part}</mark> : part))}
    </>
  )
}
