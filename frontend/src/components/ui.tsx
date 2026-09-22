/**
 * Shared small presentational pieces.
 *
 * These keep the pages consistent without introducing a component library: one
 * card wrapper, one status label, one page heading, and notices that report the
 * current API state plainly.
 */

import type { ReactNode } from 'react'
import type { ApiResult } from '../api/client'
import { describeFailure } from '../api/client'
import { PLACEHOLDER_NOTICE } from '../api/mockData'
import { useDatabase } from '../databaseContext.tsx'

export function Card({
  title,
  actions,
  children,
  className,
}: {
  title?: string
  actions?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={className ? `card ${className}` : 'card'}>
      {(title || actions) && (
        <div className="card-head">
          {title && <h2 className="card-title">{title}</h2>}
          {actions && <div className="card-actions">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  )
}

export function PageHeading({
  title,
  description,
}: {
  title: string
  description?: string
}) {
  const { database } = useDatabase()
  const eyebrow = {
    Companies: 'Company discovery',
    'Agency Awards': 'Procurement analysis',
    'Industry Awards': 'Industry intelligence',
    'Saved Lists': 'Company review',
  }[title]

  return (
    <div className="page-heading">
      <div className="page-heading-copy">
        {eyebrow && <p className="page-eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        {description && <p className="page-description">{description}</p>}
      </div>
      <span className="database-status-chip">
        <span className="database-status-dot" aria-hidden="true" />
        {database === 'mongodb' ? 'MongoDB' : 'MariaDB'} selected
      </span>
    </div>
  )
}

export type BadgeTone = 'neutral' | 'positive' | 'warning' | 'muted'

/** A restrained status label. Colour carries meaning, the words carry more. */
export function StatusBadge({ tone, children }: { tone: BadgeTone; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>
}

/**
 * The API returns `has_linked_award` as a boolean only when supplier matching is
 * ready, and as `null` otherwise. Nothing is inferred from a null value.
 */
export function LinkedAwardBadge({ hasLinkedAward }: { hasLinkedAward: boolean | null }) {
  if (hasLinkedAward === null) {
    return <StatusBadge tone="muted">Not available</StatusBadge>
  }
  return hasLinkedAward ? (
    <StatusBadge tone="positive">Linked</StatusBadge>
  ) : (
    <StatusBadge tone="neutral">Not linked</StatusBadge>
  )
}

/**
 * Shows what the declared backend route actually returned.
 *
 * This exists so the current HTTP 501 behaviour is demonstrated in the running
 * interface rather than only described in the code. It never expands into a
 * full error framework, and it never shows a raw response body.
 */
export function BackendStatusStrip({
  route,
  result,
  isLoading,
  note,
}: {
  route: string
  result: ApiResult<unknown> | null
  isLoading: boolean
  note?: string
}) {
  if (isLoading) {
    return (
      <div className="status-strip status-strip-loading">
        <div className="status-strip-body">
          <p className="status-strip-label">Requesting {route} from the backend…</p>
          {note && <p className="status-strip-message">{note}</p>}
        </div>
      </div>
    )
  }

  if (result === null) {
    // No request has been sent yet. The note still explains the current state.
    if (!note) {
      return null
    }
    return (
      <div className="status-strip status-strip-info">
        <div className="status-strip-body">
          <p className="status-strip-label">No request sent yet.</p>
          <p className="status-strip-message">{note}</p>
        </div>
      </div>
    )
  }

  // A successful response carries no domain error code, so the failure fields
  // are read from a narrowed value.
  const failure = result.state === 'success' ? null : result

  const details = [
    `GET ${route}`,
    `database=${result.database ?? 'unknown'}`,
    result.status === null ? 'no response' : `HTTP ${result.status}`,
    failure?.code ?? undefined,
  ].filter((part): part is string => typeof part === 'string')

  let tone: 'loading' | 'info' | 'warning' = 'info'
  let label = ''

  switch (result.state) {
    case 'success':
      label = 'The backend returned data for this request.'
      break
    case 'not_implemented':
      tone = 'info'
      label = 'This route is declared but its business logic is not implemented yet (HTTP 501).'
      break
    case 'supplier_matching_not_ready':
      tone = 'warning'
      label =
        'Accepted supplier-company links are not available in the selected database, so this request is blocked (HTTP 409).'
      break
    case 'validation_error':
      tone = 'warning'
      label = describeFailure(result)
      break
    case 'network_error':
      tone = 'warning'
      label = describeFailure(result)
      break
    default:
      tone = 'warning'
      label = describeFailure(result)
      break
  }

  return (
    <div className={`status-strip status-strip-${tone}`}>
      <div className="status-strip-body">
        <p className="status-strip-label">{label}</p>
        {failure && failure.message && (
          <p className="status-strip-message">{failure.message}</p>
        )}
        {note && <p className="status-strip-message">{note}</p>}
      </div>
      <span className="status-strip-details">{details.join(' · ')}</span>
    </div>
  )
}

/** Marks a page region whose values are placeholders rather than API results. */
export function PlaceholderNotice({ text }: { text?: string }) {
  return (
    <p className="placeholder-notice">
      <span className="placeholder-notice-tag">Placeholder</span>
      {text ?? PLACEHOLDER_NOTICE}
    </p>
  )
}
