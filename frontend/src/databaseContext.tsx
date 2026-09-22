/**
 * Global MariaDB / MongoDB selection.
 *
 * One database is selected at a time, the value is visible in the header on
 * every page, and the same value is passed to every business API request as the
 * `database` query parameter. Plain React context is enough for one value.
 */

import { createContext, useContext, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { DatabaseMode } from './api/client'

export type DatabaseContextValue = {
  database: DatabaseMode
  setDatabase: (database: DatabaseMode) => void
}

const DatabaseContext = createContext<DatabaseContextValue | null>(null)

/** The selector options, in the order the header shows them. */
export const DATABASE_OPTIONS: { value: DatabaseMode; label: string }[] = [
  { value: 'mariadb', label: 'MariaDB' },
  { value: 'mongodb', label: 'MongoDB' },
]

export function DatabaseProvider({ children }: { children: ReactNode }) {
  const [database, setDatabase] = useState<DatabaseMode>('mariadb')

  const value = useMemo<DatabaseContextValue>(
    () => ({ database, setDatabase }),
    [database],
  )

  return <DatabaseContext.Provider value={value}>{children}</DatabaseContext.Provider>
}

/**
 * Read the selected database.
 *
 * Throws when used outside the provider so a missing provider fails loudly
 * during development instead of silently sending the wrong database.
 */
export function useDatabase(): DatabaseContextValue {
  const value = useContext(DatabaseContext)

  if (value === null) {
    throw new Error('useDatabase must be used inside DatabaseProvider.')
  }

  return value
}
