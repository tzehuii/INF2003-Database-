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
import {
  Attribute,
  AttributeList,
  PageHeading,
  Panel,
  SkeletonRows,
} from '../../components/ui'
import { useDatabase } from '../../databaseContext.tsx'
import {
  ACTIVITIES_PATH,
  ActivityError,
  CODE_FORMAT_HINTS,
  DATABASE_LABELS,
  currentFor,
} from './shared'

function CreateForm({ parentCode }: { parentCode: string | null }) {
  const { database } = useDatabase()
  const navigate = useNavigate()
  const parentRequest = useApiResource<ActivityDetail>(
    parentCode === null ? null : API_ROUTES.activity(parentCode),
  )
  // The code the next suggestion must follow, so "Suggest another code" moves on
  // instead of asking the backend the same question again.
  const [afterCode, setAfterCode] = useState<string | undefined>(undefined)
  const suggestion = useApiResource<ActivityNextCode>(API_ROUTES.activityNextCode, {
    parent_code: parentCode ?? undefined,
    after: afterCode,
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

  // The skeleton shows only before the first answer. A later "Suggest another
  // code" refreshes in place, so the form and what was typed stay on screen.
  if (
    suggested === null ||
    (parentCode !== null && (parentResult === null || parentRequest.isLoading))
  ) {
    return (
      <Panel>
        <SkeletonRows count={4} height={44} label="Loading the form" />
      </Panel>
    )
  }

  // The parent could not be read, or it is a Sub-class. Nothing can be created.
  if (parentResult !== null && parentResult.state !== 'success') {
    return (
      <>
        <PageHeading
          title="Add entry"
          actions={
            <Link className="button button-secondary" to={ACTIVITIES_PATH}>
              Back to catalogue
            </Link>
          }
        />
        <ActivityError failure={parentResult} title="The parent entry could not be loaded." />
      </>
    )
  }

  const suggestionFailure = suggested.state === 'success' ? null : suggested

  function suggestAnother() {
    const current = code.trim()
    setAfterCode(/^[A-Z0-9]{1,5}$/.test(current) ? current : suggestedCode ?? undefined)
    setCodeEdited(false)
    setSaveError(null)
    // Also covers a failed suggestion, where the inputs are unchanged and the
    // button has to retry the same request.
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
    <>
      <PageHeading
        title={level === null ? 'Add entry' : `Create ${level}`}
      />

      <Panel title="Entry details">
        {suggestionFailure !== null && (
          <div className="panel-pad">
            <ActivityError
              failure={suggestionFailure}
              title={
                suggestionFailure.code === 'code_space_exhausted'
                  ? 'No code is available.'
                  : 'A code could not be suggested.'
              }
            />
          </div>
        )}

        <form onSubmit={save} noValidate>
          <AttributeList>
            <Attribute label="Database">{label}</Attribute>
            <Attribute label="Level">{level ?? 'Not available'}</Attribute>
            <Attribute label="Parent">
              {parent === null ? (
                'None. This creates a top-level Section.'
              ) : (
                <>
                  <span className="mono">{parent.code}</span> {parent.title} ({parent.level})
                </>
              )}
            </Attribute>
          </AttributeList>

          <div className="form-fields">
            <label className="field">
              <span className="field-label">Title</span>
              <input
                className="input"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                disabled={suggestionFailure !== null}
                autoFocus
              />
              <span className="field-hint">Up to 500 characters.</span>
            </label>

            <div className="field">
              <label className="field-label" htmlFor="activity-code">
                Code
              </label>
              <div className="field-with-action">
                <input
                  id="activity-code"
                  className="input input-mono"
                  value={code}
                  onChange={(event) => {
                    setCode(event.target.value)
                    setCodeEdited(true)
                  }}
                  disabled={suggestionFailure !== null}
                  spellCheck={false}
                  autoComplete="off"
                />
                <button
                  type="button"
                  className="button button-primary"
                  onClick={suggestAnother}
                  disabled={isSaving}
                >
                  Suggest another code
                </button>
              </div>
              <span className="field-hint">
                {level !== null && CODE_FORMAT_HINTS[level]} A free code is suggested. You can
                change it.
              </span>
            </div>
          </div>

          {saveError !== null && (
            <div className="panel-pad">
              <p className="field-warning" role="alert">
                {saveError}
              </p>
            </div>
          )}

          <div className="panel-pad panel-pad-actions">
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
              onClick={() => navigate(backPath)}
              disabled={isSaving}
            >
              Cancel
            </button>
          </div>
        </form>
      </Panel>
    </>
  )
}

export default function CreatePage() {
  const [params] = useSearchParams()
  const parentCode = params.get('parent')
  // A new key resets the form when the parent changes.
  return <CreateForm key={parentCode ?? 'section'} parentCode={parentCode} />
}
