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
 */
import { useEffect, useRef } from 'react'
import type { LaserScan } from '../api/types'

const CANVAS_SIZE = 220
const RANGE_RING_FRACTIONS = [0.25, 0.5, 0.75, 1.0]

export function LidarView({ scan }: { scan: LaserScan | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return

    const { width, height } = canvas
    const centerX = width / 2
    const centerY = height / 2

    ctx.fillStyle = '#0f172a' // slate-900
    ctx.fillRect(0, 0, width, height)

    if (!scan || scan.ranges.length === 0) {
      ctx.fillStyle = '#64748b' // slate-500
      ctx.font = '12px sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('No scan yet', centerX, centerY)
      return
    }

    const maxRange = scan.range_max
    const scale = (Math.min(width, height) / 2 - 14) / maxRange

    // Range rings, so a raw point cloud reads as "distance from robot" at
    // a glance instead of requiring a legend to interpret.
    ctx.strokeStyle = '#1e293b' // slate-800
    ctx.lineWidth = 1
    for (const frac of RANGE_RING_FRACTIONS) {
      ctx.beginPath()
      ctx.arc(centerX, centerY, maxRange * scale * frac, 0, 2 * Math.PI)
      ctx.stroke()
    }

    // The scan itself. `null` entries (see api/types.ts's LaserScan) are
    // "nothing detected within range" - skipped, not plotted at the
    // origin or at max range, either of which would misrepresent an
    // open area as a wall.
    ctx.fillStyle = '#38bdf8' // sky-400
    for (let i = 0; i < scan.ranges.length; i++) {
      const r = scan.ranges[i]
      if (r === null || r < scan.range_min || r > scan.range_max) continue
      const angle = scan.angle_min + i * scan.angle_increment
      const forward = r * Math.cos(angle)
      const left = r * Math.sin(angle)
      const screenX = centerX - left * scale
      const screenY = centerY - forward * scale
      ctx.beginPath()
      ctx.arc(screenX, screenY, 1.5, 0, 2 * Math.PI)
      ctx.fill()
    }

    // The robot itself, as a small triangle pointing "forward" (up).
    ctx.fillStyle = '#f8fafc' // slate-50
    ctx.beginPath()
    ctx.moveTo(centerX, centerY - 7)
    ctx.lineTo(centerX - 5, centerY + 5)
    ctx.lineTo(centerX + 5, centerY + 5)
    ctx.closePath()
    ctx.fill()
  }, [scan])

  return (
    <canvas
      ref={canvasRef}
      width={CANVAS_SIZE}
      height={CANVAS_SIZE}
      className="rounded-lg bg-slate-900 border border-slate-800 w-full max-w-[220px] mx-auto"
    />
  )
}
