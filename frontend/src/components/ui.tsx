/**
 * Shared presentational pieces.
 *
 * These keep the pages consistent without a component library: a data panel, a
 * page heading, badges, the backend status line, confirmation banners, empty,
 * loading and error states, and the attribute list. Everything here is display
 * only. None of it sends a request or owns page state.
 */

import { useId, useState } from 'react'
import type { InputHTMLAttributes, ReactNode } from 'react'
import type { ApiResult } from '../api/client'
import { describeFailure, isLiveData } from '../api/client'
import { EMPTY_VALUE } from '../format'
import { Icon } from './icons'
import type { IconName } from './icons'

/* ------------------------------------------------------------------ panel -- */

/**
 * One data panel: an optional title row, then whatever the page puts inside
 * (toolbar, status line, table, tree, footer). Panels carry no shadow.
 */
export function Panel({
  title,
  badge,
  actions,
  children,
  className,
}: {
  title?: ReactNode
  /** A small marker next to the title, such as the sample-data badge. */
  badge?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
}) {
  const titleId = useId()
  const hasHead = Boolean(title) || Boolean(actions)

  return (
    <section
      className={className ? `panel ${className}` : 'panel'}
      aria-labelledby={title ? titleId : undefined}
    >
      {hasHead && (
        <div className="panel-head">
          <div className="panel-title-group">
            {title && (
              <h2 className="panel-title" id={titleId}>
                {title}
              </h2>
            )}
            {badge}
          </div>
          {actions && <div className="panel-actions">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  )
}

/** The panel footer. Holds the result summary, paging, and footnotes. */
export function PanelFooter({ children }: { children: ReactNode }) {
  return <footer className="panel-footer">{children}</footer>
}

/** Footnotes at metadata volume: 12px, tertiary. */
export function PanelNotes({ children }: { children: ReactNode }) {
  return <div className="panel-notes">{children}</div>
}

/**
 * Result summary on the left and Previous / Next on the right.
 * The API returns no total, so only the count on this page is shown.
 */
export function Pagination({
  count,
  hasPrevious,
  hasNext,
  onPrevious,
  onNext,
}: {
  count: number
  hasPrevious: boolean
  hasNext: boolean
  onPrevious: () => void
  onNext: () => void
}) {
  return (
    <div className="panel-footer-bar">
      <span className="panel-footer-summary">
        Showing {count} {count === 1 ? 'result' : 'results'} on this page
      </span>
      <div className="panel-footer-controls">
        <button
          type="button"
          className="button button-secondary button-sm"
          disabled={!hasPrevious}
          onClick={onPrevious}
        >
          Previous
        </button>
        <button
          type="button"
          className="button button-secondary button-sm"
          disabled={!hasNext}
          onClick={onNext}
        >
          Next
        </button>
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------- heading -- */

export function PageHeading({
  title,
  description,
  actions,
  leading,
  trailing,
  meta,
  icon,
}: {
  title: string
  description?: string
  /** Page actions, right-aligned on the title row. */
  actions?: ReactNode
  /** Shown before the title, for example a catalogue code. */
  leading?: ReactNode
  /** Shown after the title, for example a level badge. */
  trailing?: ReactNode
  /** A line of identifying details under the title. */
  meta?: ReactNode
  /**
   * The page's sidebar icon, shown in a tile before the title, with a larger
   * title. Used by the public pages only. Without it the heading is plain.
   */
  icon?: IconName
}) {
  const copy = (
    <div className="page-header-copy">
      <div className="page-title-row">
        {leading}
        <h1 className="page-title">{title}</h1>
        {trailing}
      </div>
      {meta && <div className="page-meta">{meta}</div>}
      {description && <p className="page-description">{description}</p>}
    </div>
  )

  return (
    <div className={icon ? 'page-header page-header-icon' : 'page-header'}>
      {icon ? (
        <div className="page-heading-lead">
          <span className="page-icon">
            <Icon name={icon} size={22} />
          </span>
          {copy}
        </div>
      ) : (
        copy
      )}
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  )
}

/* ----------------------------------------------------------------- badges -- */

export type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'outline'

/** A restrained status label. Colour carries meaning and the words carry more. */
export function StatusBadge({
  tone,
  dot = false,
  children,
}: {
  tone: BadgeTone
  /** A leading dot, used for statuses. */
  dot?: boolean
  children: ReactNode
}) {
  return (
    <span className={`badge badge-${tone}`}>
      {dot && <span className="badge-dot" aria-hidden="true" />}
      {children}
    </span>
  )
}

/**
 * The API returns `has_linked_award` as a boolean only when supplier matching is
 * ready, and as `null` otherwise. Nothing is inferred from a null value.
 */
export function LinkedAwardBadge({ hasLinkedAward }: { hasLinkedAward: boolean | null }) {
  if (hasLinkedAward === null) {
    return <StatusBadge tone="neutral">Not available</StatusBadge>
  }
  return hasLinkedAward ? (
    <StatusBadge tone="success">Linked</StatusBadge>
  ) : (
    <StatusBadge tone="danger">Not linked</StatusBadge>
  )
}

/** Registry status as a badge. The wording is the registry's own. */
export function RegistryStatusBadge({ status }: { status: string }) {
  // Check inactive wording first: imported statuses can include "Live (Dissolved)".
  const value = status.trim().toLowerCase()
  const colour = /dissolv|struck off/.test(value) ? 'purple'
    : /terminat/.test(value) ? 'grey'
    : /cancel|withdraw|revok/.test(value) ? 'red'
    : /ceased|closed/.test(value) ? 'orange'
    : /liquidat|striking off|pending|receivership/.test(value) ? 'amber'
    : /^live|^active|^registered$/.test(value) ? 'green'
    : 'cyan'

  return (
    <span className={`badge registry-status registry-status-${colour}`}>
      <span className="badge-dot" aria-hidden="true" />
      {status}
    </span>
  )
}


/* ------------------------------------------------------------ status line -- */

type StatusTone = 'loading' | 'info' | 'success' | 'warning'

const STATUS_ICON: Record<StatusTone, IconName> = {
  loading: 'info',
  info: 'info',
  success: 'check',
  warning: 'warning',
}

/**
 * Shows what the declared backend route actually returned, as one compact row.
 *
 * The label says what happened. The message, any page note, and the request
 * line (`GET … · database=… · HTTP 501`) sit behind the Details disclosure. This
 * exists so the current HTTP 501 behaviour is demonstrated in the running
 * interface rather than only described in the code. It never shows a raw
 * response body.
 *
 * It hides itself once the route returns data: on a success response, and while
 * a refetch is loading after a success (the hook keeps the previous result, so
 * this avoids a flash on every search).
 */
export function BackendStatusStrip({
  route,
  result,
  isLoading,
  note,
  variant = 'panel',
}: {
  route: string
  result: ApiResult<unknown> | null
  isLoading: boolean
  note?: string
  /** `panel` sits inside a data panel. `standalone` has its own border. */
  variant?: 'panel' | 'standalone'
}) {
  const [open, setOpen] = useState(false)
  const detailsId = useId()

  let tone: StatusTone = 'info'
  let label = ''
  const messages: string[] = []
  let requestLine: string | null = null

  if (isLiveData(result)) {
    // Real data arrived (or is being refreshed): nothing to explain.
    return null
  }

  if (isLoading) {
    tone = 'loading'
    label = `Requesting ${route} from the backend…`
    if (note) messages.push(note)
  } else if (result === null) {
    // No request has been sent yet. The note explains what to do next.
    if (!note) {
      return null
    }
    label = 'No request sent yet'
    messages.push(note)
  } else {
    // `result` is a failure here: the success state returned above.
    const failure = result

    requestLine = [
      `GET ${route}`,
      `database=${result.database ?? 'unknown'}`,
      result.status === null ? 'no response' : `HTTP ${result.status}`,
      failure.code ?? undefined,
    ]
      .filter((part): part is string => typeof part === 'string')
      .join(' · ')

    switch (result.state) {
      case 'not_implemented':
        tone = 'info'
        label = 'This route is declared but its business logic is not implemented yet (HTTP 501).'
        break
      case 'supplier_matching_not_ready':
        tone = 'warning'
        label =
          'Accepted supplier-company links are not available in the selected database, so this request is blocked (HTTP 409).'
        break
      default:
        tone = 'warning'
        label = describeFailure(result)
        break
    }

    if (failure.message) messages.push(failure.message)
    if (note) messages.push(note)
  }

  const hasDetails = messages.length > 0 || requestLine !== null

  return (
    <div className={`status-line status-line-${tone} status-line-${variant}`}>
      <div className="status-line-main">
        <span className="status-line-icon">
          <Icon name={STATUS_ICON[tone]} />
        </span>
        <p className="status-line-label">{label}</p>
        {hasDetails && (
          <button
            type="button"
            className="button button-ghost button-sm status-line-toggle"
            aria-expanded={open}
            aria-controls={detailsId}
            onClick={() => setOpen((value) => !value)}
          >
            Details
            <Icon name="chevron" size={12} className="status-line-chevron" />
          </button>
        )}
      </div>
      {hasDetails && open && (
        <div className="status-line-details" id={detailsId}>
          {messages.map((message) => (
            <p key={message}>{message}</p>
          ))}
          {requestLine && <p className="status-line-request">{requestLine}</p>}
        </div>
      )}
    </div>
  )
}

/* ---------------------------------------------------------------- notices -- */

/** A confirmation or short outcome message. Keeps `role="status"`. */
export function ConfirmationBanner({
  children,
  tone = 'success',
  onDismiss,
}: {
  children: ReactNode
  tone?: 'success' | 'warning'
  onDismiss?: () => void
}) {
  return (
    <div className={`banner banner-${tone}`} role="status">
      <Icon name={tone === 'success' ? 'check' : 'warning'} />
      <p className="banner-text">{children}</p>
      {onDismiss && (
        <button type="button" className="button button-ghost button-sm" onClick={onDismiss}>
          Dismiss
        </button>
      )}
    </div>
  )
}

/** An inline, danger-tone failure inside the region that failed. */
export function InlineError({
  title,
  children,
  action,
  compact = false,
}: {
  title?: string
  children?: ReactNode
  action?: ReactNode
  compact?: boolean
}) {
  return (
    <div className={compact ? 'inline-error inline-error-compact' : 'inline-error'} role="alert">
      <span className="inline-error-icon">
        <Icon name="danger" />
      </span>
      <div className="inline-error-body">
        {title && <p className="inline-error-title">{title}</p>}
        {children && <p className="inline-error-message">{children}</p>}
      </div>
      {action}
    </div>
  )
}

/** Centred empty state for a panel body. */
export function EmptyState({
  title,
  children,
  tone = 'neutral',
  icon,
  action,
}: {
  title: string
  children?: ReactNode
  tone?: 'neutral' | 'warning'
  icon?: IconName
  action?: ReactNode
}) {
  return (
    <div className={tone === 'warning' ? 'empty-state empty-state-warning' : 'empty-state'}>
      {icon && (
        <span className="empty-state-icon">
          <Icon name={icon} size={20} />
        </span>
      )}
      <p className="empty-state-title">{title}</p>
      {children && <div className="empty-state-text">{children}</div>}
      {action}
    </div>
  )
}

/**
 * Placeholder rows that match the final row height, so nothing jumps when data
 * arrives. The text is for assistive technology only.
 */
export function SkeletonRows({
  count = 3,
  height = 36,
  label = 'Loading',
}: {
  count?: number
  height?: 36 | 44
  label?: string
}) {
  const widths = ['62%', '48%', '71%', '55%']
  return (
    <div className="skeleton-group" role="status">
      <span className="visually-hidden">{label}</span>
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="skeleton-row" style={{ height }} aria-hidden="true">
          <span className="skeleton-block skeleton-code" />
          <span className="skeleton-block" style={{ width: widths[index % widths.length] }} />
        </div>
      ))}
    </div>
  )
}

/* -------------------------------------------------------- attribute list -- */

/** Label and value rows. One column by default, two when there is room. */
export function AttributeList({
  children,
  columns = 1,
}: {
  children: ReactNode
  columns?: 1 | 2
}) {
  return <dl className={columns === 2 ? 'attr-list attr-list-2' : 'attr-list'}>{children}</dl>
}

/**
 * One attribute. A missing value shows a muted dash. Optional attributes that
 * are missing are left out, so a record does not fill with empty rows.
 */
export function Attribute({
  label,
  children,
  optional = false,
  raw = false,
}: {
  label: string
  children: ReactNode
  optional?: boolean
  /** Raw source text, shown as it arrived but in the secondary colour. */
  raw?: boolean
}) {
  const isEmpty = children === null || children === undefined || children === '' || children === EMPTY_VALUE

  if (isEmpty && optional) {
    return null
  }

  return (
    <div className="attr">
      <dt className="attr-label">{label}</dt>
      <dd className={raw ? 'attr-value attr-value-raw' : 'attr-value'}>
        {isEmpty ? (
          <>
            <span className="empty-value" aria-hidden="true">
              {EMPTY_VALUE}
            </span>
            <span className="visually-hidden">Not provided</span>
          </>
        ) : (
          children
        )}
      </dd>
    </div>
  )
}

/* ----------------------------------------------------------------- inputs -- */

/** A search field with a leading icon. Pass the label as `aria-label`. */
export function SearchInput(props: InputHTMLAttributes<HTMLInputElement>) {
  const { className, ...rest } = props
  return (
    <div className="search-input">
      <Icon name="search" className="search-input-icon" />
      <input type="search" className={className ? `input ${className}` : 'input'} {...rest} />
    </div>
  )
}

/** A toggle chip. Reports its state with `aria-pressed` and shows a check when on. */
export function ToggleChip({
  pressed,
  onClick,
  children,
}: {
  pressed: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button type="button" className="chip" aria-pressed={pressed} onClick={onClick}>
      {pressed && <Icon name="check" size={12} />}
      {children}
    </button>
  )
}
