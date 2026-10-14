/**
 * Left sidebar: brand, the Public / System view switch, and the navigation for
 * the active view. The active page is highlighted.
 *
 * At narrow widths the sidebar becomes an icon rail. The text labels stay in the
 * DOM and are only hidden visually, so every item keeps its accessible name.
 */

import { NavLink, useLocation } from 'react-router-dom'
import { SYSTEM_BASE_PATH, SYSTEM_SECTIONS, isSystemPath } from '../systemSections'
import { Icon } from './icons'
import type { IconName } from './icons'
import ViewSelector from './ViewSelector'

type NavItem = { to: string; label: string; icon: IconName; soon: boolean }

const NAVIGATION_ITEMS: NavItem[] = [
  { to: '/companies', label: 'Companies', icon: 'companies', soon: false },
  { to: '/agency-awards', label: 'Agency Awards', icon: 'agency', soon: false },
  { to: '/industry-awards', label: 'Industry Awards', icon: 'industry', soon: false },
  { to: '/saved-lists', label: 'Saved Lists', icon: 'saved', soon: false },
]

/** BTA logo: three rising bars read as both a skyline (business) and a chart (analytics). */
function BrandMark() {
  return (
    <svg width="28" height="28" viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="7" fill="#233d80" />
      <rect x="7" y="17" width="4.5" height="8" rx="1" fill="#fff" />
      <rect x="13.75" y="12" width="4.5" height="13" rx="1" fill="#fff" />
      <rect x="20.5" y="7" width="4.5" height="18" rx="1" fill="#9db4ff" />
    </svg>
  )
}

export default function Sidebar() {
  const { pathname } = useLocation()
  const inSystem = isSystemPath(pathname)
  const items: NavItem[] = inSystem
    ? SYSTEM_SECTIONS.map((section) => ({
        to: `${SYSTEM_BASE_PATH}/${section.slug}`,
        label: section.label,
        icon: section.icon,
        soon: !section.built,
      }))
    : NAVIGATION_ITEMS

  return (
    <aside className="sidebar" aria-label="Business and Tender Analytics">
      <div className="sidebar-brand">
        <span className="sidebar-brand-mark">
          <BrandMark />
        </span>
        <span className="sidebar-brand-text rail-hidden">
          <span className="sidebar-brand-name">BTA</span>
          <span className="sidebar-brand-full">Business &amp; Tender Analytics</span>
        </span>
      </div>

      <ViewSelector />

      <nav aria-label={inSystem ? 'System navigation' : 'Main navigation'}>
        <p className="sidebar-group-label rail-hidden">{inSystem ? 'System' : 'Workspace'}</p>
        <ul className="sidebar-list">
          {items.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                className={({ isActive }) =>
                  isActive ? 'sidebar-link sidebar-link-active' : 'sidebar-link'
                }
              >
                <Icon name={item.icon} />
                <span className="sidebar-link-label rail-hidden">{item.label}</span>
                {item.soon && <span className="sidebar-soon rail-hidden">Soon</span>}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </aside>
  )
}
