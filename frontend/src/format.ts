/**
 * Small display helpers shared by the pages.
 *
 * Money, percentages, and dates keep the representations the API returns. Money
 * is a decimal string, never a JSON number, so it is formatted from the string
 * rather than parsed into a float.
 */

/** The muted marker used wherever the API has not supplied a value yet. */
export const EMPTY_VALUE = '—'

/** Format a decimal money string, for example `2480028.00` to `2,480,028.00`. */
export function formatMoney(amount: string | null | undefined): string {
  if (!amount) {
    return EMPTY_VALUE
  }

  const match = /^(-?)(\d+)(\.(\d+))?$/.exec(amount.trim())
  if (!match) {
    return amount
  }

  const [, sign, whole, , fraction] = match
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return fraction ? `${sign}${grouped}.${fraction}` : `${sign}${grouped}`
}

/** Format a percentage string, for example `24.16` to `24.16%`. */
export function formatPercent(percent: string | null | undefined): string {
  if (percent === null || percent === undefined || percent === '') {
    return EMPTY_VALUE
  }
  return `${percent}%`
}

/** Format an ISO calendar date for display. The value is never re-interpreted. */
export function formatDate(isoDate: string | null | undefined): string {
  if (!isoDate) {
    return EMPTY_VALUE
  }
  return isoDate
}

/** True when a value is missing and should render as the empty marker. */
export function isMissing(value: string | null | undefined): boolean {
  return value === null || value === undefined || value === ''
}

/** Build one line of address text from the API's address fields. */
export function formatAddressLine(
  block: string | null | undefined,
  streetName: string | null | undefined,
): string {
  const parts = [block, streetName].filter((part) => !isMissing(part))
  return parts.length > 0 ? parts.join(' ') : EMPTY_VALUE
}

/** Build the level and unit part of an address, for example `#05-12`. */
export function formatLevelAndUnit(
  levelNo: string | null | undefined,
  unitNo: string | null | undefined,
): string {
  if (isMissing(levelNo) && isMissing(unitNo)) {
    return EMPTY_VALUE
  }
  const level = levelNo ?? ''
  const unit = unitNo ?? ''
  return unit ? `${level}-${unit.replace(/^-/, '')}` : level
}

/** The saved-list review statuses the API allows, with display labels. */
export const REVIEW_STATUS_OPTIONS = [
  { value: 'to_check', label: 'To check' },
  { value: 'reviewed', label: 'Reviewed' },
] as const

/** A display label for a review status value. */
export function formatReviewStatus(status: string): string {
  const match = REVIEW_STATUS_OPTIONS.find((option) => option.value === status)
  return match ? match.label : status
}
