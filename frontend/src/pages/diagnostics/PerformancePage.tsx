// Performance: the same read-only workloads timed on MariaDB and MongoDB.
//
// Features this file covers:
// - Choose workloads, repetitions per test, simultaneous users and load test length.
// - Run the benchmark in the background, following progress and results as they arrive.
// - Per workload: whether both databases returned the same answers, latency and
//   throughput charts, the full numbers, and each database's query plan.
// - Download every number as CSV for the report.

import { useState } from 'react'
import type { CSSProperties, FormEvent } from 'react'
import { useApiResource } from '../../api/useApiResource'
import { ConfirmationBanner, EmptyState, InlineError, PageHeading, Panel, StatusBadge, ToggleChip } from '../../components/ui'
import { BOTH_DATABASES_NOTE, JobProgress, SIDES, formatCount, formatMs, formatRate, formatSeconds, formatTime, useJob } from './shared'
import type { Job, Side } from './shared'

const API = {
  workloads: '/api/system/performance/workloads',
  latest: '/api/system/performance/runs/latest',
  start: '/api/system/performance/runs',
  cancel: '/api/system/performance/runs/cancel',
}

type WorkloadInfo = { id: string; label: string; description: string; mariadb_method: string; mongodb_method: string }
type WorkloadsData = { items: WorkloadInfo[]; concurrency_choices: number[]; warmup_calls: number; latency_time_cap_seconds: number }

type Timing = { avg_ms?: number; p95_ms?: number; min_ms?: number; max_ms?: number }
type Latency = Timing & { first_run_ms: number; calls: number; capped: boolean }
type Throughput = Timing & { workers: number; duration_seconds: number; calls: number; errors: number; calls_per_second: number }
type Level = { workers: number } & Record<Side, Throughput>
type WorkloadResult = WorkloadInfo & {
  plans: Record<Side, string[]>
  latency: Record<Side, Latency>
  throughput: Level[]
  results_match: boolean | null
  mismatched_checks: number
  checked_calls: number
}
type Environment = {
  mariadb_version: string; mongodb_version: string; mariadb_buffer_pool_mb: number; mongodb_cache_mb: number
  mariadb_data_mb: number; mariadb_index_mb: number; mongodb_data_mb: number; mongodb_storage_mb: number; mongodb_index_mb: number
  cpu_count: number; platform: string; python_version: string; mariadb_connector_version: string; pymongo_version: string
}
type RunResult = { started_at: string; finished_at?: string; environment: Environment; workloads: WorkloadResult[] }
type RunSettings = { workloads: string[]; iterations: number; concurrency: number[]; duration_seconds: number }

const ITERATION_CHOICES = [30, 100, 200, 500]
const DURATION_CHOICES = [2, 5, 10, 20]
const DEFAULT_CONCURRENCY = [1, 4, 8]

export default function PerformancePage() {
  const info = useApiResource<WorkloadsData>(API.workloads)
  const run = useJob<RunResult>(API)
  const job = run.job
  const result = job?.result && job.result.workloads ? job.result : null

  return <>
    <PageHeading title="Performance" description={`Run the same read-only queries on MariaDB and MongoDB and compare speed and throughput. ${BOTH_DATABASES_NOTE}`}
      actions={result && result.workloads.length > 0 && job && <button type="button" className="button button-secondary" onClick={() => downloadCsv(result, job)}>Download CSV</button>} />
    {info.result?.state === 'success'
      // Re-created once the last run has loaded, so the form starts from its settings.
      ? <SettingsForm key={run.loaded ? 'loaded' : 'loading'} info={info.result.body} disabled={run.running || run.busy || !run.loaded} lastSettings={job?.params as RunSettings | undefined} onRun={settings => run.start(settings)} />
      : info.result ? <InlineError title="Could not load the workloads">{info.result.message}</InlineError> : null}
    {run.error && <InlineError title="Benchmark">{run.error}</InlineError>}
    {job?.status === 'running' && <Panel title="Running"><JobProgress job={job} onCancel={run.cancel} /></Panel>}
    {job?.status === 'failed' && <InlineError title="The benchmark stopped">{job.error}</InlineError>}
    {job?.status === 'cancelled' && <ConfirmationBanner tone="warning">The benchmark was cancelled. Workloads that finished before the cancel are shown below.</ConfirmationBanner>}
    {!job && run.loaded && !run.error && <EmptyState title="No benchmark yet" icon="gauge">Choose the workloads above and run the benchmark. Results stay available until the backend restarts; download the CSV to keep them.</EmptyState>}
    {result && job && <Results result={result} job={job} />}
  </>
}

