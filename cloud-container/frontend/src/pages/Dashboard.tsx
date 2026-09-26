/** Fleet overview - the frontend README's "Dashboard page". Live via
 * /ws/status rather than a one-shot GET /robots, so a robot going offline
 * or another operator taking a session shows up without a manual refresh.
 * The socket itself now lives in the app shell (components/Layout.tsx)
 * and arrives here through the outlet context.
 *
 * Composition note: the fleet was a flat grid of identical cards, which
 * answered "what robots exist" but not "is anything wrong right now" -
 * an operator had to read every card to find the flat battery. The
 * counters band answers that first, the filter narrows to it, and only
 * then does the grid enumerate.
 */
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { BatteryHigh, MagnifyingGlass, Robot as RobotIcon, WifiSlash } from '@phosphor-icons/react'
import { useFleet } from '../components/Layout'
import { EmptyState, Meter, PageHeader, Skeleton, StatusChip, cx, inputClass } from '../components/ui'
import type { RobotStatus, RobotSummary } from '../api/types'

const STATUS_VARIANT = { online: 'ok', unknown: 'warn', offline: 'error' } as const

type Filter = 'all' | RobotStatus

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'online', label: 'Online' },
  { value: 'offline', label: 'Offline' },
  { value: 'unknown', label: 'Unknown' },
]

