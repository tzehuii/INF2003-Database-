/**
 * Detail screen for one catalogue entry.
 *
 * READ, UPDATE (title only) and DELETE all start here, and so does adding a
 * child. Every action is a real request to the selected database. The screen
 * shows what the database returns, never what was typed before saving.
 */

import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { API_ROUTES, apiRequest } from '../../api/client'
import type { ActivityDetail } from '../../api/client'
import { useApiResource } from '../../api/useApiResource'
import { truncateText, useBreadcrumbTrail } from '../../breadcrumbContext'
import {
  Attribute,
  AttributeList,
  ConfirmationBanner,
  PageHeading,
  Panel,
  SkeletonRows,
  StatusBadge,
} from '../../components/ui'
import { useDatabase } from '../../databaseContext.tsx'
import {
  ACTIVITIES_PATH,
  ActivityCode,
  useFlashNotice,
  ActivityError,
  DATABASE_LABELS,
  HierarchyList,
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
      className="dialog"
      aria-labelledby="delete-dialog-title"
      onClose={onClose}
    >
      <h2 id="delete-dialog-title" className="dialog-title">
        {blockedMessage === null ? 'Delete this activity?' : 'Activity not deleted'}
      </h2>

      <AttributeList>
        <Attribute label="Code">
          <span className="mono">{detail.code}</span>
        </Attribute>
        <Attribute label="Title">{detail.title}</Attribute>
        <Attribute label="Database">{label}</Attribute>
      </AttributeList>

      {blockedMessage === null ? (
        <p className="dialog-text">
          This removes only this one entry from {label}. It cannot be undone. The entry is
          deleted only if it still has no child entries and no company uses it.
        </p>
      ) : (
        <p className="field-warning" role="alert">
          {blockedMessage}
        </p>
      )}

      <div className="dialog-actions">
        <button
          type="button"
          className="button button-secondary"
          onClick={() => dialog.current?.close()}
          disabled={isDeleting}
        >
          {blockedMessage === null ? 'Cancel' : 'Close'}
        </button>
        {blockedMessage === null && (
          <button
            type="button"
            className="button button-danger-solid"
            onClick={confirmDelete}
            disabled={isDeleting}
          >
            {isDeleting ? 'Deleting…' : 'Confirm Delete'}
          </button>
        )}
      </div>
    </dialog>
  )
}

function ActivityDetailView({ code }: { code: string }) {
  const { database } = useDatabase()
  const navigate = useNavigate()
  const { notice, show: showNotice, dismiss: dismissNotice } = useFlashNotice()

  const { result, isLoading, reload } = useApiResource<ActivityDetail>(API_ROUTES.activity(code))
  const [isEditing, setIsEditing] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const [isDeleteOpen, setIsDeleteOpen] = useState(false)

  const current = currentFor(result, database)
  const loaded = current !== null && current.state === 'success' ? current.body : null

  // The top-bar breadcrumb shows every ancestor as a link, then this entry.
  useBreadcrumbTrail(
    loaded === null
      ? null
      : [
          { label: 'Business Activities', to: ACTIVITIES_PATH },
          ...loaded.path.map((node) => ({
            code: node.code,
            label: truncateText(node.title, 24),
            title: `${node.code} ${node.title}`,
            to: `${ACTIVITIES_PATH}/${node.code}`,
          })),
          {
            code: loaded.code,
            label: truncateText(loaded.title, 24),
            title: `${loaded.code} ${loaded.title}`,
          },
        ],
  )

  if (current === null || (isLoading && current.state !== 'success')) {
    return (
      <Panel>
        <SkeletonRows count={4} height={44} label="Loading the activity" />
      </Panel>
    )
  }

  if (current.state !== 'success') {
    return (
      <>
        <PageHeading
          title="Business Activities"
          actions={
            <Link className="button button-secondary" to={ACTIVITIES_PATH}>
              Back to catalogue
            </Link>
          }
        />
        <ActivityError failure={current} title={`Activity ${code} could not be loaded.`} />
      </>
    )
  }

  const detail = current.body
  const addLabel = detail.child_level === null ? null : `Add ${detail.child_level}`

  function startEditing() {
    setTitleDraft(detail.title)
    setSaveError(null)
    dismissNotice()
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
      showNotice('Title saved.')
      reload()
      return
    }
    setSaveError(outcome.message)
  }

  return (
    <>
      <PageHeading
        title={detail.title}
        leading={
          detail.level === 'Section' ? (
            <span className="code-tile">{detail.code}</span>
          ) : (
            <span className="code-heading">{detail.code}</span>
          )
        }
        trailing={<StatusBadge tone="outline">{detail.level}</StatusBadge>}
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
      />

      {notice && <ConfirmationBanner onDismiss={dismissNotice}>{notice}</ConfirmationBanner>}

      <Panel title="Activity details">
        <form onSubmit={saveTitle} noValidate>
          <AttributeList>
            <Attribute label="Title">
              {isEditing ? (
                <label className="field">
                  <span className="visually-hidden">Title</span>
                  <input
                    className="input"
                    value={titleDraft}
                    onChange={(event) => setTitleDraft(event.target.value)}
                    aria-invalid={saveError !== null}
                    autoFocus
                  />
                </label>
              ) : (
                detail.title
              )}
            </Attribute>
            <Attribute label="Parent">
              {detail.parent === null ? (
                'None. This is a top-level Section.'
              ) : (
                <span className="parent-line">
                  <ActivityCode
                    code={detail.parent.code}
                    level={detail.parent.level}
                    parentCode={detail.path.length > 1 ? detail.path[detail.path.length - 2].code : null}
                  />
                  <Link className="row-link" to={`${ACTIVITIES_PATH}/${detail.parent.code}`}>
                    {detail.parent.title}
                  </Link>
                </span>
              )}
            </Attribute>
          </AttributeList>

          {saveError !== null && (
            <div className="panel-pad">
              <p className="field-warning" role="alert">
                {saveError}
              </p>
            </div>
          )}

          {isEditing && (
            <div className="panel-pad panel-pad-actions">
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
      </Panel>

      <Panel
        title="Hierarchy"
        actions={
          addLabel !== null && (
            <button
              type="button"
              className="button button-secondary"
              onClick={() => navigate(`${ACTIVITIES_PATH}/new?parent=${encodeURIComponent(code)}`)}
              disabled={isEditing}
            >
              {addLabel}
            </button>
          )
        }
      >
        <HierarchyList
          ancestors={detail.path}
          current={detail}
          childEntries={detail.children}
        />
      </Panel>
      {isDeleteOpen && <DeleteDialog detail={detail} onClose={() => setIsDeleteOpen(false)} />}
    </>
  )
}

export default function DetailPage() {
  const { code = '' } = useParams<{ code: string }>()
  // A new key resets edit and delete state when another entry is opened.
  return <ActivityDetailView key={code} code={code} />
}
