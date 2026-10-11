/**
 * The global MariaDB / MongoDB switch, shown in the top bar on every page.
 *
 * Each option carries a dot in that database's identity colour. The visible text
 * label stays, so colour is never the only signal.
 */

import { DATABASE_OPTIONS, useDatabase } from '../databaseContext.tsx'

export default function DatabaseSelector() {
  const { database, setDatabase } = useDatabase()

  return (
    <div className="segmented" role="group" aria-label="Select database">
      {DATABASE_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          className={
            database === option.value
              ? 'segmented-option segmented-option-active'
              : 'segmented-option'
          }
          aria-pressed={database === option.value}
          onClick={() => setDatabase(option.value)}
        >
          <span className={`db-dot db-dot-${option.value}`} aria-hidden="true" />
          {option.label}
        </button>
      ))}
    </div>
  )
}
