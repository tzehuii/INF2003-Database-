/**
 * Saved Lists page.
 *
 * Create saved company lists and track review status.
 *
 * Two panels are shown: a list navigator on the left and the selected list on
 * the right. Companies are added by UEN, because the saved-list API does not
 * support adding by company name, and no update timestamps are shown because
 * none are returned.
 *
 * All list changes here are local to this page session and reset on reload. The
 * saved-list routes are declared but still return HTTP 501, so persistence is
 * not functional yet.
 */

import { useState } from 'react'
import { API_ROUTES, isLiveData } from '../api/client'
import type { ReviewStatus, SavedListDetail, SavedListSummary } from '../api/client'
import {
  PLACEHOLDER_SAVED_LIST_ENTRIES,
  PLACEHOLDER_SAVED_LISTS,
} from '../api/mockData'
import { useApiResource } from '../api/useApiResource'
import {
  BackendStatusStrip,
  ConfirmationBanner,
  EmptyState,
  PageHeading,
  Panel,
  PanelFooter,
  PanelNotes,
  PlaceholderNotice,
  RegistryStatusBadge,
  SampleDataBadge,
  StatusBadge,
} from '../components/ui'
import { EMPTY_VALUE, REVIEW_STATUS_OPTIONS, formatReviewStatus } from '../format'

type SavedListsData = { items: SavedListSummary[] }

type PageMessage = { text: string; tone: 'success' | 'warning' }

