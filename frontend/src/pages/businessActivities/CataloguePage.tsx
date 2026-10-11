/**
 * Catalogue: an expandable tree of the selected database's business activities,
 * or a list of search matches when a search is active.
 *
 * All entries, matches and Section options come from the backend for the
 * selected database. A failed request is shown as a failure, and a successful
 * request with nothing in it is shown as empty. Nothing is filled in.
 */

import { Link } from 'react-router-dom'
import { API_ROUTES } from '../../api/client'
import type {
  ActivityChildrenData,
  ActivitySearchData,
  ApiResult,
} from '../../api/client'
import { Icon } from '../../components/icons'
import { useApiResource } from '../../api/useApiResource'
import {
  ConfirmationBanner,
  EmptyState,
  InlineError,
  Panel,
  PanelFooter,
  PanelNotes,
  SearchInput,
  SkeletonRows,
  StatusBadge,
} from '../../components/ui'
import { useDatabase } from '../../databaseContext.tsx'
import {
  ACTIVITIES_PATH,
  useFlashNotice,
  ActivityCode,
  ActivityError,
  HighlightMatch,
  currentFor,
  levelClass,
  useBrowse,
} from './shared'

function TreeLevel({ parentCode }: { parentCode: string | null }) {
  const { database } = useDatabase()
  const { section, expanded, toggle } = useBrowse()
  const { result, isLoading, reload } = useApiResource<ActivityChildrenData>(
    API_ROUTES.activityChildren,
    {
      parent_code: parentCode ?? undefined,
      // The Section filter narrows the top level. Everything below is already inside it.
      section: parentCode === null ? section || undefined : undefined,
    },
  )

  const isRoot = parentCode === null
  const current = currentFor(result, database)

  // Skeleton rows match the final row height, so nothing above them moves.
  if (current === null || isLoading) {
    return isRoot ? (
      <SkeletonRows count={8} label="Loading the catalogue" />
    ) : (
      <div className="tree-children">
        <SkeletonRows count={3} label="Loading child entries" />
      </div>
    )
  }

  if (current.state !== 'success') {
    const retry = (
      <button type="button" className="button button-ghost button-sm" onClick={reload}>
        Retry
      </button>
    )
    return isRoot ? (
      <div className="panel-pad">
        <ActivityError
          failure={current}
          title="This level could not be loaded."
          action={retry}
        />
      </div>
    ) : (
      <div className="tree-children">
        <InlineError compact title="This level could not be loaded." action={retry}>
          {current.message}
        </InlineError>
      </div>
    )
  }

  const items = current.body.items
  if (items.length === 0) {
    return isRoot ? (
      <EmptyState title="The catalogue is empty">
        No business activities were found in the selected database.
      </EmptyState>
    ) : (
      <div className="tree-children">
        <p className="tree-empty-row">No child entries</p>
      </div>
    )
  }

  return (
    <ul className={isRoot ? 'tree tree-root' : 'tree tree-children'}>
      {items.map((item) => {
        const isOpen = expanded.includes(item.code)
        return (
          <li key={item.code}>
            <div
              className={`tree-row ${levelClass(item.level)}${
                item.has_children ? ' tree-row-parent' : ''
              }`}
              onClick={(event) => {
                // Clicking empty row space on a parent also toggles it. Links and
                // the chevron button handle their own clicks.
                if (item.has_children && !(event.target as HTMLElement).closest('a, button')) {
                  toggle(item.code)
                }
              }}
            >
              {item.has_children ? (
                <button
                  type="button"
                  className="tree-toggle"
                  aria-expanded={isOpen}
                  aria-label={`${isOpen ? 'Collapse' : 'Expand'} ${item.code} ${item.title}`}
                  onClick={() => toggle(item.code)}
                >
                  <Icon name="chevron" />
                </button>
              ) : (
                <span className="tree-toggle-spacer" aria-hidden="true" />
              )}
              <span className="tree-code">
                <ActivityCode code={item.code} level={item.level} parentCode={parentCode} />
              </span>
              <span className="tree-title">
                <Link className="row-link" to={`${ACTIVITIES_PATH}/${item.code}`} title={item.title}>
                  {item.title}
                </Link>
              </span>
              <span className="tree-level">{item.level}</span>
            </div>
            {isOpen && item.has_children && <TreeLevel parentCode={item.code} />}
          </li>
        )
      })}
    </ul>
  )
}

