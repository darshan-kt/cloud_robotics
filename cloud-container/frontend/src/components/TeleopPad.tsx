/** The on-screen half of "arrow-button + keyboard teleop" (frontend
 * README). Press-and-hold semantics (mouse AND touch) drive the same
 * start/stop throttle useKeyboardTeleop uses (see hooks/useThrottledTeleop.ts)
 * so a held button and a held key behave identically - continuous
 * commands at 20Hz until released, then one `stop`.
 */
import type { Command } from '../api/types'

interface TeleopPadProps {
  activeCommand: Command | null
  onStart: (command: Command) => void
  onStop: () => void
  disabled: boolean
}

interface ArrowSpec {
  command: Command
  label: string
  gridArea: string
}

const ARROWS: ArrowSpec[] = [
  { command: 'forward', label: '↑', gridArea: 'up' },
  { command: 'left', label: '←', gridArea: 'left' },
  { command: 'backward', label: '↓', gridArea: 'down' },
  { command: 'right', label: '→', gridArea: 'right' },
]

export function TeleopPad({ activeCommand, onStart, onStop, disabled }: TeleopPadProps) {
  return (
    <div className="flex flex-col items-center gap-4">
      <div
        className="grid gap-2 w-40"
        style={{ gridTemplateAreas: '". up ." "left . right" ". down ."', gridTemplateColumns: 'repeat(3, 1fr)' }}
      >
        {ARROWS.map(({ command, label, gridArea }) => (
          <button
            key={command}
            style={{ gridArea }}
            disabled={disabled}
            // Pointer events cover both mouse and touch in one handler;
            // pointerleave/pointerup both must stop, otherwise dragging
            // off the button while held would leave the robot driving.
            onPointerDown={(e) => {
              e.preventDefault()
              onStart(command)
            }}
            onPointerUp={onStop}
            onPointerLeave={onStop}
            onContextMenu={(e) => e.preventDefault()}
            className={`h-12 w-12 rounded-lg border text-lg font-semibold select-none transition-colors ${
              activeCommand === command
                ? 'bg-sky-500 border-sky-400 text-white'
                : 'bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700'
            } disabled:opacity-40 disabled:cursor-not-allowed`}
            aria-label={command}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="text-xs text-slate-500">Arrow keys / WASD also work while this page is focused.</p>
    </div>
  )
}