export default function SavedListsPage() {
  const [lists, setLists] = useState<SavedListSummary[]>(PLACEHOLDER_SAVED_LISTS)
  const [entriesById, setEntriesById] =
    useState<Record<string, SavedListDetail>>(PLACEHOLDER_SAVED_LIST_ENTRIES)
  const [selectedId, setSelectedId] = useState<string>(PLACEHOLDER_SAVED_LISTS[0]?.id ?? '')

  const [newListName, setNewListName] = useState('')
  const [renameValue, setRenameValue] = useState('')
  const [isRenaming, setIsRenaming] = useState(false)
  const [newEntryUen, setNewEntryUen] = useState('')
  const [newEntryStatus, setNewEntryStatus] = useState<ReviewStatus>('to_check')
  const [pageMessage, setPageMessage] = useState<PageMessage | null>(null)

  const { result, isLoading } = useApiResource<SavedListsData>(API_ROUTES.savedLists)

  const selectedList = lists.find((list) => list.id === selectedId) ?? null
  const selectedDetail = selectedList ? entriesById[selectedList.id] ?? null : null
  const entries = selectedDetail?.entries ?? []

  function showMessage(text: string, tone: PageMessage['tone'] = 'success') {
    setPageMessage({ text, tone })
  }

  function createList(event: React.FormEvent) {
    event.preventDefault()
    const name = newListName.trim()

    if (name === '') {
      showMessage('A saved-list name must not be blank.', 'warning')
      return
    }

    // The same normalised-name rule the backend applies, so the preview does not
    // allow two lists that differ only by case or surrounding whitespace.
    const normalized = name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    if (lists.some((list) => list.name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase() === normalized)) {
      showMessage('A saved list with the same normalised name already exists.', 'warning')
      return
    }

    const id = `local-list-${Date.now()}`
    const created: SavedListSummary = { id, name, entry_count: 0 }
    setLists((current) => [...current, created])
    setEntriesById((current) => ({
      ...current,
      [id]: { id, name, entry_count: 0, entries: [] },
    }))
    setSelectedId(id)
    setIsRenaming(false)
    setNewListName('')
    showMessage(`Created the list "${name}" in this preview session.`)
  }

  function renameList(event: React.FormEvent) {
    event.preventDefault()
    if (!selectedList) {
      return
    }

    const name = renameValue.trim()
    if (name === '') {
      showMessage('A saved-list name must not be blank.', 'warning')
      return
    }

    setLists((current) =>
      current.map((list) => (list.id === selectedList.id ? { ...list, name } : list)),
    )
    setEntriesById((current) => {
      const detail = current[selectedList.id]
      if (!detail) {
        return current
      }
      return { ...current, [selectedList.id]: { ...detail, name } }
    })
    setRenameValue('')
    setIsRenaming(false)
    showMessage(`Renamed the list to "${name}" in this preview session.`)
  }

  function deleteList() {
    if (!selectedList) {
      return
    }

    const remaining = lists.filter((list) => list.id !== selectedList.id)
    setLists(remaining)
    setEntriesById((current) => {
      const next = { ...current }
      delete next[selectedList.id]
      return next
    })
    setSelectedId(remaining[0]?.id ?? '')
    setIsRenaming(false)
    showMessage(
      `Deleted the list "${selectedList.name}" in this preview session. Source companies are never deleted.`,
    )
  }

  function addEntry(event: React.FormEvent) {
    event.preventDefault()
    if (!selectedList) {
      showMessage('Create or select a list before adding a company.', 'warning')
      return
    }

    const uen = newEntryUen.trim()
    if (uen === '') {
      showMessage('Enter a company UEN to add.', 'warning')
      return
    }

    if (entries.some((entry) => entry.company_uen === uen)) {
      showMessage(`${uen} is already in this list.`, 'warning')
      return
    }

    // The company name is resolved from the company data source, not typed here,
    // which matches the API's add-by-UEN behaviour.
    const resolvedName = `(sample) Company ${uen}`
    const nextEntry = {
      company_uen: uen,
      company_name: resolvedName,
      company_status: 'Live Company',
      review_status: newEntryStatus,
    }

    setEntriesById((current) => {
      const detail = current[selectedList.id]
      const base: SavedListDetail =
        detail ?? { id: selectedList.id, name: selectedList.name, entry_count: 0, entries: [] }
      const nextEntries = [...base.entries, nextEntry]
      return {
        ...current,
        [selectedList.id]: { ...base, entries: nextEntries, entry_count: nextEntries.length },
      }
    })
    setLists((current) =>
      current.map((list) =>
        list.id === selectedList.id ? { ...list, entry_count: list.entry_count + 1 } : list,
      ),
    )
    setNewEntryUen('')
    showMessage(`Added ${uen} to "${selectedList.name}" in this preview session.`)
  }

  function changeEntryStatus(uen: string, reviewStatus: ReviewStatus) {
    if (!selectedList) {
      return
    }
    setEntriesById((current) => {
      const detail = current[selectedList.id]
      if (!detail) {
        return current
      }
      return {
        ...current,
        [selectedList.id]: {
          ...detail,
          entries: detail.entries.map((entry) =>
            entry.company_uen === uen ? { ...entry, review_status: reviewStatus } : entry,
          ),
        },
      }
    })
  }

  function removeEntry(uen: string) {
    if (!selectedList) {
      return
    }
    setEntriesById((current) => {
      const detail = current[selectedList.id]
      if (!detail) {
        return current
      }
      const nextEntries = detail.entries.filter((entry) => entry.company_uen !== uen)
      return {
        ...current,
        [selectedList.id]: { ...detail, entries: nextEntries, entry_count: nextEntries.length },
      }
    })
    setLists((current) =>
      current.map((list) =>
        list.id === selectedList.id
          ? { ...list, entry_count: Math.max(0, list.entry_count - 1) }
          : list,
      ),
    )
  }

  return (
    <>
      <PageHeading
        icon="saved"
        title="Saved Lists"
        description="Create saved company lists and track the review status of each entry."
      />

      {pageMessage && (
        <ConfirmationBanner tone={pageMessage.tone} onDismiss={() => setPageMessage(null)}>
          {pageMessage.text}
        </ConfirmationBanner>
      )}

      <BackendStatusStrip
        route={API_ROUTES.savedLists}
        result={result}
        isLoading={isLoading}
        variant="standalone"
        note="Changes below are a local preview and reset on reload."
      />

      <div className="saved-layout">
        <Panel title="Saved Lists" badge={!isLiveData(result) ? <SampleDataBadge /> : undefined}>
          {lists.length === 0 ? (
            <EmptyState title="No saved lists yet">Create one below.</EmptyState>
          ) : (
            <ul className="list-nav">
              {lists.map((list) => (
                <li key={list.id}>
                  <button
                    type="button"
                    className="list-nav-item"
                    aria-current={list.id === selectedId ? 'true' : undefined}
                    onClick={() => {
                      setSelectedId(list.id)
                      setRenameValue('')
                      setIsRenaming(false)
                      setPageMessage(null)
                    }}
                  >
                    <span className="list-nav-name">{list.name}</span>
                    <span className="list-nav-count">
                      {list.entry_count}
                      <span className="visually-hidden"> entries</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <form className="list-nav-create" onSubmit={createList}>
            <input
              type="text"
              className="input"
              aria-label="New list name"
              placeholder="New list name"
              value={newListName}
              onChange={(event) => setNewListName(event.target.value)}
            />
            <button type="submit" className="button button-secondary" aria-label="Create New List">
              Create
            </button>
          </form>

          {!isLiveData(result) && (
            <PanelFooter>
              <PanelNotes>
                <PlaceholderNotice />
              </PanelNotes>
            </PanelFooter>
          )}
        </Panel>

        {selectedList === null ? (
          <Panel title="Selected List">
            <EmptyState title="No list selected">
              Select a saved list to see its entries.
            </EmptyState>
          </Panel>
        ) : (
          <Panel
            title={
              <>
                {selectedList.name}
                <span className="panel-count">{selectedList.entry_count} entries</span>
              </>
            }
            actions={
              <>
                <button
                  type="button"
                  className="button button-secondary"
                  aria-expanded={isRenaming}
                  onClick={() => {
                    setIsRenaming((value) => !value)
                    setRenameValue('')
                  }}
                >
                  Rename
                </button>
                <button type="button" className="button button-danger" onClick={deleteList}>
                  Delete List
                </button>
              </>
            }
          >
            {isRenaming && (
              <form className="toolbar" onSubmit={renameList}>
                <div className="toolbar-row toolbar-row-fields">
                  <label className="field field-grow">
                    <span className="field-label">Rename List</span>
                    <input
                      type="text"
                      className="input"
                      placeholder={selectedList.name}
                      value={renameValue}
                      onChange={(event) => setRenameValue(event.target.value)}
                      autoFocus
                    />
                  </label>
                  <button type="submit" className="button button-secondary">
                    Rename List
                  </button>
                  <button
                    type="button"
                    className="button button-ghost"
                    onClick={() => {
                      setIsRenaming(false)
                      setRenameValue('')
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}

            <form className="toolbar" onSubmit={addEntry}>
              <div className="toolbar-row toolbar-row-fields">
                <label className="field field-grow">
                  <span className="field-label">Company UEN</span>
                  <input
                    type="text"
                    className="input input-mono"
                    placeholder="For example 201234567A"
                    value={newEntryUen}
                    onChange={(event) => setNewEntryUen(event.target.value)}
                  />
                </label>
                <label className="field">
                  <span className="field-label">Review Status</span>
                  <select
                    className="input"
                    value={newEntryStatus}
                    onChange={(event) =>
                      setNewEntryStatus(event.target.value === 'reviewed' ? 'reviewed' : 'to_check')
                    }
                  >
                    {REVIEW_STATUS_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <button type="submit" className="button button-primary">
                  Add Company
                </button>
              </div>
              <p className="field-hint">Add companies by UEN.</p>
            </form>

            {entries.length === 0 ? (
              <EmptyState title="No entries yet">This list has no entries yet.</EmptyState>
            ) : (
              <div className="table-scroll">
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">Company name</th>
                      <th scope="col">Company UEN</th>
                      <th scope="col">Company status</th>
                      <th scope="col">Review status</th>
                      <th scope="col" className="cell-actions">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((entry) => (
                      <tr key={entry.company_uen}>
                        <td className="cell-primary">{entry.company_name ?? EMPTY_VALUE}</td>
                        <td className="cell-id">{entry.company_uen}</td>
                        <td>
                          {entry.company_status ? (
                            <RegistryStatusBadge status={entry.company_status} />
                          ) : (
                            <span className="empty-value">{EMPTY_VALUE}</span>
                          )}
                        </td>
                        <td>
                          <StatusBadge
                            tone={entry.review_status === 'reviewed' ? 'success' : 'warning'}
                          >
                            {formatReviewStatus(entry.review_status)}
                          </StatusBadge>
                        </td>
                        <td className="cell-actions">
                          <select
                            className="input input-sm"
                            aria-label={`Change status for ${entry.company_uen}`}
                            value={entry.review_status}
                            onChange={(event) =>
                              changeEntryStatus(
                                entry.company_uen,
                                event.target.value === 'reviewed' ? 'reviewed' : 'to_check',
                              )
                            }
                          >
                            {REVIEW_STATUS_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            className="button button-ghost button-sm"
                            onClick={() => removeEntry(entry.company_uen)}
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        )}
      </div>
    </>
  )
}
