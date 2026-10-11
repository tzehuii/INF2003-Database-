/**
 * Left sidebar navigation.
 *
 * Four navigation items and no Dashboard item. The active page is highlighted.
 */

import { NavLink, useLocation } from 'react-router-dom'
import { SYSTEM_BASE_PATH, SYSTEM_SECTIONS, isSystemPath } from '../systemSections'

function NavigationIcon({ name }: { name: 'companies' | 'agency' | 'industry' | 'saved' }) {
  const common = {
    fill: 'none',
    stroke: 'currentColor',
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    strokeWidth: 1.8,
  }

  if (name === 'companies') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" {...common}>
        <path d="M4 21V8l8-4 8 4v13" />
        <path d="M8 21v-4h8v4M8 10h1M12 10h1M16 10h1M8 14h1M12 14h1M16 14h1" />
      </svg>
    )
  }

  if (name === 'agency') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" {...common}>
        <path d="M12 3 3 8h18l-9-5ZM5 10v7M9 10v7M15 10v7M19 10v7M3 21h18M4 17h16" />
      </svg>
    )
  }

  if (name === 'industry') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" {...common}>
        <path d="M5 20v-6M10 20V9M15 20V5M20 20V2" />
      </svg>
    )
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...common}>
      <path d="M6 4.5A1.5 1.5 0 0 1 7.5 3h9A1.5 1.5 0 0 1 18 4.5V21l-6-3-6 3V4.5Z" />
    </svg>
  )
}

const NAVIGATION_ITEMS = [
  { to: '/companies', label: 'Companies', icon: 'companies' },
  { to: '/agency-awards', label: 'Agency Awards', icon: 'agency' },
  { to: '/industry-awards', label: 'Industry Awards', icon: 'industry' },
  { to: '/saved-lists', label: 'Saved Lists', icon: 'saved' },
] as const

function SystemIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.8}
    >
      <ellipse cx="12" cy="6" rx="7" ry="3" />
      <path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6" />
    </svg>
  )
}

export default function Sidebar() {
  const { pathname } = useLocation()
  const inSystem = isSystemPath(pathname)
  const items = inSystem
    ? SYSTEM_SECTIONS.map((section) => ({
        to: `${SYSTEM_BASE_PATH}/${section.slug}`,
        label: section.label,
        icon: null,
      }))
    : NAVIGATION_ITEMS

  return (
    <nav className="sidebar" aria-label={inSystem ? 'System navigation' : 'Main navigation'}>
      <div className="sidebar-brand">
        <span className="sidebar-brand-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="m4 10 8-5 8 5M5 19h14M7 11v6M11 11v6M15 11v6M19 11v6" />
          </svg>
        </span>
        <span className="sidebar-brand-copy">
          <strong>ProjectApp</strong>
          <small>Business intelligence</small>
        </span>
      </div>

      <p className="sidebar-label">{inSystem ? 'System' : 'Workspace'}</p>
      <ul className="sidebar-list">
        {items.map((item) => (
          <li key={item.to}>
            <NavLink
              to={item.to}
              className={({ isActive }) =>
                isActive ? 'sidebar-link sidebar-link-active' : 'sidebar-link'
              }
            >
              {item.icon ? <NavigationIcon name={item.icon} /> : <SystemIcon />}
              <span>{item.label}</span>
            </NavLink>
          </li>
        ))}
      </ul>

      <div className="sidebar-foot">
        <strong>Comparison mode</strong>
        <span>Switch databases at any time. Each request runs against one database only.</span>
      </div>
    </nav>
  )
}
