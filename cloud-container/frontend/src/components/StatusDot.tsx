/** The colored-dot + label pattern the original Milestone 2 stub used for
 * "Backend connected/checking/disconnected" (see git history of App.tsx) -
 * pulled out here since Dashboard, Robot, and Health all need the same
 * shape for different things (robot online/offline, socket connected,
 * WebRTC negotiating). */
type Variant = 'ok' | 'warn' | 'error' | 'pending'

const DOT_CLASSES: Record<Variant, string> = {
  ok: 'bg-emerald-500',
  warn: 'bg-amber-500 animate-pulse',
  error: 'bg-red-500',
  pending: 'bg-slate-500 animate-pulse',
}

export function StatusDot({ variant, label }: { variant: Variant; label: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className={`h-2.5 w-2.5 rounded-full ${DOT_CLASSES[variant]}`} />
      <span className="text-sm font-medium">{label}</span>
    </span>
  )
}
