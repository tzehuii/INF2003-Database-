/**
 * Business Activities workspace.
 *
 * This route owns the catalogue browse state (search text, Section filter and
 * open tree nodes) so it is still there after opening a record and coming back.
 * Switching the database clears that state and returns to the catalogue, because
 * the two databases are separate catalogues and a code open in one may not exist
 * in the other.
 *
 * The catalogue shows the page heading here. The detail and create screens draw
 * their own headings, because those carry the record's code, level and actions.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Outlet, useMatch, useNavigate } from 'react-router-dom'
import { PageHeading } from '../../components/ui'
import { useDatabase } from '../../databaseContext.tsx'
import { ACTIVITIES_PATH } from './shared'
import type { BrowseState } from './shared'

export default function BusinessActivitiesPage() {
  const { database } = useDatabase()
  const navigate = useNavigate()
  const isCatalogue = useMatch({ path: ACTIVITIES_PATH, end: true }) !== null
  const [draft, setDraft] = useState('')
  const [query, setQuery] = useState('')
  const [section, setSection] = useState('')
  const [expanded, setExpanded] = useState<string[]>([])
  const selectedDatabase = useRef(database)

  useEffect(() => {
    if (selectedDatabase.current === database) {
      return
    }
    selectedDatabase.current = database
    setDraft('')
    setQuery('')
    setSection('')
    setExpanded([])
    navigate(ACTIVITIES_PATH, { replace: true })
  }, [database, navigate])

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
