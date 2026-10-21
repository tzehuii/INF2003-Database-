// Shared pieces for the two pages that compare MariaDB and MongoDB side by side.
//
// Features this file covers:
// - Start, follow and cancel a background job (full consistency check or benchmark).
// - Show a job's progress while it runs.
// - Number formatting and the two databases' chart colours and labels.
//
// These pages always read both databases, so the database switch in the top bar
// does not change what they show. apiRequest still sends it; the backend ignores it.

import { useCallback, useEffect, useState } from 'react'
import { apiRequest } from '../../api/client'
import { useDatabase } from '../../databaseContext'

export type Side = 'mariadb' | 'mongodb'
export const SIDES: { key: Side; label: string }[] = [
  { key: 'mariadb', label: 'MariaDB' },
  { key: 'mongodb', label: 'MongoDB' },
]

export const BOTH_DATABASES_NOTE = 'This page always reads both databases.'

export type JobStatus = 'running' | 'completed' | 'failed' | 'cancelled'

export type Job<R> = {
  id: string
  kind: string
  status: JobStatus
  params: Record<string, unknown>
  started_at: string
  finished_at: string | null
  elapsed_seconds: number
  progress: { step: string; done: number; total: number }
  cancel_requested: boolean
  result: R | null
  error: string | null
}

const POLL_MS = 1000

/**
 * Follow the latest background job of one kind.
 *
 * Loads the latest job when the page opens, so a result survives navigating
 * away and back, and polls once a second while a job is running.
 */
export function useJob<R>(paths: { latest: string; start: string; cancel: string }) {
  const { database } = useDatabase()
  const [job, setJob] = useState<Job<R> | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    const outcome = await apiRequest<Job<R> | null>(paths.latest, database)
    setLoaded(true)
    if (outcome.state === 'success') {
      setJob(outcome.body)
      setError('')
    } else {
      setError(outcome.message)
    }
  }, [paths.latest, database])

  useEffect(() => { void refresh() }, [refresh])

  const running = job?.status === 'running'
  useEffect(() => {
    if (!running) return
    const timer = window.setTimeout(() => { void refresh() }, POLL_MS)
    return () => window.clearTimeout(timer)
  }, [job, running, refresh])

  async function start(body?: unknown) {
    setBusy(true)
    setError('')
    const outcome = await apiRequest<Job<R>>(paths.start, database, {}, { method: 'POST', body })
    setBusy(false)
    if (outcome.state === 'success') setJob(outcome.body)
    else setError(outcome.message)
  }

  async function cancel() {
    const outcome = await apiRequest<Job<R> | null>(paths.cancel, database, {}, { method: 'POST' })
    if (outcome.state === 'success') setJob(outcome.body)
    else setError(outcome.message)
  }

  return { job, loaded, error, busy, running, start, cancel, refresh }
}

/** Step text, a progress bar when the step has a known size, and the elapsed time. */
export function JobProgress({ job, onCancel }: { job: Job<unknown>; onCancel: () => void }) {
  const { step, done, total } = job.progress
  const percent = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : null
  return (
    <div className="job-progress" role="status" aria-live="polite">
      <div className="job-progress-head">
        <p className="job-progress-step">{job.cancel_requested ? 'Stopping…' : step}</p>
        <span className="job-progress-meta">
          {percent !== null && <>{formatCount(done)} of {formatCount(total)} · </>}
          {formatSeconds(job.elapsed_seconds)} elapsed
        </span>
        <button type="button" className="button button-secondary button-sm" disabled={job.cancel_requested} onClick={onCancel}>Cancel</button>
      </div>
      <div className={percent === null ? 'job-progress-track job-progress-indeterminate' : 'job-progress-track'}
        role="progressbar" aria-label="Progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent ?? undefined}>
        <span className="job-progress-fill" style={percent === null ? undefined : { width: `${percent}%` }} />
      </div>
    </div>
  )
}

const countFormat = new Intl.NumberFormat('en-SG')

export function formatCount(value: number): string {
  return countFormat.format(value)
}

export function formatSeconds(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)} s`
  const minutes = Math.floor(seconds / 60)
  return `${minutes} min ${Math.round(seconds % 60)} s`
}

/** Milliseconds with precision that suits the size: 0.37 ms, 12.4 ms, 1,234 ms. */
export function formatMs(value: number | undefined): string {
  if (value === undefined) return '—'
  if (value < 1) return `${value.toFixed(2)} ms`
  if (value < 100) return `${value.toFixed(1)} ms`
  return `${countFormat.format(Math.round(value))} ms`
}

export function formatRate(value: number): string {
  return value < 10 ? value.toFixed(1) : countFormat.format(Math.round(value))
}

export function formatTime(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString('en-SG', { dateStyle: 'medium', timeStyle: 'medium' }) : '—'
}
