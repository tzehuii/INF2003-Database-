/**
 * Detail screen for one catalogue entry.
 *
 * READ, UPDATE (title only) and DELETE all start here, and so does adding a
 * child. Every action is a real request to the selected database. The screen
 * shows what the database returns, never what was typed before saving.
 */

import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { API_ROUTES, apiRequest } from '../../api/client'
import type { ActivityDetail } from '../../api/client'
import { useApiResource } from '../../api/useApiResource'
import { Card, StatusBadge } from '../../components/ui'
import { useDatabase } from '../../databaseContext.tsx'
import {
  ACTIVITIES_PATH,
  ActivityError,
  DATABASE_LABELS,
  DetailRow,
  currentFor,
} from './shared'

function DeleteDialog({
  detail,
  onClose,
}: {
  detail: ActivityDetail
  onClose: () => void
}) {
  const { database } = useDatabase()
  const navigate = useNavigate()
  const dialog = useRef<HTMLDialogElement>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [blockedMessage, setBlockedMessage] = useState<string | null>(null)
  const label = DATABASE_LABELS[database]

  useEffect(() => {
    const element = dialog.current
    if (element !== null && !element.open) {
      element.showModal()
    }
  }, [])

  async function confirmDelete() {
    setIsDeleting(true)
    const outcome = await apiRequest<void>(API_ROUTES.activity(detail.code), database, {}, {
      method: 'DELETE',
    })
    setIsDeleting(false)

    if (outcome.state === 'success') {
      navigate(ACTIVITIES_PATH, {
        replace: true,
        state: { notice: `Deleted ${detail.code} ${detail.title} from ${label}.` },
      })
      return
    }
    setBlockedMessage(outcome.message)
  }

  return (
    <dialog
      ref={dialog}
      className="confirm-dialog"
      aria-labelledby="delete-dialog-title"
      onClose={onClose}
    >
      <h2 id="delete-dialog-title" className="card-title">
        {blockedMessage === null ? 'Delete this activity?' : 'Activity not deleted'}
      </h2>

      <dl className="detail-list detail-list-compact">
        <DetailRow label="Code">{detail.code}</DetailRow>
        <DetailRow label="Title">{detail.title}</DetailRow>
        <DetailRow label="Database">{label}</DetailRow>
      </dl>

      {blockedMessage === null ? (
        <p className="muted-text">
          This removes only this one entry from {label}. It cannot be undone. The entry is
          deleted only if it still has no child entries and no company uses it.
        </p>
      ) : (
        <p className="field-warning" role="alert">
          {blockedMessage}
        </p>
      )}

      <div className="form-actions">
        {blockedMessage === null && (
          <button
            type="button"
            className="button button-danger"
            onClick={confirmDelete}
            disabled={isDeleting}
          >
            {isDeleting ? 'Deleting…' : 'Confirm Delete'}
          </button>
        )}
        <button
          type="button"
          className="button button-secondary"
          onClick={() => dialog.current?.close()}
          disabled={isDeleting}
        >
          {blockedMessage === null ? 'Cancel' : 'Close'}
        </button>
      </div>
    </dialog>
  )
}

