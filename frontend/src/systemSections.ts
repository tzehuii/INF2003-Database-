/** The System view sections, in sidebar order. Shell only: no operations yet. */

export const SYSTEM_SECTIONS = [
  { slug: 'business-activities', label: 'Business Activities' },
  { slug: 'suppliers', label: 'Suppliers' },
  { slug: 'tenders-awards', label: 'Tenders & Awards' },
  { slug: 'companies-addresses', label: 'Companies & Addresses' },
] as const

export const SYSTEM_BASE_PATH = '/system'
export const DEFAULT_SYSTEM_PATH = `${SYSTEM_BASE_PATH}/${SYSTEM_SECTIONS[0].slug}`
export const DEFAULT_APPLICATION_PATH = '/companies'

export function isSystemPath(pathname: string): boolean {
  return pathname === SYSTEM_BASE_PATH || pathname.startsWith(`${SYSTEM_BASE_PATH}/`)
}
