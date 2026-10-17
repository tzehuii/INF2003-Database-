/**
 * A small hook that asks an API route for its response and exposes it as React
 * state.
 *
 * Pages use it so the real backend behaviour stays visible rather than hidden.
 * A route that is not implemented yet answers with HTTP 501, so a page can show
 * that result and fall back to clearly labelled placeholder values.
 *
 * The selected database is read from context here, so a caller cannot
 * accidentally build a business request without the `database` parameter.
 */

import { useEffect, useState } from 'react'
import type { ApiRequestOptions, ApiResult, QueryValue } from './client'
import { apiRequest } from './client'
import { useDatabase } from '../databaseContext.tsx'

export type ApiResource<T> = {
  /** The request state, or null while the first request is in flight. */
  result: ApiResult<T> | null
  /** True while a request is in flight. */
  isLoading: boolean
  /** Run the request again, for example from a Search button. */
  reload: () => void
}

/**
 * Run one API request when the page mounts, and again when the selected
 * database, the request inputs, or `requestKey` change.
 *
 * `requestKey` lets a page decide when a request may start. The Companies page
 * passes the submitted filter values there, so typing in a search box does not
 * send a request until Search is pressed.
 *
 * Passing a `null` path skips the request entirely. The Companies page uses
 * that, because the API rejects a company search with no filter at all, so the
 * page waits for a filter instead of sending a request it knows the backend
 * must refuse.
 */
export function useApiResource<T>(
  path: string | null,
  query: Record<string, QueryValue> = {},
  requestKey: string = '',
  options: ApiRequestOptions = {},
  keepPreviousData = false,
): ApiResource<T> {
  const { database } = useDatabase()
  const [result, setResult] = useState<ApiResult<T> | null>(null)
  const [isLoading, setIsLoading] = useState(path !== null)
  const [reloadToken, setReloadToken] = useState(0)

  // The request inputs are compared by value rather than by object identity so
  // a new object literal on every render does not cause a request loop.
  const querySignature = JSON.stringify(query)
  const optionsSignature = JSON.stringify({
    pick: options.pick,
    method: options.method,
    body: options.body,
  })

  useEffect(() => {
    if (path === null) {
      setResult(null)
      setIsLoading(false)
      return
    }

    const controller = new AbortController()
    let isCurrent = true

    // Opt-in tables keep their current rows mounted during sorting/filter requests.
    if (!keepPreviousData) setResult(null)
    setIsLoading(true)

    apiRequest<T>(path, database, JSON.parse(querySignature), {
      ...JSON.parse(optionsSignature),
      signal: controller.signal,
    })
      .then((nextResult) => {
        if (!isCurrent) {
          return
        }
        setResult(nextResult)
        setIsLoading(false)
      })
      .catch(() => {
        // apiRequest resolves every state it is responsible for, so reaching
        // here means an unexpected frontend fault. Stop the loading state and
        // leave the last real result in place.
        if (isCurrent) {
          setIsLoading(false)
        }
      })

    return () => {
      isCurrent = false
      controller.abort()
    }
  }, [path, database, querySignature, optionsSignature, requestKey, reloadToken, keepPreviousData])

  return {
    result,
    isLoading,
    reload: () => setReloadToken((token) => token + 1),
  }
}
