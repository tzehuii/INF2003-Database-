// Data Consistency: do MariaDB and MongoDB hold the same data?
//
// Features this file covers:
// - Record counts from both databases, loaded when the page opens (a few seconds).
// - The full field-by-field check, run in the background with progress, then a
//   summary per kind of record and example records for every difference found.

import { useApiResource } from '../../api/useApiResource'
import { ConfirmationBanner, EmptyState, InlineError, PageHeading, Panel, PanelNotes, SkeletonRows, StatusBadge } from '../../components/ui'
import { BOTH_DATABASES_NOTE, JobProgress, formatCount, formatSeconds, formatTime, useJob } from './shared'

const API = {
  summary: '/api/system/consistency/summary',
  latest: '/api/system/consistency/checks/latest',
  start: '/api/system/consistency/checks',
  cancel: '/api/system/consistency/checks/cancel',
}

type SummaryItem = { key: string; label: string; mariadb: number; mongodb: number; match: boolean }
type Summary = { items: SummaryItem[]; mariadb_ms: number; mongodb_ms: number; checked_at: string }

type Example = { key: string; mariadb?: string | null; mongodb?: string | null; detail?: string | null }
type Difference = { field: string; kind: string; count: number; examples: Example[] }
type Area = {
  key: string
  label: string
  mariadb_count: number
  mongodb_count: number
  compared: number
  compared_unit: string
  only_in_mariadb: { count: number; examples: Example[] }
  only_in_mongodb: { count: number; examples: Example[] }
  differences: Difference[]
  difference_count: number
}
type CheckResult = { areas: Area[]; difference_count: number; duration_seconds: number }

export default function ConsistencyPage() {
  return <>
    <PageHeading title="Data Consistency" description={`Check that MariaDB and MongoDB hold the same data. ${BOTH_DATABASES_NOTE}`} />
    <RecordCounts />
    <FullCheck />
  </>
}

function MatchBadge({ match }: { match: boolean }) {
  return match ? <StatusBadge tone="success" dot>Match</StatusBadge> : <StatusBadge tone="warning" dot>Differs</StatusBadge>
}

function RecordCounts() {
  const resource = useApiResource<Summary>(API.summary)
  const result = resource.result
  const data = result?.state === 'success' ? result.body : null
  const mismatches = data?.items.filter(item => !item.match).length ?? 0

  return (
    <Panel title="Record counts" badge={data && <MatchBadge match={mismatches === 0} />}
      actions={<button type="button" className="button button-secondary button-sm" disabled={resource.isLoading} onClick={resource.reload}>{resource.isLoading ? 'Counting…' : 'Count again'}</button>}>
      {result && result.state !== 'success'
        ? <div className="diagnostics-error"><InlineError title="Could not count records" action={<button className="button button-secondary" onClick={resource.reload}>Retry</button>}>{result.message}</InlineError></div>
        : !data ? <SkeletonRows count={6} label="Counting records in both databases" />
        : <div className="company-table-scroll" aria-busy={resource.isLoading}>
          <table className="company-table diagnostics-table">
            <thead><tr><th>Data</th><th className="cell-number">MariaDB</th><th className="cell-number">MongoDB</th><th className="cell-number">Difference</th><th>Status</th></tr></thead>
            <tbody>{data.items.map(item => <tr key={item.key}>
              <td>{item.label}</td>
              <td className="cell-number">{formatCount(item.mariadb)}</td>
              <td className="cell-number">{formatCount(item.mongodb)}</td>
              <td className="cell-number">{item.match ? '—' : signed(item.mongodb - item.mariadb)}</td>
              <td><MatchBadge match={item.match} /></td>
            </tr>)}</tbody>
          </table>
        </div>}
      <PanelNotes>
        {data && <p>Counted {formatTime(data.checked_at)} in {formatSeconds(Math.max(data.mariadb_ms, data.mongodb_ms) / 1000)} (MariaDB {formatCount(data.mariadb_ms)} ms, MongoDB {formatCount(data.mongodb_ms)} ms, run in parallel). Difference is MongoDB minus MariaDB.</p>}
        <p>Addresses, former names and industry links are stored inside each MongoDB company document, so counting them means reading every company. The full check below compares them.</p>
      </PanelNotes>
    </Panel>
  )
}

function signed(value: number) {
  return `${value > 0 ? '+' : ''}${formatCount(value)}`
}

function FullCheck() {
  const check = useJob<CheckResult>(API)
  const job = check.job
  const result = job?.status === 'completed' ? job.result : null

  return (
    <Panel title="Full check"
      actions={<button type="button" className="button button-primary button-sm" disabled={check.running || check.busy || !check.loaded} onClick={() => check.start()}>
        {result ? 'Run again' : 'Run full check'}
      </button>}>
      <p className="diagnostics-intro">Compares every field of every record: all 2.1 million companies with their addresses, former names and industry links, plus industries, tenders, awards and supplier links. It reads both databases in UEN order and takes about two minutes. Nothing is changed.</p>
      {check.error && <div className="diagnostics-error"><InlineError title="Full check">{check.error}</InlineError></div>}
      {job?.status === 'running' && <JobProgress job={job} onCancel={check.cancel} />}
      {job?.status === 'failed' && <div className="diagnostics-error"><InlineError title="The full check stopped">{job.error}</InlineError></div>}
      {job?.status === 'cancelled' && <ConfirmationBanner tone="warning">The full check was cancelled after {formatSeconds(job.elapsed_seconds)}. No result was kept.</ConfirmationBanner>}
      {!job && check.loaded && !check.error && <EmptyState title="No full check yet" icon="compare">No full check has run since the backend started. Results stay available until it restarts.</EmptyState>}
      {result && job && <CheckResults result={result} finishedAt={job.finished_at} />}
    </Panel>
  )
}

