// allow only known in-app origins for the company detail return button.
const ORIGINS: Record<string, string> = {
  '/companies': 'Back to companies', '/company-map': 'Back to map',
  '/saved-lists': 'Back to saved companies', '/agency-awards': 'Back to agency awards',
}
export function companyReturnTarget(state: unknown) {
  const origin = (state as { companyOrigin?: { path?: unknown; key?: unknown } } | null)?.companyOrigin
  const path = typeof origin?.path === 'string' && ORIGINS[origin.path] ? origin.path : '/companies'
  return { path, label: ORIGINS[path], scrollKey: path === origin?.path && typeof origin?.key === 'string' ? origin.key : undefined }
}
export function scrollRestoreKey(kind: string, key: string, state: unknown): string | undefined {
  const requested = (state as { restoreScrollKey?: unknown } | null)?.restoreScrollKey
  return typeof requested === 'string' ? requested : kind === 'POP' ? key : undefined
}
