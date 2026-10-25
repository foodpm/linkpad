import { useEffect, useRef } from 'react'
import { activity, getToken } from '../api'
import { useAuth } from '../AuthContext'

type ActivityName = 'page_view' | 'scroll' | 'click' | 'search' | 'auth'
type Counts = Partial<Record<ActivityName, number>>

const FLUSH_INTERVAL = 5_000
const SCROLL_THROTTLE = 2_000
const SEARCH_THROTTLE = 1_500
const MAX_QUEUE = 200

function emptyCounts(): Counts {
  return { page_view: 0, scroll: 0, click: 0, search: 0, auth: 0 }
}

/**
 * Batches signed-in user interactions and sends aggregate counts. Every event
 * is also a PV; page_view is additionally tracked separately for reporting.
 */
export default function ActivityTracker() {
  const { user, loading } = useAuth()
  const pending = useRef<Counts>(emptyCounts())
  const flushTimer = useRef<number | null>(null)
  const lastScroll = useRef(0)
  const lastSearch = useRef(0)

  useEffect(() => {
    if (loading || !user || !getToken()) return

    const flush = (keepalive = false) => {
      const events = pending.current
      const total = Object.values(events).reduce((sum, n) => sum + (n || 0), 0)
      if (!total || !getToken()) return
      pending.current = emptyCounts()

      if (keepalive) {
        // Keepalive requests must stay under the browser's payload limit.
        for (const key of Object.keys(events) as ActivityName[]) {
          events[key] = Math.min(events[key] || 0, 20)
        }
        const token = getToken()
        void fetch('https://linkpad.site/api/activity/events', {
          method: 'POST',
          keepalive: true,
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ events }),
        }).catch(() => {})
      } else {
        activity.events(events).catch(() => {
          // Requeue a bounded sample so temporary network errors don't drop all activity.
          const retry = pending.current
          for (const key of Object.keys(events) as ActivityName[]) {
            retry[key] = Math.min(MAX_QUEUE, (retry[key] || 0) + (events[key] || 0))
          }
        })
      }
    }

    const add = (event: ActivityName, count = 1) => {
      const current = pending.current[event] || 0
      pending.current[event] = Math.min(MAX_QUEUE, current + count)
      if (flushTimer.current === null) {
        flushTimer.current = window.setTimeout(() => {
          flushTimer.current = null
          flush()
        }, FLUSH_INTERVAL)
      }
    }

    // A new tab/window is a page view; a tab becoming visible again is not.
    add('page_view')

    const onClick = () => add('click')
    const onScroll = () => {
      const now = Date.now()
      if (now - lastScroll.current < SCROLL_THROTTLE) return
      lastScroll.current = now
      add('scroll')
    }
    const onSearch = () => {
      const target = document.activeElement
      if (!(target instanceof HTMLInputElement) || target.type === 'password') return
      const now = Date.now()
      if (now - lastSearch.current < SEARCH_THROTTLE) return
      lastSearch.current = now
      add('search')
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') flush(true)
    }
    const onPageHide = () => flush(true)

    document.addEventListener('click', onClick, { capture: true, passive: true })
    document.addEventListener('scroll', onScroll, { capture: true, passive: true })
    document.addEventListener('input', onSearch, { capture: true, passive: true })
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('pagehide', onPageHide)

    return () => {
      document.removeEventListener('click', onClick, { capture: true })
      document.removeEventListener('scroll', onScroll, { capture: true })
      document.removeEventListener('input', onSearch, { capture: true })
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('pagehide', onPageHide)
      if (flushTimer.current !== null) window.clearTimeout(flushTimer.current)
      flushTimer.current = null
      flush(true)
    }
  }, [loading, user])

  return null
}
