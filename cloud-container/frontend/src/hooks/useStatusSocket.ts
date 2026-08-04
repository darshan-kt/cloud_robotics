/** Subscribes to /ws/status (app/ws/status.py) for the Dashboard's live
 * fleet view. Auto-reconnects on close/error with a fixed delay - simple
 * on purpose; this is a dashboard feed, not the control path (that's
 * useTeleopSocket), so a few seconds of staleness during a reconnect is
 * fine. */
import { useEffect, useState } from 'react'
import { resolveWsBaseUrl } from '../api/client'
import type { RobotSummary, StatusStreamMessage } from '../api/types'

interface UseStatusSocketResult {
  robots: RobotSummary[]
  connected: boolean
}

const RECONNECT_DELAY_MS = 3000

export function useStatusSocket(token: string | null): UseStatusSocketResult {
  const [robots, setRobots] = useState<RobotSummary[]>([])
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    if (!token) return
    let cancelled = false
    let ws: WebSocket | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null

    async function connect() {
      const base = await resolveWsBaseUrl()
      if (cancelled) return
      ws = new WebSocket(`${base}/ws/status?token=${encodeURIComponent(token as string)}`)

      ws.onopen = () => setConnected(true)
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as StatusStreamMessage
          setRobots(data.robots)
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

  return { robots, connected }
}
