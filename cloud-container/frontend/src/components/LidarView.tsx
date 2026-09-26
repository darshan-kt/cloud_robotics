/** The "small window" LIDAR panel (see docs/09-frontend.md) - a top-down
 * 2D plot of the robot's own `/scan`, rendered with a plain `<canvas>`
 * rather than a charting library: this is one scatter of ~360 points
 * redrawn every poll, exactly the kind of thing canvas is for, and it
 * keeps this project's "no dependency where a native API already does
 * the job" pattern (the `<video>` element for camera is the same call).
 *
 * Convention: robot-centric, forward-up - matches REP-103's frame (angle
 * 0 = the robot's own +X/forward axis, increasing counter-clockwise
 * toward +Y/left), rotated onto the canvas so "forward" reads as "up" on
 * screen, the way a driver would expect to see it while also watching the
 * camera feed and driving with the arrow keys.
 *
 * Repainted in the design-system palette: the plot lives on the same
 * `instrument` dark surface as the camera and the teleop pad, points are
 * drawn in the accent teal DESIGN.md reserves for live status readouts,
 * and the range rings carry their own distance labels so the plot is
 * readable without a legend. Renders at device pixel ratio, which the
 * previous fixed 220x220 bitmap did not - the scatter was visibly soft on
 * any HiDPI screen.
 */
import { useEffect, useRef } from 'react'
import type { LaserScan } from '../api/types'

const CANVAS_SIZE = 240
const RANGE_RING_FRACTIONS = [0.25, 0.5, 0.75, 1.0]

// Design tokens, as literals because canvas has no access to CSS classes.
const COLORS = {
  surface: '#181715', // instrument
  ring: '#252320', // instrument-elevated
  ringLabel: '#6c6a64', // muted
  point: '#5db8a6', // accent teal
  robot: '#cc785c', // coral
  empty: '#a09d96', // on-instrument-soft
}

export function LidarView({ scan }: { scan: LaserScan | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return

    const dpr = window.devicePixelRatio || 1
    canvas.width = CANVAS_SIZE * dpr
    canvas.height = CANVAS_SIZE * dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    const width = CANVAS_SIZE
    const height = CANVAS_SIZE
    const centerX = width / 2
    const centerY = height / 2

    ctx.fillStyle = COLORS.surface
    ctx.fillRect(0, 0, width, height)

    if (!scan || scan.ranges.length === 0 || !Number.isFinite(scan.range_max) || scan.range_max <= 0) {
      ctx.fillStyle = COLORS.empty
      ctx.font = '500 12px Inter, sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('Waiting for scan', centerX, centerY)
      return
    }

    const maxRange = scan.range_max
    const scale = (Math.min(width, height) / 2 - 16) / maxRange

    // Range rings, so a raw point cloud reads as "distance from robot" at
    // a glance instead of requiring a legend to interpret. The outermost
    // ring is labelled with the sensor's actual max range, which is the
    // number that tells an operator how much room they really have.
    ctx.strokeStyle = COLORS.ring
    ctx.lineWidth = 1
    for (const frac of RANGE_RING_FRACTIONS) {
      const radius = maxRange * scale * frac
      ctx.beginPath()
      ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI)
      ctx.stroke()
    }

    // One label, on the outer ring: it establishes the scale of the whole
    // plot, and a second label inside the point cloud only competes with
    // the returns it is meant to help read.
    ctx.fillStyle = COLORS.ringLabel
    ctx.font = '500 9px "JetBrains Mono", ui-monospace, monospace'
    ctx.textAlign = 'right'
    ctx.textBaseline = 'top'
    ctx.fillText(`${maxRange.toFixed(1)}m`, centerX + maxRange * scale - 3, centerY + 4)

    // The scan itself. `null` entries (see api/types.ts's LaserScan) are
    // "nothing detected within range" - skipped, not plotted at the
    // origin or at max range, either of which would misrepresent an
    // open area as a wall.
    ctx.fillStyle = COLORS.point
    for (let i = 0; i < scan.ranges.length; i++) {
      const r = scan.ranges[i]
      if (r === null || r < scan.range_min || r > scan.range_max) continue
      const angle = scan.angle_min + i * scan.angle_increment
      const forward = r * Math.cos(angle)
      const left = r * Math.sin(angle)
      const screenX = centerX - left * scale
      const screenY = centerY - forward * scale
      ctx.beginPath()
      ctx.arc(screenX, screenY, 1.4, 0, 2 * Math.PI)
      ctx.fill()
    }

    // The robot itself, as a small triangle pointing "forward" (up), in
    // the brand coral so it separates from its own returns at a glance.
    ctx.fillStyle = COLORS.robot
    ctx.beginPath()
    ctx.moveTo(centerX, centerY - 7)
    ctx.lineTo(centerX - 5, centerY + 5)
    ctx.lineTo(centerX + 5, centerY + 5)
    ctx.closePath()
    ctx.fill()
  }, [scan])

  return (
    <figure className="m-0">
      <canvas
        ref={canvasRef}
        style={{ width: CANVAS_SIZE, height: CANVAS_SIZE }}
        className="mx-auto block w-full max-w-[240px] rounded-md border border-instrument-elevated bg-instrument"
        role="img"
        aria-label={
          scan && Number.isFinite(scan.range_max)
            ? `Top-down LiDAR scan, ${scan.ranges.length} points, ${scan.range_max.toFixed(1)} metre maximum range. Forward is up.`
            : 'LiDAR scan, no data received yet.'
        }
      />
      <figcaption className="mt-3 text-center text-caption text-on-instrument-soft">Forward is up</figcaption>
    </figure>
  )
}
