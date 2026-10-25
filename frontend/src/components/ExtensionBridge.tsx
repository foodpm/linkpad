import { useEffect, useRef } from 'react'
import { useAuth } from '../AuthContext'
import { activity, extensionTracking, getToken } from '../api'

type ExtensionBridgeProps = {
  installId: string | null
}

/**
 * Keeps account activity fresh and associates the signed-in user with the
 * extension install that opened this page. The install id stays in the URL
 * fragment, so it never appears in server access logs or referrers.
 */
export default function ExtensionBridge({ installId }: ExtensionBridgeProps) {
  const { user, loading } = useAuth()
  const lastHeartbeat = useRef(0)
  const linkedInstall = useRef('')

  useEffect(() => {
    if (loading || !user || !getToken()) return

    const heartbeat = () => {
      const now = Date.now()
      if (now - lastHeartbeat.current < 5 * 60 * 1000) return
      lastHeartbeat.current = now
      activity.heartbeat().catch(() => {})
    }
    heartbeat()

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') heartbeat()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => document.removeEventListener('visibilitychange', onVisibilityChange)
  }, [loading, user])

  useEffect(() => {
    if (loading || !user || !installId || linkedInstall.current === installId) return
    linkedInstall.current = installId
    extensionTracking.link({ install_id: installId }).catch(() => {
      linkedInstall.current = ''
    })
  }, [loading, user, installId])

  return null
}
