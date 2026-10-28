// keep browse choices during this visit without persisting company data to disk.
import { useCallback, useContext, useEffect, useRef, useState } from 'react'
import type { Dispatch, ReactNode, SetStateAction } from 'react'
import { VisitContext } from './visitStateContext'
export function VisitStateProvider({ children }: { children: ReactNode }) {
  const memory = useRef(new Map<string, unknown>())
  return <VisitContext.Provider value={memory.current}>{children}</VisitContext.Provider>
}
export function useVisitState<T>(key: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
  const memory = useContext(VisitContext)
  if (!memory) throw new Error('VisitStateProvider is missing')
  const [value, setValue] = useState<T>(() => memory.has(key) ? memory.get(key) as T : initial)
  useEffect(() => { memory.set(key, value) }, [memory, key, value])
  const update = useCallback<Dispatch<SetStateAction<T>>>(next => setValue(next), [])
  return [value, update]
}
