/** Subscribes to /ws/status (app/ws/status.py) for the console's live
 * fleet view. Auto-reconnects on close/error with a fixed delay - simple
 * on purpose; this is a dashboard feed, not the control path (that's
 * useTeleopSocket), so a few seconds of staleness during a reconnect is
 * fine.
 *
 * Mounted once in the app shell (components/Layout.tsx) and shared with
 * every page through the router outlet context, so the nav rail's robot
 * list and the Dashboard read the same feed over one socket rather than
 * opening one each. */
import { useEffect, useState } from 'react'
import { getWsTicket, resolveWsBaseUrl } from '../api/client'
import type { RobotSummary, StatusStreamMessage } from '../api/types'

interface UseStatusSocketResult {
  robots: RobotSummary[]
  connected: boolean
  /** True once the first push has arrived. `robots: []` on its own can't
   *  tell "still connecting" from "the fleet really is empty", which is
   *  why the empty state used to show during startup. */
  hasLoaded: boolean
}

const RECONNECT_DELAY_MS = 3000

export function useStatusSocket(token: string | null): UseStatusSocketResult {
  const [robots, setRobots] = useState<RobotSummary[]>([])
  const [connected, setConnected] = useState(false)
  const [hasLoaded, setHasLoaded] = useState(false)

  useEffect(() => {
    if (!token) return
    let cancelled = false
    let ws: WebSocket | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null

    async function connect() {
      let base: string
      let ticket: string
      try {
        ;[base, { ticket }] = await Promise.all([resolveWsBaseUrl(), getWsTicket(token as string)])
      } catch {
        // Transient failure (network blip, or the real token itself
        // expired) - same retry cadence as a dropped socket below.
        if (!cancelled) reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS)
        return
      }
      if (cancelled) return
      ws = new WebSocket(`${base}/ws/status?ticket=${encodeURIComponent(ticket)}`)

      ws.onopen = () => setConnected(true)
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as StatusStreamMessage
          setRobots(data.robots)
          setHasLoaded(true)
        } catch {
          // Malformed frame - drop it, next push arrives in ~2s anyway.
        }
      }
      ws.onclose = () => {
        setConnected(false)
        if (!cancelled) reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS)
      }
      ws.onerror = () => {
        ws?.close()
      }
    }

    connect()

    return () => {
      cancelled = true
      if (reconnectTimer) clearTimeout(reconnectTimer)
      ws?.close()
    }
  }, [token])

  return { robots, connected, hasLoaded }
}
