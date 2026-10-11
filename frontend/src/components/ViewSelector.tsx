/**
 * The Application / System view toggle shown in the header.
 *
 * The view is derived from the URL, so it is independent of the selected
 * database. Switching views returns to the last page visited in that view.
 */

import { useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  DEFAULT_APPLICATION_PATH,
  DEFAULT_SYSTEM_PATH,
  isSystemPath,
} from '../systemSections'

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
    { value: 'application', label: 'Public', active: !inSystem },
    { value: 'system', label: 'System', active: inSystem },
  ] as const

  return (
    <div className="database-selector" role="group" aria-label="Select view">
      <span className="database-selector-label">View</span>
      <div className="database-selector-options">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            className={
              option.active
                ? 'database-selector-option database-selector-option-active'
                : 'database-selector-option'
            }
            aria-pressed={option.active}
            onClick={() => {
              if (!option.active) navigate(lastPaths.current[option.value])
            }}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  )
}
