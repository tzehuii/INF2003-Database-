/**
 * Business Activities workspace.
 *
 * This route owns the catalogue browse state (search text, Section filter and
 * open tree nodes) so it is still there after opening a record and coming back.
 * Switching the database clears that state and returns to the catalogue, because
 * the two databases are separate catalogues and a code open in one may not exist
 * in the other.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Outlet, useNavigate } from 'react-router-dom'
import { PageHeading } from '../../components/ui'
import { useDatabase } from '../../databaseContext.tsx'
import { ACTIVITIES_PATH } from './shared'
import type { BrowseState } from './shared'

export default function BusinessActivitiesPage() {
  const { database } = useDatabase()
  const navigate = useNavigate()
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

  const browse: BrowseState = {
    draft,
    setDraft,
    query,
    setQuery,
    section,
    setSection,
    expanded,
    toggle,
  }

  return (
    <>
      <PageHeading
        title="Business Activities"
        description="Browse and maintain the SSIC business activity catalogue in the selected database."
      />
      <Outlet context={browse} />
    </>
  )
}
