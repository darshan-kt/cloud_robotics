/** Drives /ws/teleop/{robot_id} (app/ws/teleop.py). Connecting acquires
 * the control session server-side; a clean unmount closes the socket,
 * which releases it - see that file's docstring for the full
 * acquire/renew/release lifecycle this mirrors. Deliberately does NOT
 * auto-reconnect on close/error: losing the teleop socket means losing
 * the control session, and silently re-acquiring behind the operator's
 * back would be surprising - better to surface "closed"/"error" and let
 * the Robot page's UI make re-acquiring an explicit action.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { resolveWsBaseUrl } from '../api/client'
import type { Command, TeleopServerMessage } from '../api/types'

export type TeleopConnectionState = 'idle' | 'connecting' | 'connected' | 'error' | 'closed'

interface UseTeleopSocketResult {
  state: TeleopConnectionState
  error: string | null
  sendCommand: (command: Command) => void
}

export function useTeleopSocket(token: string | null, robotId: string | null, enabled: boolean): UseTeleopSocketResult {
  const [state, setState] = useState<TeleopConnectionState>('idle')
  const [error, setError] = useState<string | null>(null)
  const wsRef = useRef<WebSocket | null>(null)

  useEffect(() => {
    if (!token || !robotId || !enabled) {
      setState('idle')
      return
    }

    let cancelled = false
    let ws: WebSocket | null = null
    setState('connecting')
    setError(null)

    ;(async () => {
      const base = await resolveWsBaseUrl()
      if (cancelled) return
      ws = new WebSocket(
        `${base}/ws/teleop/${encodeURIComponent(robotId)}?token=${encodeURIComponent(token)}`,
      )
      wsRef.current = ws

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as TeleopServerMessage
          if ('error' in data) {
            setError(data.error)
          } else if (data.status === 'session_acquired') {
            setState('connected')
            setError(null)
          }
          // 'sent' acks don't drive separate UI state - the teleop
          // controls already update optimistically on press.
        } catch {
          // Malformed frame - ignore.
        }
      }
      ws.onclose = () => {
        if (!cancelled) setState('closed')
      }
      ws.onerror = () => {
        if (!cancelled) setState('error')
      }
    })()

    return () => {
      cancelled = true
      ws?.close()
      wsRef.current = null
    }
  }, [token, robotId, enabled])

  const sendCommand = useCallback((command: Command) => {
    const ws = wsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ command }))
    }
  }, [])

  return { state, error, sendCommand }
}
