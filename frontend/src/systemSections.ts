/**
 * The System view sections, in sidebar order. `built` is false for sections that
 * only have a placeholder page so far; the sidebar marks those as coming soon.
 */

export const SYSTEM_SECTIONS = [
  { slug: 'business-activities', label: 'Business Activities', icon: 'tree', built: true },
  { slug: 'suppliers', label: 'Suppliers', icon: 'truck', built: true },
  { slug: 'tenders-awards', label: 'Tenders & Awards', icon: 'document', built: true },
  { slug: 'companies-addresses', label: 'Companies & Addresses', icon: 'building', built: true },
  { slug: 'database-schema', label: 'Database Schema', icon: 'schema', built: true },
  { slug: 'data-consistency', label: 'Data Consistency', icon: 'compare', built: true },
  { slug: 'performance', label: 'Performance', icon: 'gauge', built: true },
] as const

export const SYSTEM_BASE_PATH = '/system'
export const DEFAULT_SYSTEM_PATH = `${SYSTEM_BASE_PATH}/${SYSTEM_SECTIONS[0].slug}`
export const DEFAULT_APPLICATION_PATH = '/companies'

/** Sections that always read MariaDB and MongoDB together, so the database switch is hidden there. */
const BOTH_DATABASE_SLUGS = new Set(['database-schema', 'data-consistency', 'performance'])

export function usesBothDatabases(pathname: string): boolean {
  const slug = pathname.replace(/\/+$/, '').slice(`${SYSTEM_BASE_PATH}/`.length).split('/')[0]
  return isSystemPath(pathname) && BOTH_DATABASE_SLUGS.has(slug)
}

export function isSystemPath(pathname: string): boolean {
  return pathname === SYSTEM_BASE_PATH || pathname.startsWith(`${SYSTEM_BASE_PATH}/`)
}
