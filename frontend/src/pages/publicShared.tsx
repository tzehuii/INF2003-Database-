import type { ApiResult } from '../api/client'
export function ResourceStatus({ result, loading }: { result: ApiResult<unknown> | null; loading: boolean }) {
  if (loading) return <p className="panel-pad muted-text" role="status">Loading…</p>
  if (result && result.state !== 'success') return <p className="banner banner-warning" role="alert">{result.message}</p>
  return null
}
