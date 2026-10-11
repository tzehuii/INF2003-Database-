/**
 * Create form for one catalogue entry.
 *
 * With no `parent` in the address the form creates a Section. With a parent, the
 * parent and the new entry's level are already decided. The code field starts
 * with an unused code from the selected database and can be edited. The backend
 * checks the code again when saving, so a suggestion never reserves it.
 */

import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { API_ROUTES, apiRequest } from '../../api/client'
import type { ActivityDetail, ActivityNextCode } from '../../api/client'
import { useApiResource } from '../../api/useApiResource'
import { Card } from '../../components/ui'
import { useDatabase } from '../../databaseContext.tsx'
import {
  ACTIVITIES_PATH,
  ActivityError,
  CODE_FORMAT_HINTS,
  DATABASE_LABELS,
  DetailRow,
  currentFor,
} from './shared'

function CreateForm({ parentCode }: { parentCode: string | null }) {
  const { database } = useDatabase()
  const navigate = useNavigate()
  const parentRequest = useApiResource<ActivityDetail>(
    parentCode === null ? null : API_ROUTES.activity(parentCode),
  )
  const suggestion = useApiResource<ActivityNextCode>(API_ROUTES.activityNextCode, {
    parent_code: parentCode ?? undefined,
  })

  const [title, setTitle] = useState('')
  const [code, setCode] = useState('')
  const [codeEdited, setCodeEdited] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const suggested = currentFor(suggestion.result, database)
  const suggestedCode = suggested?.state === 'success' ? suggested.body.code : null

  // Fill the code field with the suggestion until the user types their own.
  useEffect(() => {
    if (suggestedCode !== null && !codeEdited) {
      setCode(suggestedCode)
    }
  }, [suggestedCode, codeEdited])

  const parentResult = currentFor(parentRequest.result, database)
  const parent = parentResult?.state === 'success' ? parentResult.body : null
  const level = parentCode === null ? 'Section' : (parent?.child_level ?? null)
  const backPath = parentCode === null ? ACTIVITIES_PATH : `${ACTIVITIES_PATH}/${parentCode}`
  const label = DATABASE_LABELS[database]

  if (
    suggested === null ||
    suggestion.isLoading ||
    (parentCode !== null && (parentResult === null || parentRequest.isLoading))
  ) {
    return <p className="tree-status">Loading…</p>
  }

  // The parent could not be read, or it is a Sub-class. Nothing can be created.
  if (parentResult !== null && parentResult.state !== 'success') {
    return (
      <>
        <ActivityError failure={parentResult} title="The parent entry could not be loaded." />
        <div className="form-actions">
          <Link className="button button-secondary" to={ACTIVITIES_PATH}>
            Back to catalogue
          </Link>
        </div>
      </>
    )
  }

  const suggestionFailure = suggested.state === 'success' ? null : suggested

  function suggestAnother() {
    setCodeEdited(false)
    setSaveError(null)
    suggestion.reload()
  }

  async function save(event: React.FormEvent) {
    event.preventDefault()
    setIsSaving(true)
    setSaveError(null)
    const outcome = await apiRequest<ActivityDetail>(API_ROUTES.activities, database, {}, {
      method: 'POST',
      body: { title, code, parent_code: parentCode },
    })
    setIsSaving(false)

    if (outcome.state === 'success') {
      const created = outcome.body
      navigate(`${ACTIVITIES_PATH}/${created.code}`, {
        replace: true,
        state: { notice: `Created ${created.code} ${created.title} in ${label}.` },
      })
      return
    }
    setSaveError(outcome.message)
  }

  return (
    <Card title={level === null ? 'Add entry' : `Create ${level}`}>
      {suggestionFailure !== null && (
        <ActivityError
          failure={suggestionFailure}
          title={
            suggestionFailure.code === 'code_space_exhausted'
              ? 'No code is available.'
              : 'A code could not be suggested.'
          }
        />
      )}

      <form onSubmit={save} noValidate>
        <dl className="detail-list">
          <DetailRow label="Database">{label}</DetailRow>
          <DetailRow label="Level">{level ?? 'Not available'}</DetailRow>
          <DetailRow label="Parent">
            {parent === null ? (
              'None. This creates a top-level Section.'
            ) : (
              <>
                {parent.code} {parent.title} ({parent.level})
              </>
            )}
          </DetailRow>
        </dl>

        <div className="filter-grid form-fields">
          <label className="field">
            <span className="field-label">Title</span>
            <input
              className="field-input"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              disabled={suggestionFailure !== null}
              autoFocus
            />
            <span className="field-hint">Up to 500 characters.</span>
          </label>

          <label className="field">
            <span className="field-label">Code</span>
            <input
              className="field-input"
              value={code}
              onChange={(event) => {
                setCode(event.target.value)
                setCodeEdited(true)
              }}
              disabled={suggestionFailure !== null}
              spellCheck={false}
              autoComplete="off"
            />
            <span className="field-hint">
              {level !== null && CODE_FORMAT_HINTS[level]} A suggested unused code is filled in.
              You can edit it. Availability is checked again when you save.
            </span>
          </label>
        </div>

        {saveError !== null && (
          <p className="field-warning" role="alert">
            {saveError}
          </p>
        )}

        <div className="form-actions">
          <button
            type="submit"
            className="button button-primary"
            disabled={isSaving || suggestionFailure !== null}
          >
            {isSaving ? 'Saving…' : 'Save'}
          </button>
          <button
            type="button"
            className="button button-secondary"
            onClick={suggestAnother}
            disabled={isSaving || suggestionFailure !== null}
          >
            Suggest another code
          </button>
          <button
            type="button"
            className="button button-secondary"
            onClick={() => navigate(backPath)}
            disabled={isSaving}
          >
            Cancel
          </button>
        </div>
      </form>
    </Card>
  )
}

export default function CreatePage() {
  const [params] = useSearchParams()
  const parentCode = params.get('parent')
  // A new key resets the form when the parent changes.
  return <CreateForm key={parentCode ?? 'section'} parentCode={parentCode} />
}