// ----------------------------------------------------------------- settings --

function SettingsForm({ info, disabled, lastSettings, onRun }: {
  info: WorkloadsData; disabled: boolean; lastSettings?: RunSettings; onRun: (settings: RunSettings) => void
}) {
  const [workloads, setWorkloads] = useState<string[]>(lastSettings?.workloads ?? info.items.map(item => item.id))
  const [iterations, setIterations] = useState(lastSettings?.iterations ?? 100)
  const [concurrency, setConcurrency] = useState<number[]>(lastSettings?.concurrency ?? DEFAULT_CONCURRENCY)
  const [duration, setDuration] = useState(lastSettings?.duration_seconds ?? 5)

  const toggle = <T,>(list: T[], value: T) => list.includes(value) ? list.filter(item => item !== value) : [...list, value]
  const ready = workloads.length > 0 && concurrency.length > 0
  const maxMinutes = Math.ceil(workloads.length * 2 * (info.latency_time_cap_seconds + concurrency.length * duration) / 60)

  function submit(event: FormEvent) {
    event.preventDefault()
    if (ready) onRun({ workloads, iterations, concurrency: [...concurrency].sort((a, b) => a - b), duration_seconds: duration })
  }

  return (
    <Panel title="Run settings">
      <form onSubmit={submit} className="bench-form">
        <fieldset className="bench-workloads" disabled={disabled}>
          <legend className="field-label">Workloads</legend>
          {info.items.map(item => <label key={item.id} className="bench-workload">
            <input type="checkbox" checked={workloads.includes(item.id)} onChange={() => setWorkloads(list => toggle(list, item.id))} />
            <span>
              <span className="bench-workload-name">{item.label}</span>
              <span className="bench-workload-text">{item.description}</span>
            </span>
          </label>)}
        </fieldset>
        <fieldset className="bench-options" disabled={disabled}>
          <label className="field">
            <span className="field-label">Repetitions per test</span>
            <select className="input" value={iterations} onChange={event => setIterations(Number(event.target.value))}>
              {ITERATION_CHOICES.map(value => <option key={value} value={value}>{value} times per database</option>)}
            </select>
            <span className="field-hint">How many times each test runs on each database, one request after another. Gives the response times. More repetitions give steadier numbers but take longer.</span>
          </label>
          <div className="field">
            <span className="field-label" id="bench-concurrency">Simultaneous users</span>
            <div className="chip-group" role="group" aria-labelledby="bench-concurrency">
              {info.concurrency_choices.map(value => <ToggleChip key={value} pressed={concurrency.includes(value)} onClick={() => setConcurrency(list => toggle(list, value))}>{value}</ToggleChip>)}
            </div>
            <span className="field-hint">Simulates this many users sending requests at the same time, to measure how many requests per second each database handles. Pick one or more to see how each copes as load rises.</span>
          </div>
          <label className="field">
            <span className="field-label">Load test length</span>
            <select className="input" value={duration} onChange={event => setDuration(Number(event.target.value))}>
              {DURATION_CHOICES.map(value => <option key={value} value={value}>{value} seconds</option>)}
            </select>
            <span className="field-hint">How long each simultaneous-users test runs, per database.</span>
          </label>
        </fieldset>
        <div className="bench-actions">
          <button className="button button-primary" disabled={disabled || !ready}>Run benchmark</button>
          <span className="field-hint">
            {ready ? `Takes up to about ${maxMinutes} min. Each test starts with ${info.warmup_calls} untimed warm-up requests; repetitions stop early after ${info.latency_time_cap_seconds} s.`
              : 'Choose at least one workload and one number of simultaneous users.'}
          </span>
        </div>
      </form>
    </Panel>
  )
}

// ------------------------------------------------------------------ results --

