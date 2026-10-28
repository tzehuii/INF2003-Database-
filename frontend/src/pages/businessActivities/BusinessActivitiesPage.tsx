/**
 * Business Activities workspace.
 *
 * This route owns the catalogue browse state (search text, Section filter and
 * open tree nodes) so it is still there after opening a record and coming back.
 * Switching databases preserves the browse controls and route. Each screen
 * fetches the selected database again; detail screens handle missing entries.
 *
 * The catalogue shows the page heading here. The detail and create screens draw
 * their own headings, because those carry the record's code, level and actions.
 */

import { useCallback, useState } from 'react'
import { Outlet, useMatch, useNavigate } from 'react-router-dom'
import { PageHeading } from '../../components/ui'
import { ACTIVITIES_PATH } from './shared'
import type { BrowseState } from './shared'

export default function BusinessActivitiesPage() {
  const navigate = useNavigate()
  const isCatalogue = useMatch({ path: ACTIVITIES_PATH, end: true }) !== null
  const [draft, setDraft] = useState('')
  const [query, setQuery] = useState('')
  const [section, setSection] = useState('')
  const [expanded, setExpanded] = useState<string[]>([])
  const toggle = useCallback((code: string) => {
    setExpanded((open) =>
      open.includes(code) ? open.filter((item) => item !== code) : [...open, code],
    )
  }, [])

  const collapseAll = useCallback(() => setExpanded([]), [])

  const browse: BrowseState = {
    draft,
    setDraft,
    query,
    setQuery,
    section,
    setSection,
    expanded,
    toggle,
    collapseAll,
  }

  return (
    <>
      {isCatalogue && (
        <PageHeading
          title="Business Activities"
          description="Browse and maintain the SSIC business activity catalogue in the selected database."
          actions={
            <button
              type="button"
              className="button button-secondary"
              onClick={() => navigate(`${ACTIVITIES_PATH}/new`)}
            >
              Create Section
            </button>
          }
        />
      )}
      <Outlet context={browse} />
    </>
  )
}
