/** Arrow keys / WASD → the same start/stop throttle useThrottledTeleop
 * gives the on-screen arrow buttons (components/TeleopPad.tsx). Only one
 * of {up,down,left,right} is "active" at a time, matching the robot's
 * single-command dispatcher (docs/03-mqtt-layer.md) - holding two
 * opposite keys just means whichever keydown arrived last wins, same as
 * a physical single-stick controller.
 */
import { useEffect } from 'react'
import type { Command } from '../api/types'

const KEY_TO_COMMAND: Record<string, Command> = {
  ArrowUp: 'forward',
  w: 'forward',
  W: 'forward',
  ArrowDown: 'backward',
  s: 'backward',
  S: 'backward',
  ArrowLeft: 'left',
  a: 'left',
  A: 'left',
  ArrowRight: 'right',
  d: 'right',
  D: 'right',
}

const FORM_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT'])

export function useKeyboardTeleop(start: (command: Command) => void, stop: () => void, enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return

    function onKeyDown(event: KeyboardEvent) {
      const command = KEY_TO_COMMAND[event.key]
      if (!command) return
      // Don't hijack typing in a text field (e.g. Settings page inputs).
      const target = event.target as HTMLElement | null
      if (target && FORM_TAGS.has(target.tagName)) return
      event.preventDefault()
      start(command)
    }

    function onKeyUp(event: KeyboardEvent) {
      if (!(event.key in KEY_TO_COMMAND)) return
      stop()
    }

    // Losing window focus (alt-tab, DevTools, etc.) with a key physically
    // still held down would otherwise never fire keyup - stop defensively.
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', stop)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', stop)
      stop()
    }
  }, [start, stop, enabled])
}
