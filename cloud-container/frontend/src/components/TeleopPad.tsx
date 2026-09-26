/** The on-screen half of "arrow-button + keyboard teleop" (frontend
 * README). Press-and-hold semantics (mouse AND touch) drive the same
 * start/stop throttle useKeyboardTeleop uses (see hooks/useThrottledTeleop.ts)
 * so a held button and a held key behave identically - continuous
 * commands at 20Hz until released, then one `stop`.
 *
 * Sits on the dark `instrument` surface with the camera and LiDAR, since
 * it is a control an operator touches while driving rather than console
 * chrome. Keys grew from 48px to 56px: this is a press-and-hold target
 * that gets used on a touchscreen, so it clears the 44px minimum with
 * room rather than sitting on it.
 */
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp } from '@phosphor-icons/react'
import type { Command } from '../api/types'
import { cx } from './ui'

interface TeleopPadProps {
  activeCommand: Command | null
  onStart: (command: Command) => void
  onStop: () => void
  disabled: boolean
}

interface ArrowSpec {
  command: Command
  Icon: typeof ArrowUp
  label: string
  gridArea: string
  /** The key legend an operator reads to learn the mapping without
   *  hunting for the hint line underneath. */
  keys: string
}

const ARROWS: ArrowSpec[] = [
  { command: 'forward', Icon: ArrowUp, label: 'Forward', gridArea: 'up', keys: 'W' },
  { command: 'left', Icon: ArrowLeft, label: 'Turn left', gridArea: 'left', keys: 'A' },
  { command: 'backward', Icon: ArrowDown, label: 'Backward', gridArea: 'down', keys: 'S' },
  { command: 'right', Icon: ArrowRight, label: 'Turn right', gridArea: 'right', keys: 'D' },
]

export function TeleopPad({ activeCommand, onStart, onStop, disabled }: TeleopPadProps) {
  return (
    <div className="flex flex-col items-center gap-4">
      <div
        className="grid gap-2"
        style={{ gridTemplateAreas: '". up ." "left . right" ". down ."', gridTemplateColumns: 'repeat(3, 3.5rem)' }}
        role="group"
        aria-label="Directional control"
      >
        {ARROWS.map(({ command, Icon, label, gridArea, keys }) => {
          const active = activeCommand === command
          return (
            <button
              key={command}
              type="button"
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
              className={cx(
                'relative flex h-14 w-14 select-none touch-none items-center justify-center rounded-md border',
                'transition-[background-color,border-color,transform] duration-100',
                'disabled:cursor-not-allowed disabled:opacity-35',
                active
                  ? 'scale-[0.96] border-coral-active bg-coral-active text-on-coral'
                  : 'border-instrument-elevated bg-instrument-elevated text-on-instrument enabled:hover:border-on-instrument-soft enabled:active:scale-[0.96]',
              )}
              aria-label={label}
              aria-pressed={active}
            >
              <Icon size={22} weight="bold" />
              <span
                aria-hidden="true"
                className={cx(
                  'absolute bottom-1 right-1.5 font-mono text-[10px] leading-none',
                  active ? 'text-on-coral' : 'text-on-instrument-soft',
                )}
              >
                {keys}
              </span>
            </button>
          )
        })}

        {/* The centre cell confirms commands are actually streaming while
            a key is held, so an operator's eyes never leave the control.
            At rest it stays empty rather than labelling the absence. */}
        <span
          style={{ gridArea: '2 / 2 / 3 / 3' }}
          className="flex items-center justify-center font-mono text-[10px] tracking-[0.5px] text-coral"
          aria-hidden="true"
        >
          {activeCommand ? '20Hz' : ''}
        </span>
      </div>

      <p className="text-center text-caption text-on-instrument-soft">
        Hold a key or a button. Arrow keys and WASD both work while this page has focus.
      </p>
    </div>
  )
}
