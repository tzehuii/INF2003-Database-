/**
 * Pieces shared by the Business Activities pages: the route base, the browse
 * state kept while moving between screens, a failure notice, and a detail row.
 *
 * Nothing here reads sample data. Every value shown comes from an API response.
 */

import type { ReactNode } from 'react'
import { useOutletContext } from 'react-router-dom'
import type { ApiFailure, ApiResult, DatabaseMode } from '../../api/client'

export const ACTIVITIES_PATH = '/system/business-activities'

export const DATABASE_LABELS: Record<DatabaseMode, string> = {
  mariadb: 'MariaDB',
  mongodb: 'MongoDB',
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
export function ActivityError({ failure, title }: { failure: ApiFailure; title?: string }) {
  return (
    <div className="status-strip status-strip-warning" role="alert">
      <div className="status-strip-body">
        <p className="status-strip-label">{title ?? 'The request could not be completed.'}</p>
        <p className="status-strip-message">{failure.message}</p>
      </div>
    </div>
  )
}

export function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="detail-row">
      <dt className="detail-label">{label}</dt>
      <dd className="detail-value">{children}</dd>
    </div>
  )
}
