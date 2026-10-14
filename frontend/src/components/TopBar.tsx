/**
 * Top bar: a breadcrumb on the left and the database switch on the right.
 *
 * A 2px stripe in the selected database's identity colour runs along the top
 * edge. It is drawn from `data-database` on the app shell, so it changes in the
 * same frame as the switch. There is no user icon, account menu, notification
 * area, or authentication control, by design.
 */

import { Fragment } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useTrailOverride } from '../breadcrumbContext'
import type { Crumb } from '../breadcrumbContext'
import { SYSTEM_BASE_PATH, SYSTEM_SECTIONS } from '../systemSections'
import DatabaseSelector from './DatabaseSelector'

const ACTIVITIES = `${SYSTEM_BASE_PATH}/business-activities`

const APPLICATION_TITLES: Record<string, string> = {
  '/companies': 'Companies',
  '/agency-awards': 'Agency Awards',
  '/industry-awards': 'Industry Awards',
  '/saved-lists': 'Saved Lists',
}

/** The trail the URL alone can describe. */
function defaultTrail(pathname: string): Crumb[] {
  const path = pathname.replace(/\/+$/, '') || '/'

  if (path in APPLICATION_TITLES) {
    return [{ label: APPLICATION_TITLES[path] }]
  }

  if (path.startsWith('/companies/')) {
    return [
      { label: 'Companies', to: '/companies' },
      { label: decodeURIComponent(path.slice('/companies/'.length)), mono: true },
    ]
  }

  if (path === ACTIVITIES) {
    return [{ label: 'Business Activities' }]
  }

  if (path.startsWith(`${ACTIVITIES}/`)) {
    const rest = decodeURIComponent(path.slice(ACTIVITIES.length + 1))
    return [
      { label: 'Business Activities', to: ACTIVITIES },
      rest === 'new' ? { label: 'New entry' } : { label: rest, mono: true },
    ]
  }

  const COMPANIES_ADDRESSES = `${SYSTEM_BASE_PATH}/companies-addresses`
  if (path.startsWith(`${COMPANIES_ADDRESSES}/`)) {
    return [
      { label: 'Companies & Addresses', to: COMPANIES_ADDRESSES },
      { label: decodeURIComponent(path.slice(COMPANIES_ADDRESSES.length + 1)), mono: true },
    ]
  }

  const section = SYSTEM_SECTIONS.find((item) => `${SYSTEM_BASE_PATH}/${item.slug}` === path)
  return [{ label: section ? section.label : 'Companies' }]
}

export default function TopBar() {
  const { pathname } = useLocation()
  const override = useTrailOverride()
  const trail = override ?? defaultTrail(pathname)

  return (
    <header className="topbar">
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <ol className="breadcrumb-list">
          {trail.map((crumb, index) => {
            const isLast = index === trail.length - 1
            const content = (
              <>
                {crumb.code && <span className="breadcrumb-code">{crumb.code}</span>}
                <span className={crumb.mono ? 'breadcrumb-code' : 'breadcrumb-label'}>
                  {crumb.label}
                </span>
              </>
            )

            return (
              <Fragment key={`${index}-${crumb.label}`}>
                {index > 0 && (
                  <li className="breadcrumb-separator" aria-hidden="true">
                    /
                  </li>
                )}
                <li
                  className={isLast ? 'breadcrumb-item breadcrumb-item-current' : 'breadcrumb-item'}
                >
                  {crumb.to && !isLast ? (
                    <Link to={crumb.to} title={crumb.title}>
                      {content}
                    </Link>
                  ) : (
                    <span aria-current={isLast ? 'page' : undefined} title={crumb.title}>
                      {content}
                    </span>
                  )}
                </li>
              </Fragment>
            )
          })}
        </ol>
      </nav>
      <DatabaseSelector />
    </header>
  )
}