function ActivityDetailView({ code }: { code: string }) {
  const { database } = useDatabase()
  const navigate = useNavigate()
  const location = useLocation()
  const notice = (location.state as { notice?: string } | null)?.notice

  const { result, isLoading, reload } = useApiResource<ActivityDetail>(API_ROUTES.activity(code))
  const [isEditing, setIsEditing] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [isDeleteOpen, setIsDeleteOpen] = useState(false)

  const current = currentFor(result, database)

  if (current === null || (isLoading && current.state !== 'success')) {
    return <p className="tree-status">Loading…</p>
  }

  if (current.state !== 'success') {
    return (
      <>
        <p className="breadcrumb">
          <Link to={ACTIVITIES_PATH}>Business Activities</Link>
        </p>
        <ActivityError failure={current} title={`Activity ${code} could not be loaded.`} />
        <div className="form-actions">
          <Link className="button button-secondary" to={ACTIVITIES_PATH}>
            Back to catalogue
          </Link>
        </div>
      </>
    )
  }

  const detail = current.body
  const addLabel = detail.child_level === null ? null : `Add ${detail.child_level}`

  function startEditing() {
    setTitleDraft(detail.title)
    setSaveError(null)
    setSaved(false)
    setIsEditing(true)
  }

  function cancelEditing() {
    setIsEditing(false)
    setSaveError(null)
  }

  async function saveTitle(event: React.FormEvent) {
    event.preventDefault()
    setIsSaving(true)
    setSaveError(null)
    const outcome = await apiRequest<ActivityDetail>(API_ROUTES.activity(code), database, {}, {
      method: 'PATCH',
      body: { title: titleDraft },
    })
    setIsSaving(false)

    if (outcome.state === 'success') {
      setIsEditing(false)
      setSaved(true)
      reload()
      return
    }
    setSaveError(outcome.message)
  }

  return (
    <>
      <p className="breadcrumb">
        <Link to={ACTIVITIES_PATH}>Business Activities</Link>
        {detail.path.map((node) => (
          <span key={node.code}>
            <span aria-hidden="true"> / </span>
            <Link to={`${ACTIVITIES_PATH}/${node.code}`}>{node.code}</Link>
          </span>
        ))}
        <span aria-hidden="true"> / </span>
        <span>{detail.code}</span>
      </p>

      {notice && (
        <p className="info-note" role="status">
          {notice}
        </p>
      )}
      {saved && (
        <p className="info-note" role="status">
          Title saved.
        </p>
      )}

      <Card
        title="Activity details"
        actions={
          <>
            <button
              type="button"
              className="button button-secondary"
              onClick={startEditing}
              disabled={isEditing}
            >
              Edit
            </button>
            <button
              type="button"
              className="button button-danger"
              onClick={() => setIsDeleteOpen(true)}
              disabled={isEditing}
            >
              Delete
            </button>
          </>
        }
      >
        <form onSubmit={saveTitle} noValidate>
          <dl className="detail-list">
            <DetailRow label="Code">{detail.code}</DetailRow>
            <DetailRow label="Title">
              {isEditing ? (
                <label className="field">
                  <span className="visually-hidden">Title</span>
                  <input
                    className="field-input"
                    value={titleDraft}
                    onChange={(event) => setTitleDraft(event.target.value)}
                    aria-invalid={saveError !== null}
                    autoFocus
                  />
                </label>
              ) : (
                detail.title
              )}
            </DetailRow>
            <DetailRow label="Level">
              <StatusBadge tone="neutral">{detail.level}</StatusBadge>
            </DetailRow>
            <DetailRow label="Parent">
              {detail.parent === null ? (
                'None. This is a top-level Section.'
              ) : (
                <Link to={`${ACTIVITIES_PATH}/${detail.parent.code}`}>
                  {detail.parent.code} {detail.parent.title}
                </Link>
              )}
            </DetailRow>
          </dl>

          {saveError !== null && (
            <p className="field-warning" role="alert">
              {saveError}
            </p>
          )}

          {isEditing && (
            <div className="form-actions">
              <button type="submit" className="button button-primary" disabled={isSaving}>
                {isSaving ? 'Saving…' : 'Save'}
              </button>
              <button
                type="button"
                className="button button-secondary"
                onClick={cancelEditing}
                disabled={isSaving}
              >
                Cancel
              </button>
            </div>
          )}
        </form>
      </Card>

      <Card
        title="Child entries"
        actions={
          addLabel !== null && (
            <button
              type="button"
              className="button button-primary"
              onClick={() => navigate(`${ACTIVITIES_PATH}/new?parent=${encodeURIComponent(code)}`)}
              disabled={isEditing}
            >
              {addLabel}
            </button>
          )
        }
      >
        {detail.children.length === 0 ? (
          <p className="empty-state">
            {detail.child_level === null
              ? 'A Sub-class is the lowest level and has no child entries.'
              : 'This activity has no child entries.'}
          </p>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Code</th>
                  <th scope="col">Title</th>
                  <th scope="col">Level</th>
                </tr>
              </thead>
              <tbody>
                {detail.children.map((child) => (
                  <tr key={child.code}>
                    <td className="cell-uen">{child.code}</td>
                    <td>
                      <Link className="tree-link" to={`${ACTIVITIES_PATH}/${child.code}`}>
                        {child.title}
                      </Link>
                    </td>
                    <td className="cell-nowrap">{child.level}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {isDeleteOpen && <DeleteDialog detail={detail} onClose={() => setIsDeleteOpen(false)} />}
    </>
  )
}

export default function DetailPage() {
  const { code = '' } = useParams<{ code: string }>()
  // A new key resets edit and delete state when another entry is opened.
  return <ActivityDetailView key={code} code={code} />
}
