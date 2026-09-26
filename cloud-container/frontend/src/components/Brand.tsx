/** The console wordmark. DESIGN.md anchors its wordmark on the Anthropic
 * spike-mark, which is a brand asset belonging to a different product, so
 * this uses the same idea (a small geometric glyph prefixing the
 * wordmark) with a mark that means something here: a robot at the centre
 * of its own scan field, which is literally what the LiDAR panel draws.
 * Two circles and two ticks - no illustration. */
export function BrandMark({ className = 'h-6 w-6' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="10.25" fill="none" stroke="currentColor" strokeWidth="1.25" opacity="0.28" />
      <circle cx="12" cy="12" r="5.75" fill="none" stroke="currentColor" strokeWidth="1.25" opacity="0.55" />
      <circle cx="12" cy="12" r="2.25" fill="currentColor" />
      <path d="M12 1.75v3.1M22.25 12h-3.1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

/** `stacked` is the login page's larger lockup; the default inline lockup
 *  is what the nav rail carries. */
export function Wordmark({ stacked = false }: { stacked?: boolean }) {
  return (
    <span className={stacked ? 'flex flex-col gap-3' : 'flex items-center gap-2.5'}>
      <BrandMark className={stacked ? 'h-9 w-9 text-coral' : 'h-6 w-6 text-coral'} />
      <span className="flex flex-col leading-none">
        <span className={stacked ? 'font-display text-display-sm text-ink' : 'font-display text-title-lg text-ink'}>
          Cloud Robotics
        </span>
        <span className="mt-1 text-caption-up font-medium uppercase text-muted-soft">Operator console</span>
      </span>
    </span>
  )
}
