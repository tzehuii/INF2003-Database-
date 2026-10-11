/**
 * Breadcrumb trail shown in the top bar.
 *
 * The top bar derives a default trail from the URL. A page that knows more than
 * the URL does, such as the ancestors of a catalogue entry, replaces that trail
 * while it is mounted. Display only: nothing here changes routing or data.
 */

import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

export type Crumb = {
  /** Visible text. */
  label: string
  /** Optional identifier shown in monospace before the label. */
  code?: string
  /** True when the label itself is an identifier, such as a UEN. */
  mono?: boolean
  /** Target for an ancestor. The current page has no target. */
  to?: string
  /** Full, untruncated text for the tooltip when `label` is shortened. */
  title?: string
}

const TrailContext = createContext<Crumb[] | null>(null)
const SetTrailContext = createContext<(trail: Crumb[] | null) => void>(() => {})

export function BreadcrumbProvider({ children }: { children: ReactNode }) {
  const [trail, setTrail] = useState<Crumb[] | null>(null)
  const setter = useMemo(() => setTrail, [])

  return (
    <SetTrailContext.Provider value={setter}>
      <TrailContext.Provider value={trail}>{children}</TrailContext.Provider>
    </SetTrailContext.Provider>
  )
}

/** The trail a page has registered, or null when the URL default applies. */
export function useTrailOverride(): Crumb[] | null {
  return useContext(TrailContext)
}

/** Register a trail for the lifetime of the calling page. Pass null for the default. */
export function useBreadcrumbTrail(trail: Crumb[] | null): void {
  const setTrail = useContext(SetTrailContext)
  // Compared by value so a new array on every render does not loop.
  const signature = JSON.stringify(trail)

  useEffect(() => {
    setTrail(JSON.parse(signature) as Crumb[] | null)
    return () => setTrail(null)
  }, [signature, setTrail])
}

/** Shorten long titles for the top bar. The full text goes in the tooltip. */
export function truncateText(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text
}