function Results({ result, job }: { result: RunResult; job: Job<RunResult> }) {
  const env = result.environment
  const settings = job.params as RunSettings
  return <>
    <Panel title="Results" badge={job.status === 'running' ? <StatusBadge tone="neutral">In progress</StatusBadge> : undefined}>
      <div className="stat-band">
        <dl className="stat-strip bench-stat-strip">
          <div className="stat"><dt className="stat-label">Started</dt><dd className="stat-value bench-stat-text">{formatTime(result.started_at)}</dd></div>
          <div className="stat"><dt className="stat-label">Run time</dt><dd className="stat-value bench-stat-text">{formatSeconds(job.elapsed_seconds)}</dd></div>
          <div className="stat"><dt className="stat-label">MariaDB</dt><dd className="stat-value bench-stat-text">{env.mariadb_version}</dd></div>
          <div className="stat"><dt className="stat-label">MongoDB</dt><dd className="stat-value bench-stat-text">{env.mongodb_version}</dd></div>
        </dl>
        <p className="stat-footnote">
          {settings.iterations} repetitions per database · simultaneous users {settings.concurrency.join(', ')} · {settings.duration_seconds} s load tests · {env.cpu_count} CPU threads, {env.platform}, Python {env.python_version}
        </p>
      </div>
      <details className="diagnostics-details bench-environment">
        <summary><span>Memory and data size</span></summary>
        <table className="company-table diagnostics-table">
          <thead><tr><th>Setting</th><th className="cell-number">MariaDB</th><th className="cell-number">MongoDB</th></tr></thead>
          <tbody>
            <tr><td>Memory cache</td><td className="cell-number">{formatCount(env.mariadb_buffer_pool_mb)} MB InnoDB buffer pool</td><td className="cell-number">{formatCount(env.mongodb_cache_mb)} MB WiredTiger cache</td></tr>
            <tr><td>Data</td><td className="cell-number">{formatCount(env.mariadb_data_mb)} MB</td><td className="cell-number">{formatCount(env.mongodb_data_mb)} MB uncompressed, {formatCount(env.mongodb_storage_mb)} MB on disk</td></tr>
            <tr><td>Indexes</td><td className="cell-number">{formatCount(env.mariadb_index_mb)} MB</td><td className="cell-number">{formatCount(env.mongodb_index_mb)} MB</td></tr>
            <tr><td>Python driver</td><td className="cell-number">mariadb {env.mariadb_connector_version}</td><td className="cell-number">pymongo {env.pymongo_version}</td></tr>
          </tbody>
        </table>
      </details>
      <Legend />
    </Panel>
    {result.workloads.map(workload => <WorkloadPanel key={workload.id} workload={workload} />)}
  </>
}

function Legend() {
  return <div className="bench-legend" aria-label="Chart colours">
    {SIDES.map(side => <span key={side.key} className="bench-legend-item"><span className={`bench-swatch bench-swatch-${side.key}`} aria-hidden="true" />{side.label}</span>)}
  </div>
}

