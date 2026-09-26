/**
 * The console's primitive layer, mapped 1:1 onto DESIGN.md's `components:`
 * block. Before this existed every page hand-rolled its own panel
 * (`bg-slate-900 border border-slate-800 rounded-xl p-5`, repeated eleven
 * times), which is why nothing could be restyled and why loading and
 * error states were skipped - there was no shared place to put them.
 *
 * Two surface modes, and the rule between them is fixed: cream is
 * console chrome, `instrument` dark is a live robot surface (camera,
 * LiDAR, teleop). Panels take a `tone` rather than letting each page
 * pick colours, so the split can't drift.
 */
import type { ComponentPropsWithoutRef, ElementType, ReactNode } from 'react'

export type Tone = 'cream' | 'instrument'

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

/* ------------------------------------------------------------------ */
/* Panel - DESIGN.md `feature-card` (cream) / `product-mockup-card-dark` */
/* ------------------------------------------------------------------ */

interface PanelProps {
  tone?: Tone
  /** Large stage containers (the camera) take the 16px radius; every
   *  other panel takes 12px. See DESIGN.md's radius hierarchy. */
  stage?: boolean
  className?: string
  children: ReactNode
}

export function Panel({ tone = 'cream', stage = false, className, children }: PanelProps) {
  return (
    <section
      className={cx(
        stage ? 'rounded-xl' : 'rounded-lg',
        tone === 'cream'
          ? 'border border-hairline bg-canvas'
          : 'on-instrument border border-instrument-elevated bg-instrument text-on-instrument',
        className,
      )}
    >
      {children}
    </section>
  )
}

/** Panel header. `aside` carries the panel's own live readout (point
 *  count, connection state) so it reads at a glance without a second row. */
export function PanelHeader({
  title,
  aside,
  tone = 'cream',
  className,
}: {
  title: ReactNode
  aside?: ReactNode
  tone?: Tone
  className?: string
}) {
  return (
    <div
      className={cx(
        'flex items-center justify-between gap-3 border-b px-5 py-3',
        tone === 'cream' ? 'border-hairline-soft' : 'border-instrument-elevated',
        className,
      )}
    >
      <h2
        className={cx(
          'text-caption-up font-medium uppercase',
          tone === 'cream' ? 'text-muted' : 'text-on-instrument-soft',
        )}
      >
        {title}
      </h2>
      {aside}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Buttons - DESIGN.md `button-primary` / `-secondary` / `-on-dark`      */
/* ------------------------------------------------------------------ */

type ButtonVariant = 'primary' | 'secondary' | 'instrument' | 'ghost' | 'danger'
type ButtonSize = 'sm' | 'md' | 'lg'

const BUTTON_BASE =
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium ' +
  'transition-[background-color,border-color,color,transform] duration-150 ' +
  'active:translate-y-px disabled:pointer-events-none disabled:opacity-55'

/**
 * The coral rule, and why there are two of them.
 *
 * DESIGN.md's `button-primary` is white 14px on `{colors.primary}`
 * (#cc785c). That pair measures 3.28:1, which is under the 4.5:1 WCAG AA
 * needs for text at this size - so the token as written cannot be used
 * for a label. Rather than invent a colour, this splits DESIGN.md's own
 * coral pair by contrast duty:
 *
 *   `coral` (#cc785c)         non-text roles only - the brand mark, the
 *                             focus ring, the LiDAR marker, small state
 *                             icons. All clear the 3:1 graphics
 *                             threshold. Also safe for text on the dark
 *                             instrument surface, where it reads 5.47:1.
 *   `coral-active` (#a9583e)  anything carrying white text, and any
 *                             coral text on cream. 5.06:1 and 4.80:1.
 *
 * The brand voltage is unchanged; the half of the pair that carries
 * words is the darker one.
 */
const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-coral-active text-on-coral hover:bg-[#8f4934]',
  secondary: 'border border-hairline bg-canvas text-ink hover:bg-surface-card',
  instrument: 'border border-instrument-elevated bg-instrument-elevated text-on-instrument hover:bg-[#332f2b]',
  ghost: 'text-body hover:bg-surface-card hover:text-ink',
  // Emergency stop only. Coral is the CTA colour and error red is the
  // stop colour; they are never adjacent at the same size, so the two
  // warm tones can't be mistaken for each other under pressure.
  danger: 'bg-error text-white hover:bg-[#a83a3a] uppercase tracking-[1.2px]',
}

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-caption',
  md: 'h-10 px-5 text-button',
  lg: 'h-12 px-6 text-title-sm',
}

interface ButtonProps extends ComponentPropsWithoutRef<'button'> {
  variant?: ButtonVariant
  size?: ButtonSize
}

export function Button({ variant = 'secondary', size = 'md', className, ...rest }: ButtonProps) {
  return <button className={cx(BUTTON_BASE, BUTTON_VARIANTS[variant], BUTTON_SIZES[size], className)} {...rest} />
}

/* ------------------------------------------------------------------ */
/* Status - DESIGN.md `badge-pill`, semantic colours                   */
/* ------------------------------------------------------------------ */

export type StatusVariant = 'ok' | 'warn' | 'error' | 'pending' | 'idle'

const STATUS_DOT: Record<StatusVariant, string> = {
  ok: 'bg-success',
  warn: 'bg-warning',
  error: 'bg-error',
  pending: 'bg-teal motion-safe:animate-breathe',
  idle: 'bg-muted-soft',
}

const STATUS_TEXT_CREAM: Record<StatusVariant, string> = {
  ok: 'text-body-strong',
  warn: 'text-body-strong',
  error: 'text-error',
  pending: 'text-muted',
  idle: 'text-muted',
}

/** A dot alone is decoration; a dot plus its label is state. Every use in
 *  this app is real robot/transport state, never ornament, and the colour
 *  is always redundant with the text for colour-blind operators. */
export function StatusChip({
  variant,
  label,
  tone = 'cream',
  className,
}: {
  variant: StatusVariant
  label: string
  tone?: Tone
  className?: string
}) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-2 rounded-pill border px-2.5 py-1 text-caption font-medium',
        tone === 'cream'
          ? cx('border-hairline bg-surface-soft', STATUS_TEXT_CREAM[variant])
          : 'border-instrument-elevated bg-instrument-soft text-on-instrument',
        className,
      )}
    >
      <span className={cx('h-1.5 w-1.5 shrink-0 rounded-pill', STATUS_DOT[variant])} />
      {label}
    </span>
  )
}

