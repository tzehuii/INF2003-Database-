// retain the list/map origin when a company is opened.
import type { ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
export default function CompanyLink({ uen, children, className = 'row-link' }: { uen: string; children: ReactNode; className?: string }) {
  const location = useLocation()
  return <Link className={className} to={`/companies/${encodeURIComponent(uen)}`}
    state={{ companyOrigin: { path: location.pathname, key: location.key } }}>{children}</Link>
}
