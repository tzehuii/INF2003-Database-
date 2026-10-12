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
    <aside className="sidebar">
      <div className="sidebar-brand">
        <span className="sidebar-brand-mark">
          <Icon name="logo" size={24} />
        </span>
        <span className="sidebar-brand-name rail-hidden">ProjectApp</span>
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
