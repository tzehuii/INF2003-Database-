// new pages start at the top; back navigation restores that history entry.
import { useLayoutEffect, useRef } from 'react'
import { useLocation, useNavigationType } from 'react-router-dom'
import { scrollRestoreKey } from '../navigationState'
export default function RouteScroll() {
  const location = useLocation()
  const kind = useNavigationType()
  const positions = useRef(new Map<string, { x: number; y: number }>())
  useLayoutEffect(() => {
    const previous = window.history.scrollRestoration
    window.history.scrollRestoration = 'manual'
    return () => { window.history.scrollRestoration = previous }
  }, [])
  useLayoutEffect(() => {
    const restoreKey = scrollRestoreKey(kind, location.key, location.state)
    const target = restoreKey ? positions.current.get(restoreKey) : undefined
    let restoring = true
    let frame = 0
    const observer = new ResizeObserver(() => { cancelAnimationFrame(frame); frame = requestAnimationFrame(restore) })
    function remember() {
      if (!restoring) positions.current.set(location.key, { x: window.scrollX, y: window.scrollY })
    }
    function finish() { restoring = false; observer.disconnect(); remember() }
    function restore() {
      if (!restoring) return
      window.scrollTo({ left: target?.x ?? 0, top: target?.y ?? 0, behavior: 'instant' })
      if (Math.abs(window.scrollY - (target?.y ?? 0)) < 2) finish()
    }
    // Wait for asynchronous page content only when restoring a previous position.
    observer.observe(document.body)
    window.addEventListener('scroll', remember, { passive: true })
    window.addEventListener('wheel', finish, { passive: true })
    window.addEventListener('touchstart', finish, { passive: true })
    window.addEventListener('pointerdown', finish)
    window.addEventListener('keydown', finish)
    restore()
    return () => {
      observer.disconnect(); cancelAnimationFrame(frame)
      window.removeEventListener('scroll', remember)
      window.removeEventListener('wheel', finish)
      window.removeEventListener('touchstart', finish)
      window.removeEventListener('pointerdown', finish)
      window.removeEventListener('keydown', finish)
    }
  }, [location.key, kind, location.state])
  return null
}