function CheckResults({ result, finishedAt }: { result: CheckResult; finishedAt: string | null }) {
  const withDifferences = result.areas.filter(area => area.difference_count > 0)
  return <>
    {result.difference_count === 0
      ? <ConfirmationBanner>No differences. Every field of every record matches in both databases.</ConfirmationBanner>
      : <ConfirmationBanner tone="warning">{formatCount(result.difference_count)} {result.difference_count === 1 ? 'difference' : 'differences'} found in {withDifferences.length} of {result.areas.length} kinds of record. Examples are listed below the table.</ConfirmationBanner>}
    <div className="company-table-scroll">
      <table className="company-table diagnostics-table">
        <thead><tr>
          <th>Data</th><th className="cell-number">MariaDB</th><th className="cell-number">MongoDB</th><th className="cell-number">Compared</th>
          <th className="cell-number">Only in MariaDB</th><th className="cell-number">Only in MongoDB</th><th className="cell-number">Field differences</th><th>Status</th>
        </tr></thead>
        <tbody>{result.areas.map(area => {
          const fieldDifferences = area.differences.reduce((sum, item) => sum + item.count, 0)
          return <tr key={area.key}>
            <td>{area.label}</td>
            <td className="cell-number">{formatCount(area.mariadb_count)}</td>
            <td className="cell-number">{formatCount(area.mongodb_count)}</td>
            <td className="cell-number" title={`Number of ${area.compared_unit} present in both and compared field by field`}>{formatCount(area.compared)}<span className="diagnostics-unit">{area.compared_unit}</span></td>
            <td className="cell-number">{formatCount(area.only_in_mariadb.count)}</td>
            <td className="cell-number">{formatCount(area.only_in_mongodb.count)}</td>
            <td className="cell-number">{formatCount(fieldDifferences)}</td>
            <td><MatchBadge match={area.difference_count === 0} /></td>
          </tr>
        })}</tbody>
      </table>
    </div>
    {withDifferences.map(area => <AreaDifferences key={area.key} area={area} />)}
    <PanelNotes>
      <p>Finished {formatTime(finishedAt)} in {formatSeconds(result.duration_seconds)}. Up to five example records are kept for each kind of difference.</p>
      <p>Text is compared exactly. "Letter case only" and "whitespace only" mark values that differ just in capitals or spaces; MariaDB's default collation treats those as equal, MongoDB does not.</p>
    </PanelNotes>
  </>
}

function AreaDifferences({ area }: { area: Area }) {
  const groups: { title: string; count: number; examples: Example[]; only?: boolean }[] = [
    ...(area.only_in_mariadb.count ? [{ title: 'Only in MariaDB', count: area.only_in_mariadb.count, examples: area.only_in_mariadb.examples, only: true }] : []),
    ...(area.only_in_mongodb.count ? [{ title: 'Only in MongoDB', count: area.only_in_mongodb.count, examples: area.only_in_mongodb.examples, only: true }] : []),
    ...area.differences.map(item => ({ title: `${capitalise(item.field)}: ${item.kind}`, count: item.count, examples: item.examples })),
  ]
  return (
    <section className="diagnostics-differences" aria-label={`${area.label} differences`}>
      <h3 className="diagnostics-subheading">{area.label}</h3>
      {groups.map(group => <details key={group.title} className="diagnostics-details">
        <summary><span>{group.title}</span><span className="diagnostics-count">{formatCount(group.count)}</span></summary>
        <table className="company-table diagnostics-table diagnostics-examples">
          <thead><tr><th>Record</th>{group.only ? <th>Description</th> : <><th>MariaDB</th><th>MongoDB</th></>}</tr></thead>
          <tbody>{group.examples.map((example, index) => <tr key={`${example.key}-${index}`}>
            <td className="mono">{example.key}</td>
            {group.only ? <td><Value value={example.detail} /></td> : <><td><Value value={example.mariadb} /></td><td><Value value={example.mongodb} /></td></>}
          </tr>)}</tbody>
        </table>
        {group.count > group.examples.length && <p className="diagnostics-more">Showing {group.examples.length} of {formatCount(group.count)}.</p>}
      </details>)}
    </section>
  )
}

function Value({ value }: { value: string | null | undefined }) {
  return value === null || value === undefined || value === '' ? <span className="empty-value">(empty)</span> : <span className="diagnostics-value">{value}</span>
}

function capitalise(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1)
}
