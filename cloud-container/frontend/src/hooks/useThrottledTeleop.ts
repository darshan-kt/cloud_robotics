/** Shared throttle logic behind both teleop input methods (arrow buttons
 * and keyboard - see components/TeleopPad.tsx and useKeyboardTeleop.ts):
 * "start repeating this command at 20Hz" / "stop and send one final
 * `stop`". Centralized here so both input methods can't race each other
 * into sending commands faster than the milestone's 20Hz cap, and so a
 * key held down and a button pressed at the same time (unlikely, but not
 * impossible) share one interval rather than stacking two.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Command } from '../api/types'

// 20Hz, per the frontend README's "arrow-button + keyboard teleop
// (throttled to 20Hz)" requirement - fast enough to feel responsive,
// slow enough that it isn't just forwarding raw keydown-repeat/mousemove
// event rates (which are OS/browser dependent and often much higher)
// straight into MQTT publishes.
const SEND_INTERVAL_MS = 50

export interface ThrottledTeleop {
  activeCommand: Command | null
  start: (command: Command) => void
  stop: () => void
}

export function useThrottledTeleop(sendCommand: (command: Command) => void): ThrottledTeleop {
  const [activeCommand, setActiveCommand] = useState<Command | null>(null)
  const activeRef = useRef<Command | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const sendRef = useRef(sendCommand)
  sendRef.current = sendCommand

  const stop = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
    if (activeRef.current) {
      activeRef.current = null
      setActiveCommand(null)
      sendRef.current('stop')
    }
  }, [])

  const start = useCallback((command: Command) => {
    if (activeRef.current === command) return // already repeating this one
    activeRef.current = command
    setActiveCommand(command)
    if (intervalRef.current) clearInterval(intervalRef.current)
    sendRef.current(command) // send immediately - don't wait one tick
    intervalRef.current = setInterval(() => sendRef.current(command), SEND_INTERVAL_MS)
  }, [])

  // Unmount (e.g. navigating away from the Robot page) must not leave the
  // robot driving - stop unconditionally on cleanup.
  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
      if (activeRef.current) sendRef.current('stop')
    }
  }, [])

  return { activeCommand, start, stop }
}