function WorkloadPanel({ workload }: { workload: WorkloadResult }) {
  const latency = workload.latency
  const levels = workload.throughput
  const match = workload.results_match
  return (
    <Panel title={workload.label} badge={match === null ? undefined : match
      ? <StatusBadge tone="success" dot>Same answers</StatusBadge>
      : <StatusBadge tone="danger" dot>Different answers</StatusBadge>}>
      <div className="bench-workload-intro">
        <p>{workload.description}</p>
        <p className="bench-methods"><strong>MariaDB:</strong> {workload.mariadb_method}<br /><strong>MongoDB:</strong> {workload.mongodb_method}</p>
        {match === false && <p className="field-warning">{workload.mismatched_checks} of {workload.checked_calls} checked requests returned different answers, so the timings are not comparable.</p>}
      </div>
      <div className="bench-charts">
        <figure className="bench-chart">
          <figcaption className="bench-chart-title">Average response time, one request at a time <span className="bench-chart-note">lower is better</span></figcaption>
          <Bars groups={[{ bars: SIDES.map(side => ({
            side: side.key, value: latency[side.key].avg_ms ?? 0, text: formatMs(latency[side.key].avg_ms),
            tip: `${side.label}: average ${formatMs(latency[side.key].avg_ms)} · p95 ${formatMs(latency[side.key].p95_ms)}\n${formatCount(latency[side.key].calls)} repetitions`,
          })) }]} />
          <p className="bench-verdict">{compare(latency.mariadb.avg_ms, latency.mongodb.avg_ms, 'lower')}</p>
        </figure>
        {levels.length > 0 && <figure className="bench-chart">
          <figcaption className="bench-chart-title">Requests handled per second <span className="bench-chart-note">higher is better</span></figcaption>
          <Bars groups={levels.map(level => ({
            label: level.workers === 1 ? '1 user' : `${level.workers} simultaneous users`,
            bars: SIDES.map(side => ({
              side: side.key, value: level[side.key].calls_per_second, text: `${formatRate(level[side.key].calls_per_second)}/s`,
              tip: `${side.label}, ${level.workers} ${level.workers === 1 ? 'user' : 'users'}: ${formatRate(level[side.key].calls_per_second)} requests/s\naverage ${formatMs(level[side.key].avg_ms)} · p95 ${formatMs(level[side.key].p95_ms)}\n${formatCount(level[side.key].calls)} requests in ${level[side.key].duration_seconds.toFixed(1)} s${level[side.key].errors ? ` · ${level[side.key].errors} errors` : ''}`,
            })),
          }))} />
          <p className="bench-verdict">{compare(levels[levels.length - 1].mariadb.calls_per_second, levels[levels.length - 1].mongodb.calls_per_second, 'higher', levels[levels.length - 1].workers)}</p>
        </figure>}
      </div>
      <details className="diagnostics-details">
        <summary><span>Numbers and query plans</span></summary>
        <div className="company-table-scroll">
          <table className="company-table diagnostics-table">
            <caption className="visually-hidden">Response time, one request at a time</caption>
            <thead><tr><th>Response time</th><th className="cell-number">First run</th><th className="cell-number">Average</th><th className="cell-number">p95</th><th className="cell-number">Min</th><th className="cell-number">Max</th><th className="cell-number">Repetitions</th></tr></thead>
            <tbody>{SIDES.map(side => {
              const row = latency[side.key]
              return <tr key={side.key}>
                <td>{side.label}</td><td className="cell-number">{formatMs(row.first_run_ms)}</td><td className="cell-number">{formatMs(row.avg_ms)}</td>
                <td className="cell-number">{formatMs(row.p95_ms)}</td>
                <td className="cell-number">{formatMs(row.min_ms)}</td><td className="cell-number">{formatMs(row.max_ms)}</td>
                <td className="cell-number">{formatCount(row.calls)}{row.capped && <span className="diagnostics-unit">stopped at time limit</span>}</td>
              </tr>
            })}</tbody>
          </table>
          {levels.length > 0 && <table className="company-table diagnostics-table">
            <caption className="visually-hidden">Requests per second by number of simultaneous users</caption>
            <thead><tr><th>Simultaneous users</th>{SIDES.map(side => <th key={side.key} className="cell-number">{side.label} requests/s</th>)}{SIDES.map(side => <th key={side.key} className="cell-number">{side.label} avg / p95</th>)}</tr></thead>
            <tbody>{levels.map(level => <tr key={level.workers}>
              <td>{level.workers}</td>
              {SIDES.map(side => <td key={side.key} className="cell-number">{formatRate(level[side.key].calls_per_second)}{level[side.key].errors > 0 && <span className="diagnostics-unit">{level[side.key].errors} errors</span>}</td>)}
              {SIDES.map(side => <td key={side.key} className="cell-number">{formatMs(level[side.key].avg_ms)} / {formatMs(level[side.key].p95_ms)}</td>)}
            </tr>)}</tbody>
          </table>}
        </div>
        <div className="bench-plans">
          {SIDES.map(side => <div key={side.key}>
            <h4 className="diagnostics-subheading">{side.label} query plan</h4>
            <ul className="bench-plan-list">{workload.plans[side.key].map((line, index) => <li key={index} className="mono">{line}</li>)}</ul>
          </div>)}
        </div>
      </details>
    </Panel>
  )
}

