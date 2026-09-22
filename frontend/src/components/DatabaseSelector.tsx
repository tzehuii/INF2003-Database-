/** The global MariaDB / MongoDB selector shown in the header on every page. */

import { DATABASE_OPTIONS, useDatabase } from '../databaseContext.tsx'

export default function DatabaseSelector() {
  const { database, setDatabase } = useDatabase()

  return (
    <div className="database-selector" role="group" aria-label="Select database">
      <span className="database-selector-label">Database</span>
      <div className="database-selector-options">
        {DATABASE_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            className={
              database === option.value
                ? 'database-selector-option database-selector-option-active'
                : 'database-selector-option'
            }
            aria-pressed={database === option.value}
            onClick={() => setDatabase(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  )
}
