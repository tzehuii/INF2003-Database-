/**
 * The Public / System view switch, shown in the sidebar under the brand.
 *
 * It changes which navigation set the sidebar shows, so it lives with the
 * navigation. The view is derived from the URL, so it is independent of the
 * selected database. Switching views returns to the last page visited in that
 * view.
 */

import { useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  DEFAULT_APPLICATION_PATH,
  DEFAULT_SYSTEM_PATH,
  isSystemPath,
} from '../systemSections'
import { Icon } from './icons'

export default function ViewSelector() {
  const location = useLocation()
  const navigate = useNavigate()
  const inSystem = isSystemPath(location.pathname)
  const lastPaths = useRef({ application: DEFAULT_APPLICATION_PATH, system: DEFAULT_SYSTEM_PATH })

  useEffect(() => {
    if (inSystem) {
      lastPaths.current.system = location.pathname
    } else {
      lastPaths.current.application = location.pathname
    }
  }, [inSystem, location.pathname])

  const options = [
    { value: 'application', label: 'Public', icon: 'globe', active: !inSystem },
    { value: 'system', label: 'System', icon: 'sliders', active: inSystem },
  ] as const

  return (
    <div className="segmented segmented-full" role="group" aria-label="Select view">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={
            option.active ? 'segmented-option segmented-option-active' : 'segmented-option'
          }
          aria-pressed={option.active}
          onClick={() => {
            if (!option.active) navigate(lastPaths.current[option.value])
          }}
        >
          <Icon name={option.icon} className="segmented-icon" />
          <span className="rail-hidden">{option.label}</span>
        </button>
      ))}
    </div>
  )
}