/* ------------------------------------------------------------------ */
/* Metric - the token DESIGN.md's marketing scope didn't need          */
/* ------------------------------------------------------------------ */

/** Live readings are the whole point of this console, so they get display
 *  weight instead of the 14px `<dd>` they used to share with their own
 *  labels. Mono + tabular figures keep the digits from reflowing as
 *  telemetry polls. `value === null` renders the instrumentation
 *  convention for "no reading" rather than an em dash. */
export function Metric({
  label,
  value,
  unit,
  size = 'md',
  tone = 'cream',
  className,
}: {
  label: string
  value: string | number | null | undefined
  unit?: string
  size?: 'sm' | 'md' | 'lg'
  tone?: Tone
  className?: string
}) {
  const missing = value === null || value === undefined || value === ''
  const sizeClass = size === 'lg' ? 'text-metric-lg' : size === 'md' ? 'text-metric-md' : 'text-metric-sm'

  return (
    <div className={cx('min-w-0', className)}>
      <div
        className={cx(
          'text-caption-up font-medium uppercase',
          tone === 'cream' ? 'text-muted-soft' : 'text-on-instrument-soft',
        )}
      >
        {label}
      </div>
      <div
        className={cx(
          'mt-1.5 flex items-baseline gap-1 font-mono tnum',
          sizeClass,
          missing ? (tone === 'cream' ? 'text-muted-soft' : 'text-on-instrument-soft') : '',
          !missing && tone === 'cream' ? 'text-ink' : '',
          !missing && tone === 'instrument' ? 'text-on-instrument' : '',
        )}
      >
        <span className="truncate">{missing ? '--' : value}</span>
        {unit && !missing && (
          <span className={cx('text-caption font-sans', tone === 'cream' ? 'text-muted' : 'text-on-instrument-soft')}>
            {unit}
          </span>
        )}
      </div>
    </div>
  )
}