/** One sentence naming the better database and by how much. */
function compare(mariadb: number | undefined, mongodb: number | undefined, better: 'lower' | 'higher', workers?: number) {
  if (!mariadb || !mongodb) return ''
  const mariaWins = better === 'lower' ? mariadb < mongodb : mariadb > mongodb
  const ratio = Math.max(mariadb, mongodb) / Math.min(mariadb, mongodb)
  const at = workers ? ` with ${workers} simultaneous ${workers === 1 ? 'user' : 'users'}` : ''
  if (ratio < 1.1) return `About the same${at} (within 10%).`
  const winner = mariaWins ? 'MariaDB' : 'MongoDB'
  return better === 'lower'
    ? `${winner} responded ${ratio.toFixed(1)}× faster.`
    : `${winner} handled ${ratio.toFixed(1)}× as many requests per second${at}.`
}

// --------------------------------------------------------------------- bars --

type Bar = { side: Side; value: number; text: string; tip: string }

/**
 * Horizontal bars, one row per database, grouped when a chart has several
 * groups. Each row is labelled with its database and value, so colour is never
 * the only cue; details appear on hover and keyboard focus.
 */
function Bars({ groups }: { groups: { label?: string; bars: Bar[] }[] }) {
  const max = Math.max(...groups.flatMap(group => group.bars.map(bar => bar.value)), 0)
  return <div className="bench-bars">
    {groups.map((group, index) => <div key={group.label ?? index} className="bench-bar-group">
      {group.label && <div className="bench-bar-group-label">{group.label}</div>}
      {group.bars.map(bar => {
        const side = SIDES.find(item => item.key === bar.side)!
        const fraction = max > 0 ? Math.max(bar.value / max, 0.004) : 0
        return <div key={bar.side} className="bench-bar-row" tabIndex={0} data-tip={bar.tip} aria-label={bar.tip.replace(/\n/g, '. ')}>
          <span className="bench-bar-label">{side.label}</span>
          <span className="bench-bar-track">
            <span className={`bench-bar bench-bar-${bar.side}`} style={{ '--fraction': fraction } as CSSProperties} />
            <span className="bench-bar-value">{bar.text}</span>
          </span>
        </div>
      })}
    </div>)}
  </div>
}

// ---------------------------------------------------------------------- csv --

const CSV_COLUMNS = [
  'run_started_at', 'workload', 'database', 'test', 'simultaneous_users', 'requests', 'duration_s', 'requests_per_second',
  'first_run_ms', 'avg_ms', 'p95_ms', 'min_ms', 'max_ms', 'errors', 'stopped_at_time_limit',
  'same_answers', 'method', 'query_plan', 'mariadb_version', 'mongodb_version', 'cpu_threads',
] as const

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value)
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function downloadCsv(result: RunResult, job: Job<RunResult>) {
  const env = result.environment
  const rows: Record<(typeof CSV_COLUMNS)[number], unknown>[] = []
  for (const workload of result.workloads) {
    for (const side of SIDES) {
      const common = {
        run_started_at: result.started_at, workload: workload.label, database: side.label,
        same_answers: workload.results_match, method: side.key === 'mariadb' ? workload.mariadb_method : workload.mongodb_method,
        query_plan: workload.plans[side.key].join('; '), mariadb_version: env.mariadb_version,
        mongodb_version: env.mongodb_version, cpu_threads: env.cpu_count,
      }
      const latency = workload.latency[side.key]
      rows.push({
        ...common, test: 'response time', simultaneous_users: 1, requests: latency.calls, duration_s: '', requests_per_second: '',
        first_run_ms: latency.first_run_ms, avg_ms: latency.avg_ms, p95_ms: latency.p95_ms, min_ms: latency.min_ms, max_ms: latency.max_ms, errors: 0, stopped_at_time_limit: latency.capped,
      })
      for (const level of workload.throughput) {
        const row = level[side.key]
        rows.push({
          ...common, test: 'load', simultaneous_users: level.workers, requests: row.calls, duration_s: row.duration_seconds,
          requests_per_second: row.calls_per_second, first_run_ms: '', avg_ms: row.avg_ms,
          p95_ms: row.p95_ms, min_ms: row.min_ms, max_ms: row.max_ms, errors: row.errors,
          stopped_at_time_limit: '',
        })
      }
    }
  }
  const csv = [CSV_COLUMNS.join(','), ...rows.map(row => CSV_COLUMNS.map(column => csvCell(row[column])).join(','))].join('\r\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `benchmark-${(job.started_at || result.started_at).slice(0, 19).replace(/[:T]/g, '-')}.csv`
  document.body.append(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}
