// keep the shared context identity separate from hot-reloaded page/hook code.
import { createContext } from 'react'
export const VisitContext = createContext<Map<string, unknown> | null>(null)