function SearchResults({
  current,
  isLoading,
  query,
  section,
}: {
  current: ApiResult<ActivitySearchData> | null
  isLoading: boolean
  query: string
  section: string
}) {
  if (current === null || isLoading) {
    return <SkeletonRows count={6} height={44} label="Searching" />
  }
  if (current.state !== 'success') {
    return (
      <div className="panel-pad">
        <ActivityError failure={current} title="The search could not be completed." />
      </div>
    )
  }

  const { items } = current.body
  if (items.length === 0) {
    return (
      <EmptyState title="No matches">
        No business activities match “{query}”
        {section ? ` in Section ${section}` : ''}.
      </EmptyState>
    )
  }

  return (
    <div className="table-scroll">
      <table className="table">
        <thead>
          <tr>
            <th scope="col">Code</th>
            <th scope="col">Title</th>
            <th scope="col" className="col-path">
              Path
            </th>
            <th scope="col">Level</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const parent = item.parent_path[item.parent_path.length - 1]
            const fullPath = item.parent_path.map((node) => `${node.code} ${node.title}`).join(' › ')
            return (
              <tr key={item.code}>
                <td className="cell-id">
                  <ActivityCode code={item.code} level={item.level} parentCode={parent?.code} />
                </td>
                <td className="cell-primary">
                  <Link className="row-link" to={`${ACTIVITIES_PATH}/${item.code}`}>
                    <HighlightMatch text={item.title} query={query} />
                  </Link>
                </td>
                <td className="col-path">
                  {parent === undefined ? (
                    <span className="muted-text">Top level</span>
                  ) : (
                    <span className="path-trail" title={fullPath}>
                      <span className="path-codes">
                        {item.parent_path.map((node) => node.code).join(' › ')}
                      </span>{' '}
                      {parent.title}
                    </span>
                  )}
                </td>
                <td className="cell-level">{item.level}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export default function CataloguePage() {
  const { database } = useDatabase()
  const browse = useBrowse()
  const { notice, dismiss: dismissNotice } = useFlashNotice()

  const sections = useApiResource<ActivityChildrenData>(API_ROUTES.activityChildren)
  const sectionResult = currentFor(sections.result, database)
  const sectionOptions =
    sectionResult !== null && sectionResult.state === 'success' ? sectionResult.body.items : []

  const searching = browse.query !== ''

  // The search request is made here, so the match count can sit in the panel
  // title. It is only sent while a search is active.
  const search = useApiResource<ActivitySearchData>(
    searching ? API_ROUTES.activitySearch : null,
    { q: browse.query, section: browse.section || undefined },
  )
  const searchCurrent = currentFor(search.result, database)
  const searchBody =
    searchCurrent !== null && searchCurrent.state === 'success' ? searchCurrent.body : null

  function submitSearch(event: React.FormEvent) {
    event.preventDefault()
    browse.setQuery(browse.draft.trim())
  }

  function clearSearch() {
    browse.setDraft('')
    browse.setQuery('')
  }

  return (
    <>
      {notice && <ConfirmationBanner onDismiss={dismissNotice}>{notice}</ConfirmationBanner>}

      <Panel
        title={searching ? <>Results for “{browse.query}”</> : 'Catalogue'}
        badge={
          searching && searchBody !== null && !search.isLoading ? (
            <StatusBadge tone="neutral">
              {searchBody.items.length} {searchBody.items.length === 1 ? 'match' : 'matches'}
            </StatusBadge>
          ) : undefined
        }
        actions={
          !searching && browse.expanded.length > 0 ? (
            <button type="button" className="button button-ghost button-sm" onClick={browse.collapseAll}>
              Collapse all
            </button>
          ) : undefined
        }
      >
        <form className="toolbar" onSubmit={submitSearch}>
          <div className="toolbar-row">
            <SearchInput
              aria-label="Activity name or SSIC code"
              placeholder="Name (any part) or SSIC code (prefix), e.g. wholesale or 0111"
              value={browse.draft}
              onChange={(event) => browse.setDraft(event.target.value)}
            />
            <select
              className="input input-section"
              aria-label="Section"
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
            <div className="toolbar-end">
              <button type="submit" className="button button-primary">
                Search
              </button>
              <button
                type="button"
                className="button button-ghost"
                onClick={clearSearch}
                disabled={browse.draft === '' && !searching}
              >
                Clear search
              </button>
            </div>
          </div>
          {sectionResult !== null && sectionResult.state !== 'success' && (
            <p className="field-warning">Sections could not be loaded.</p>
          )}
        </form>

        <p className="legend">
          <span>Section A › Division 01 › Group 011 › Class 0111 › Sub-class 01111</span>
        </p>

        {searching ? (
          <SearchResults
            current={searchCurrent}
            isLoading={search.isLoading}
            query={browse.query}
            section={browse.section}
          />
        ) : (
          <TreeLevel parentCode={null} />
        )}

        {searching && searchBody !== null && !search.isLoading && searchBody.items.length > 0 && (
          <PanelFooter>
            <PanelNotes>
              <p>
                {searchBody.items.length} {searchBody.items.length === 1 ? 'match' : 'matches'}{' '}
                shown
                {searchBody.has_more
                  ? '. More matches exist, so narrow the search or choose a Section.'
                  : '.'}
              </p>
            </PanelNotes>
          </PanelFooter>
        )}
      </Panel>
    </>
  )
}
