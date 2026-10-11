/**
 * Catalogue: an expandable tree of the selected database's business activities,
 * or a list of search matches when a search is active.
 *
 * All entries, matches and Section options come from the backend for the
 * selected database. A failed request is shown as a failure, and a successful
 * request with nothing in it is shown as empty. Nothing is filled in.
 */

import { Link, useLocation, useNavigate } from 'react-router-dom'
import { API_ROUTES } from '../../api/client'
import type { ActivityChildrenData, ActivitySearchData } from '../../api/client'
import { useApiResource } from '../../api/useApiResource'
import { Card, StatusBadge } from '../../components/ui'
import { useDatabase } from '../../databaseContext.tsx'
import { ACTIVITIES_PATH, ActivityError, currentFor, useBrowse } from './shared'

function TreeLevel({ parentCode }: { parentCode: string | null }) {
  const { database } = useDatabase()
  const { section, expanded, toggle } = useBrowse()
  const { result, isLoading } = useApiResource<ActivityChildrenData>(API_ROUTES.activityChildren, {
    parent_code: parentCode ?? undefined,
    // The Section filter narrows the top level. Everything below is already inside it.
    section: parentCode === null ? section || undefined : undefined,
  })

  const current = currentFor(result, database)
  if (current === null || isLoading) {
    return <p className="tree-status">Loading…</p>
  }
  if (current.state !== 'success') {
    return <ActivityError failure={current} title="This level could not be loaded." />
  }

  const items = current.body.items
  if (items.length === 0) {
    return (
      <p className="empty-state">
        {parentCode === null
          ? 'No business activities were found in the selected database.'
          : 'No child entries were found.'}
      </p>
    )
  }

  return (
    <ul className="activity-tree">
      {items.map((item) => {
        const isOpen = expanded.includes(item.code)
        return (
          <li key={item.code}>
            <div className="tree-row">
              {item.has_children ? (
                <button
                  type="button"
                  className="tree-toggle"
                  aria-expanded={isOpen}
                  aria-label={`${isOpen ? 'Collapse' : 'Expand'} ${item.code} ${item.title}`}
                  onClick={() => toggle(item.code)}
                >
                  {isOpen ? '▾' : '▸'}
                </button>
              ) : (
                <span className="tree-toggle-spacer" aria-hidden="true" />
              )}
              <span className="activity-code">{item.code}</span>
              <Link className="tree-link" to={`${ACTIVITIES_PATH}/${item.code}`}>
                {item.title}
              </Link>
              <StatusBadge tone="muted">{item.level}</StatusBadge>
            </div>
            {isOpen && item.has_children && <TreeLevel parentCode={item.code} />}
          </li>
        )
      })}
    </ul>
  )
}

function SearchResults() {
  const { database } = useDatabase()
  const { query, section } = useBrowse()
  const { result, isLoading } = useApiResource<ActivitySearchData>(API_ROUTES.activitySearch, {
    q: query,
    section: section || undefined,
  })

  const current = currentFor(result, database)
  if (current === null || isLoading) {
    return <p className="tree-status">Searching…</p>
  }
  if (current.state !== 'success') {
    return <ActivityError failure={current} title="The search could not be completed." />
  }

  const { items, has_more: hasMore } = current.body
  if (items.length === 0) {
    return (
      <p className="empty-state">
        No business activities match “{query}”
        {section ? ` in Section ${section}` : ''}.
      </p>
    )
  }

  return (
    <>
      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">Code</th>
              <th scope="col">Title</th>
              <th scope="col">Level</th>
              <th scope="col">Parent path</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.code}>
                <td className="cell-uen">{item.code}</td>
                <td>
                  <Link className="tree-link" to={`${ACTIVITIES_PATH}/${item.code}`}>
                    {item.title}
                  </Link>
                </td>
                <td className="cell-nowrap">{item.level}</td>
                <td>
                  {item.parent_path.length === 0
                    ? 'Top level'
                    : item.parent_path.map((node) => `${node.code} ${node.title}`).join(' › ')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="pagination-note">
        {items.length} {items.length === 1 ? 'match' : 'matches'} shown
        {hasMore ? '. More matches exist, so narrow the search or choose a Section.' : '.'}
      </p>
    </>
  )
}

export default function CataloguePage() {
  const { database } = useDatabase()
  const navigate = useNavigate()
  const location = useLocation()
  const browse = useBrowse()
  const notice = (location.state as { notice?: string } | null)?.notice

  const sections = useApiResource<ActivityChildrenData>(API_ROUTES.activityChildren)
  const sectionResult = currentFor(sections.result, database)
  const sectionOptions =
    sectionResult !== null && sectionResult.state === 'success' ? sectionResult.body.items : []

  function submitSearch(event: React.FormEvent) {
    event.preventDefault()
    browse.setQuery(browse.draft.trim())
  }

  function clearSearch() {
    browse.setDraft('')
    browse.setQuery('')
  }

  const searching = browse.query !== ''

  return (
    <>
      {notice && (
        <p className="info-note" role="status">
          {notice}
        </p>
      )}

      <Card title="Find activities">
        <form onSubmit={submitSearch}>
          <div className="filter-grid">
            <label className="field">
              <span className="field-label">Activity name or SSIC code</span>
              <input
                type="search"
                className="field-input"
                value={browse.draft}
                placeholder="For example wholesale, or 0111"
                onChange={(event) => browse.setDraft(event.target.value)}
              />
              <span className="field-hint">
                Name matches any part of the title. Code matches the start of a code.
              </span>
            </label>

            <label className="field">
              <span className="field-label">Section</span>
              <select
                className="field-input"
                value={browse.section}
                onChange={(event) => browse.setSection(event.target.value)}
              >
                <option value="">All Sections</option>
                {sectionOptions.map((item) => (
                  <option key={item.code} value={item.code}>
                    {item.code} — {item.title}
                  </option>
                ))}
              </select>
              {sectionResult !== null && sectionResult.state !== 'success' && (
                <span className="field-warning">Sections could not be loaded.</span>
              )}
            </label>
          </div>

          <div className="form-actions">
            <button type="submit" className="button button-primary">
              Search
            </button>
            <button
              type="button"
              className="button button-secondary"
              onClick={clearSearch}
              disabled={browse.draft === '' && !searching}
            >
              Clear search
            </button>
          </div>
        </form>
      </Card>

      <Card
        title={searching ? `Search results for “${browse.query}”` : 'Catalogue'}
        actions={
          <button
            type="button"
            className="button button-primary"
            onClick={() => navigate(`${ACTIVITIES_PATH}/new`)}
          >
            Create Section
          </button>
        }
      >
        {searching ? <SearchResults /> : <TreeLevel parentCode={null} />}
      </Card>
    </>
  )
}
