/** Fleet overview - the frontend README's "Dashboard page". Live via
 * /ws/status (useStatusSocket) rather than a one-shot GET /robots, so a
 * robot going offline or another operator taking a session shows up
 * without a manual refresh. */
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { StatusDot } from '../components/StatusDot'
import { useStatusSocket } from '../hooks/useStatusSocket'
import type { RobotStatus } from '../api/types'

const STATUS_VARIANT: Record<RobotStatus, 'ok' | 'warn' | 'error'> = {
  online: 'ok',
  unknown: 'warn',
  offline: 'error',
}

export function Dashboard() {
  const { token } = useAuth()
  const { robots, connected } = useStatusSocket(token)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Fleet</h1>
          <p className="text-slate-400 text-sm mt-1">
            {robots.length} robot{robots.length === 1 ? '' : 's'} known
          </p>
        </div>
        <StatusDot
          variant={connected ? 'ok' : 'warn'}
          label={connected ? 'Live status feed connected' : 'Reconnecting…'}
        />
      </div>

      {robots.length === 0 ? (
        <div className="border border-dashed border-slate-800 rounded-xl p-10 text-center text-slate-500">
          No robots have reported in yet. Once robot_agent connects and publishes its first status/heartbeat, it
          appears here automatically.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {robots.map((robot) => (
            <Link
              key={robot.robot_id}
              to={`/robots/${encodeURIComponent(robot.robot_id)}`}
              className="block bg-slate-900 border border-slate-800 rounded-xl p-5 hover:border-slate-700 transition-colors"
            >
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-medium">{robot.display_name || robot.robot_id}</h2>
                <StatusDot variant={STATUS_VARIANT[robot.status]} label={robot.status} />
              </div>
              <dl className="text-sm text-slate-400 space-y-1">
                <div className="flex justify-between">
                  <dt>Robot ID</dt>
                  <dd className="text-slate-200 font-mono text-xs">{robot.robot_id}</dd>
                </div>
                <div className="flex justify-between">
                  <dt>Battery</dt>
                  <dd className="text-slate-200">
                    {robot.battery_percentage !== null ? `${robot.battery_percentage.toFixed(0)}%` : '—'}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt>In use</dt>
                  <dd className="text-slate-200">{robot.in_use_by ?? '—'}</dd>
                </div>
              </dl>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