/** Label/value row for dense reference data that isn't a live reading. */
export function DataRow({
  label,
  value,
  mono = false,
  tone = 'cream',
}: {
  label: string
  value: ReactNode
  mono?: boolean
  tone?: Tone
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <dt className={cx('text-body-sm', tone === 'cream' ? 'text-muted' : 'text-on-instrument-soft')}>{label}</dt>
      <dd
        className={cx(
          'min-w-0 truncate text-right',
          mono ? 'font-mono tnum text-caption' : 'text-body-sm font-medium',
          tone === 'cream' ? 'text-ink' : 'text-on-instrument',
        )}
      >
        {value}
      </dd>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Meter - real physical quantity, not a decorative score bar          */
/* ------------------------------------------------------------------ */

export function Meter({
  value,
  variant = 'neutral',
  className,
  label,
}: {
  /** 0-100, or null when there is no reading. */
  value: number | null
  variant?: 'neutral' | 'auto'
  className?: string
  label: string
}) {
  const pct = value === null ? 0 : Math.max(0, Math.min(100, value))
  // Battery and load are the only meters here; both are "low is bad" or
  // "high is bad" quantities where an operator needs the threshold read
  // for them, not a decorative gradient.
  const fill =
    variant === 'neutral' ? 'bg-ink/45' : pct <= 15 ? 'bg-error' : pct <= 35 ? 'bg-warning' : 'bg-success'

  return (
    <div
      className={cx('h-1 w-full overflow-hidden rounded-pill bg-hairline', className)}
      role="meter"
      aria-label={label}
      aria-valuenow={value ?? undefined}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuetext={value === null ? 'no reading' : `${Math.round(pct)} percent`}
    >
      <div className={cx('h-full rounded-pill transition-[width] duration-500', fill)} style={{ width: `${pct}%` }} />
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Loading / empty / error - the three states the old build had none of */
/* ------------------------------------------------------------------ */

/** Skeletons take the shape of the content that replaces them, so the
 *  layout doesn't jump when data lands. */
export function Skeleton({ className, tone = 'cream' }: { className?: string; tone?: Tone }) {
  return (
    <div
      className={cx(
        'motion-safe:animate-breathe rounded-sm',
        tone === 'cream' ? 'bg-hairline' : 'bg-instrument-elevated',
        className,
      )}
      aria-hidden="true"
    />
  )
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode
  title: string
  description: string
  action?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cx(
        'flex flex-col items-center rounded-lg border border-dashed border-hairline bg-surface-soft/60 px-6 py-14 text-center',
        className,
      )}
    >
      {icon && (
        <span className="mb-5 flex h-12 w-12 items-center justify-center rounded-pill bg-surface-card text-muted">
          {icon}
        </span>
      )}
      <h3 className="font-display text-display-sm text-ink">{title}</h3>
      <p className="mt-2 max-w-[52ch] text-body-sm text-muted">{description}</p>
      {action && <div className="mt-6">{action}</div>}
    </div>
  )
}

/** Inline, contextual, and always announced. Errors here mean an operator
 *  has lost sight of a machine, so they never render as a bare sentence. */
export function ErrorNote({
  children,
  className,
  action,
}: {
  children: ReactNode
  className?: string
  action?: ReactNode
}) {
  return (
    <div
      role="alert"
      className={cx(
        'flex flex-wrap items-center justify-between gap-3 rounded-md border border-error/35 bg-error/[0.07] px-4 py-3',
        className,
      )}
    >
      <p className="text-body-sm text-[#8f3232]">{children}</p>
      {action}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Page header - one composition for every route                       */
/* ------------------------------------------------------------------ */

/** DESIGN.md's editorial voice lives here and only here: the serif
 *  display face names the page, and everything below it is sans. Serif
 *  never touches a data surface, where legibility beats voice. */
export function PageHeader({
  eyebrow,
  title,
  lede,
  actions,
  as: Heading = 'h1',
  className,
}: {
  eyebrow?: ReactNode
  title: ReactNode
  lede?: ReactNode
  actions?: ReactNode
  as?: ElementType
  className?: string
}) {
  return (
    <header className={cx('flex flex-wrap items-end justify-between gap-x-8 gap-y-4', className)}>
      <div className="min-w-0">
        {eyebrow}
        <Heading className="mt-1 font-display text-display-md text-ink">{title}</Heading>
        {lede && <p className="mt-1.5 text-body-sm text-muted">{lede}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-3">{actions}</div>}
    </header>
  )
}

/* ------------------------------------------------------------------ */
/* Form field - DESIGN.md `text-input`, label above, error below       */
/* ------------------------------------------------------------------ */

export function Field({
  label,
  hint,
  error,
  id,
  children,
}: {
  label: string
  hint?: string
  error?: string
  id: string
  children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-caption font-medium text-body-strong">
        {label}
      </label>
      {children}
      {hint && !error && (
        <p id={`${id}-hint`} className="text-caption text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="text-caption font-medium text-error">
          {error}
        </p>
      )}
    </div>
  )
}

export const inputClass =
  'h-10 w-full rounded-md border border-hairline bg-canvas px-3.5 text-body-md text-ink ' +
  'placeholder:text-muted-soft transition-colors focus:border-coral focus:outline-none ' +
  'focus-visible:ring-2 focus-visible:ring-coral/25 focus-visible:ring-offset-0'
