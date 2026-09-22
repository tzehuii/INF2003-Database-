/**
 * Left sidebar navigation.
 *
 * Four navigation items and no Dashboard item. The active page is highlighted.
 */

import { NavLink } from 'react-router-dom'

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

export default function Sidebar() {
  return (
    <nav className="sidebar" aria-label="Main navigation">
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

      <p className="sidebar-label">Workspace</p>
      <ul className="sidebar-list">
        {NAVIGATION_ITEMS.map((item) => (
          <li key={item.to}>
            <NavLink
              to={item.to}
              className={({ isActive }) =>
                isActive ? 'sidebar-link sidebar-link-active' : 'sidebar-link'
              }
            >
              <NavigationIcon name={item.icon} />
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