export function Dashboard() {
  const { robots, connected, hasLoaded } = useFleet()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')

  const counts = useMemo(
    () => ({
      total: robots.length,
      online: robots.filter((r) => r.status === 'online').length,
      offline: robots.filter((r) => r.status === 'offline').length,
      inUse: robots.filter((r) => r.in_use_by).length,
    }),
    [robots],
  )

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return robots.filter((robot) => {
      if (filter !== 'all' && robot.status !== filter) return false
      if (!needle) return true
      return (
        robot.robot_id.toLowerCase().includes(needle) || robot.display_name.toLowerCase().includes(needle)
      )
    })
  }, [robots, query, filter])

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Fleet"
        lede={
          hasLoaded
            ? `${counts.total} robot${counts.total === 1 ? '' : 's'} known to the registry`
            : 'Subscribing to the live status feed'
        }
        actions={
          <StatusChip
            variant={connected ? 'ok' : 'pending'}
            label={connected ? 'Live feed connected' : 'Reconnecting'}
          />
        }
      />

      {/* Counters read as one instrument, not four cards. DESIGN.md's
          elevation philosophy is colour-block first, so this is a single
          hairline band divided internally rather than four boxes. */}
      {/* Colour is reserved for the one number that means someone has to
          act. A green "online" count and a coral "in use" count would
          have made all four read as alerts and none of them as news. */}
      <dl className="grid grid-cols-2 overflow-hidden rounded-lg border border-hairline bg-canvas sm:grid-cols-4">
        {[
          { label: 'Total', value: counts.total },
          { label: 'Online', value: counts.online },
          { label: 'Offline', value: counts.offline, alert: counts.offline > 0 },
          { label: 'Under control', value: counts.inUse },
        ].map(({ label, value, alert }, i) => (
          <Counter key={label} label={label} value={value} ready={hasLoaded} alert={alert} index={i} />
        ))}
      </dl>

      {hasLoaded && counts.total > 0 && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative sm:max-w-xs sm:flex-1">
            <MagnifyingGlass
              size={16}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-soft"
            />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter by name or ID"
              aria-label="Filter robots by name or ID"
              className={cx(inputClass, 'pl-9')}
            />
          </div>

          {/* DESIGN.md's category-tab / category-tab-active pair. */}
          <div role="group" aria-label="Filter by status" className="flex flex-wrap items-center gap-1">
            {FILTERS.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                onClick={() => setFilter(value)}
                aria-pressed={filter === value}
                className={cx(
                  'rounded-md px-3.5 py-2 text-nav font-medium transition-colors',
                  filter === value
                    ? 'bg-surface-card text-ink'
                    : 'text-muted hover:bg-surface-soft hover:text-body-strong',
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {!hasLoaded ? (
        <FleetSkeleton />
      ) : counts.total === 0 ? (
        <EmptyState
          icon={connected ? <RobotIcon size={24} /> : <WifiSlash size={24} />}
          title={connected ? 'No robots yet' : 'Status feed unreachable'}
          description={
            connected
              ? 'Robots register themselves. As soon as robot_agent connects to the broker and publishes its first heartbeat, it appears here.'
              : 'The console cannot reach the status stream. It retries every few seconds, so this clears on its own once the backend is back.'
          }
        />
      ) : visible.length === 0 ? (
        <EmptyState
          icon={<MagnifyingGlass size={24} />}
          title="No matches"
          description={`Nothing in the fleet matches this filter. ${counts.total} robots are registered in total.`}
        />
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((robot) => (
            <li key={robot.robot_id}>
              <RobotCard robot={robot} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Dividers are computed from the cell's index rather than `last:` and
 *  `divide-*`, both of which draw the wrong lines once the row wraps from
 *  four columns to two. */
function Counter({
  label,
  value,
  ready,
  alert,
  index,
}: {
  label: string
  value: number
  ready: boolean
  alert?: boolean
  index: number
}) {
  return (
    <div
      className={cx(
        'border-hairline px-5 py-4',
        index % 2 === 1 && 'border-l',
        index >= 2 && 'border-t',
        'sm:border-t-0',
        index > 0 && 'sm:border-l',
      )}
    >
      <dt className="text-caption-up font-medium uppercase text-muted-soft">{label}</dt>
      <dd className="mt-1.5">
        {ready ? (
          <span className={cx('font-mono tnum text-metric-lg', alert ? 'text-error' : 'text-ink')}>{value}</span>
        ) : (
          <Skeleton className="h-8 w-10" />
        )}
      </dd>
    </div>
  )
}

/** The card leads with the machine's name and its battery, because those
 *  are the two things that decide whether an operator opens it. The ID
 *  drops to a mono caption - still copyable, no longer competing. */
function RobotCard({ robot }: { robot: RobotSummary }) {
  const battery = robot.battery_percentage
  const low = battery !== null && battery <= 20

  return (
    <Link
      to={`/robots/${encodeURIComponent(robot.robot_id)}`}
      className="group flex h-full flex-col justify-between gap-6 rounded-lg border border-hairline bg-canvas p-5 transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-muted-soft hover:shadow-lift"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-title-md font-medium text-ink">{robot.display_name || robot.robot_id}</h3>
          {robot.display_name && robot.display_name !== robot.robot_id && (
            <p className="mt-1 truncate font-mono text-caption text-muted-soft">{robot.robot_id}</p>
          )}
        </div>
        <StatusChip variant={STATUS_VARIANT[robot.status]} label={robot.status} className="shrink-0" />
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex items-end justify-between gap-3">
          <div>
            <span className="flex items-center gap-1.5 text-caption-up font-medium uppercase text-muted-soft">
              <BatteryHigh size={14} />
              Battery
            </span>
            <span
              className={cx(
                'mt-1 block font-mono tnum text-metric-md',
                battery === null ? 'text-muted-soft' : low ? 'text-error' : 'text-ink',
              )}
            >
              {battery === null ? '--' : `${battery.toFixed(0)}%`}
            </span>
          </div>

          {robot.in_use_by ? (
            <span className="max-w-[10rem] truncate rounded-pill bg-coral-active px-3 py-1 text-caption font-medium text-on-coral">
              {robot.in_use_by}
            </span>
          ) : (
            <span className="text-caption text-muted-soft">Available</span>
          )}
        </div>

        <Meter value={battery} variant="auto" label={`${robot.display_name || robot.robot_id} battery level`} />
      </div>
    </Link>
  )
}

function FleetSkeleton() {
  return (
    <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <li key={i} className="rounded-lg border border-hairline bg-canvas p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1">
              <Skeleton className="h-5 w-1/2" />
              <Skeleton className="mt-2 h-3 w-1/3" />
            </div>
            <Skeleton className="h-6 w-20 rounded-pill" />
          </div>
          <Skeleton className="mt-8 h-7 w-16" />
          <Skeleton className="mt-3 h-1 w-full" />
        </li>
      ))}
    </ul>
  )
}
