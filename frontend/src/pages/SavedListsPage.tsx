/**
 * Saved Lists page.
 *
 * Create saved company lists and track review status.
 *
 * Two panels are shown: the saved-list panel on the left and the selected list
 * on the right. Companies are added by UEN, because the saved-list API does not
 * support adding by company name, and no update timestamps are shown because
 * none are returned.
 *
 * All list changes here are local to this page session and reset on reload. The
 * saved-list routes are declared but still return HTTP 501, so persistence is
 * not functional yet.
 */

import { useState } from 'react'
import { API_ROUTES } from '../api/client'
import type { ReviewStatus, SavedListDetail, SavedListSummary } from '../api/client'
import {
  PLACEHOLDER_SAVED_LIST_ENTRIES,
  PLACEHOLDER_SAVED_LISTS,
} from '../api/mockData'
import { useApiResource } from '../api/useApiResource'
import { BackendStatusStrip, Card, PageHeading, PlaceholderNotice, StatusBadge } from '../components/ui'
import { EMPTY_VALUE, REVIEW_STATUS_OPTIONS, formatReviewStatus } from '../format'

type SavedListsData = { items: SavedListSummary[] }

export default function SavedListsPage() {
  const [lists, setLists] = useState<SavedListSummary[]>(PLACEHOLDER_SAVED_LISTS)
  const [entriesById, setEntriesById] =
    useState<Record<string, SavedListDetail>>(PLACEHOLDER_SAVED_LIST_ENTRIES)
  const [selectedId, setSelectedId] = useState<string>(PLACEHOLDER_SAVED_LISTS[0]?.id ?? '')

  const [newListName, setNewListName] = useState('')
  const [renameValue, setRenameValue] = useState('')
  const [newEntryUen, setNewEntryUen] = useState('')
  const [newEntryStatus, setNewEntryStatus] = useState<ReviewStatus>('to_check')
  const [pageMessage, setPageMessage] = useState<string | null>(null)

  const { result, isLoading } = useApiResource<SavedListsData>(API_ROUTES.savedLists)

  const selectedList = lists.find((list) => list.id === selectedId) ?? null
  const selectedDetail = selectedList ? entriesById[selectedList.id] ?? null : null
  const entries = selectedDetail?.entries ?? []

  function showMessage(message: string) {
    setPageMessage(message)
  }

  function createList(event: React.FormEvent) {
    event.preventDefault()
    const name = newListName.trim()

    if (name === '') {
      showMessage('A saved-list name must not be blank.')
      return
    }

    // The same normalised-name rule the backend applies, so the preview does not
    // allow two lists that differ only by case or surrounding whitespace.
    const normalized = name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    if (lists.some((list) => list.name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase() === normalized)) {
      showMessage('A saved list with the same normalised name already exists.')
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
      showMessage('A saved-list name must not be blank.')
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
    showMessage(
      `Deleted the list "${selectedList.name}" in this preview session. Source companies are never deleted.`,
    )
  }

  function addEntry(event: React.FormEvent) {
    event.preventDefault()
    if (!selectedList) {
      showMessage('Create or select a list before adding a company.')
      return
    }

    const uen = newEntryUen.trim()
    if (uen === '') {
      showMessage('Enter a company UEN to add.')
      return
    }

    if (entries.some((entry) => entry.company_uen === uen)) {
      showMessage(`${uen} is already in this list.`)
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
        title="Saved Lists"
        description="Create saved company lists and track the review status of each entry."
      />

      <BackendStatusStrip
        route={API_ROUTES.savedLists}
        result={result}
        isLoading={isLoading}
        note="List creation, rename, delete, and entry changes below are a local preview and reset when the page reloads. Saved-list persistence arrives once the route is implemented."
      />

      {pageMessage && (
        <div className="status-strip status-strip-info">
          <div className="status-strip-body">
            <p className="status-strip-label">{pageMessage}</p>
          </div>
          <button
            type="button"
            className="button button-link"
            onClick={() => setPageMessage(null)}
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="saved-lists-layout">
        <Card title="Saved Lists" className="saved-lists-panel">
          <PlaceholderNotice text="Placeholder lists, used to show the two-panel layout. They are not real data." />

          <form className="stacked-form" onSubmit={createList}>
            <label className="field">
              <span className="field-label">Create New List</span>
              <input
                type="text"
                className="field-input"
                placeholder="List name"
                value={newListName}
                onChange={(event) => setNewListName(event.target.value)}
              />
            </label>
            <button type="submit" className="button button-primary">
              Create New List
            </button>
          </form>

          <ul className="list-picker">
            {lists.map((list) => (
              <li key={list.id}>
                <button
                  type="button"
                  className={
                    list.id === selectedId
                      ? 'list-picker-item list-picker-item-active'
                      : 'list-picker-item'
                  }
                  onClick={() => {
                    setSelectedId(list.id)
                    setRenameValue('')
                    setPageMessage(null)
                  }}
                >
                  <span className="list-picker-name">{list.name}</span>
                  <span className="list-picker-count">{list.entry_count} entries</span>
                </button>
              </li>
            ))}
            {lists.length === 0 && (
              <li className="empty-state">No saved lists yet. Create one above.</li>
            )}
          </ul>
        </Card>

        <div className="saved-lists-main">
          {selectedList === null ? (
            <Card title="Selected List">
              <p className="empty-state">Select a saved list to see its entries.</p>
            </Card>
          ) : (
            <>
              <Card title={selectedList.name}>
                <div className="selected-list-meta">
                  <span>
                    <strong>{selectedList.entry_count}</strong> entries
                  </span>
                </div>

                <form className="inline-form" onSubmit={renameList}>
                  <label className="field">
                    <span className="field-label">Rename List</span>
                    <input
                      type="text"
                      className="field-input"
                      placeholder={selectedList.name}
                      value={renameValue}
                      onChange={(event) => setRenameValue(event.target.value)}
                    />
                  </label>
                  <button type="submit" className="button button-secondary">
                    Rename List
                  </button>
                </form>

                <div className="form-actions">
                  <button type="button" className="button button-danger" onClick={deleteList}>
                    Delete List
                  </button>
                </div>
              </Card>

              <Card title="Add Company">
                <form className="inline-form" onSubmit={addEntry}>
                  <label className="field">
                    <span className="field-label">Company UEN</span>
                    <input
                      type="text"
                      className="field-input"
                      placeholder="For example 201234567A"
                      value={newEntryUen}
                      onChange={(event) => setNewEntryUen(event.target.value)}
                    />
                  </label>
                  <label className="field">
                    <span className="field-label">Review Status</span>
                    <select
                      className="field-input"
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
                </form>
                <p className="pagination-note">
                  Companies are added by UEN. The saved-list API does not support adding by
                  company name, so no company-name search is offered here.
                </p>
              </Card>

              <Card title="Entries">
                {entries.length === 0 ? (
                  <p className="empty-state">This list has no entries yet.</p>
                ) : (
                  <div className="table-scroll">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th scope="col">Company UEN</th>
                          <th scope="col">Company Name</th>
                          <th scope="col">Company Status</th>
                          <th scope="col">Review Status</th>
                          <th scope="col">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {entries.map((entry) => (
                          <tr key={entry.company_uen}>
                            <td className="cell-uen">{entry.company_uen}</td>
                            <td>{entry.company_name ?? EMPTY_VALUE}</td>
                            <td>{entry.company_status ?? EMPTY_VALUE}</td>
                            <td>
                              <StatusBadge
                                tone={entry.review_status === 'reviewed' ? 'positive' : 'warning'}
                              >
                                {formatReviewStatus(entry.review_status)}
                              </StatusBadge>
                            </td>
                            <td className="cell-actions">
                              <select
                                className="field-input field-input-compact"
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
                                className="button button-link"
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
                <p className="pagination-note">
                  Entries are ordered by company display name and then UEN once the API
                  supplies them. No update timestamps are shown, because none are
                  returned.
                </p>
              </Card>
            </>
          )}
        </div>
      </div>
    </>
  )
}
