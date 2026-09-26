import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";
import { Loader2 } from "lucide-react";

// Shared UI kit — every page composes from these. Don't hand-roll a button
// or a panel in a page component; add a variant here instead.
//
// What changed from the previous kit, and why:
//
// The old kit exposed a `Theme` union of eight Tailwind palette names
// ("emerald" | "blue" | "amber" | "rose" | "purple" | "pink" | "teal") and
// let any card pick one. That is a decoration API, and it cost the app its
// alarm vocabulary: once four app tiles are emerald/rose/purple/amber, a red
// fault state is just a fifth colour on a colourful page.
//
// This kit has no decorative colour input at all. `tone` accepts only the
// four semantic states from tailwind.config.ts, and most components default
// to neutral. If you want a panel to stand out, use elevation or type
// weight — the palette is reserved for telling an operator what is true.

export type Tone = "neutral" | "nominal" | "caution" | "fault" | "brand";

const TONE_TEXT: Record<Tone, string> = {
  neutral: "text-muted",
  nominal: "text-nominal",
  caution: "text-caution",
  fault: "text-fault-bright",
  brand: "text-coral",
};

const TONE_CHIP: Record<Tone, string> = {
  neutral: "border-line bg-elevated/60 text-muted",
  nominal: "border-nominal/30 bg-nominal/10 text-nominal",
  caution: "border-caution/30 bg-caution/10 text-caution",
  fault: "border-fault/40 bg-fault/10 text-fault-bright",
  brand: "border-coral/30 bg-coral/10 text-coral",
};

// ---- Panel ---------------------------------------------------------------
// The single container primitive. DESIGN.md's elevation model is
// "colour-block first, shadow rare", so depth comes from the surface ramp
// (canvas → surface → raised → elevated) plus a 1px lit top edge, not shadows.

// `title` is widened from the DOM attribute (string) to ReactNode so a panel
// heading can carry an icon or a status tag.
interface PanelProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  /** Panel heading, rendered in the header strip. */
  title?: ReactNode;
  /** Right-aligned slot in the header strip — status tags, small controls. */
  action?: ReactNode;
  /** Removes the body padding, for panels holding a canvas or a full-bleed list. */
  flush?: boolean;
  /** Lets the panel body scroll instead of growing the page. */
  scroll?: boolean;
  tone?: Tone;
  children: ReactNode;
}

export function Panel({
  title,
  action,
  flush = false,
  scroll = false,
  tone = "neutral",
  className = "",
  children,
  ...rest
}: PanelProps) {
  return (
    <div
      className={[
        "flex min-h-0 flex-col rounded-lg border bg-surface shadow-panel",
        tone === "fault" ? "border-fault/40" : "border-line",
        className,
      ].join(" ")}
      {...rest}
    >
      {(title || action) && (
        <div className="flex flex-none flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-line-soft px-md py-sm sm:px-lg">
          <h2 className="flex min-w-0 items-center gap-2 truncate font-sans text-title-sm text-body">
            {title}
          </h2>
          {action && (
            <div className="flex flex-wrap items-center gap-2 max-sm:[&:has(>:nth-child(3))]:w-full">{action}</div>
          )}
        </div>
      )}
      <div
        className={[
          "flex min-h-0 flex-1 flex-col",
          flush ? "" : "p-md sm:p-lg",
          scroll ? "scroll-region" : "",
        ].join(" ")}
      >
        {children}
      </div>
    </div>
  );
}

// ---- Chip ----------------------------------------------------------------
// DESIGN.md badge-pill / badge-coral, on the dark ramp.

export function Chip({
  tone = "neutral",
  icon,
  children,
  className = "",
}: {
  tone?: Tone;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-pill border px-2.5 py-0.5 font-sans text-label uppercase ${TONE_CHIP[tone]} ${className}`}
    >
      {icon}
      {children}
    </span>
  );
}

// ---- Button --------------------------------------------------------------

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
  loading?: boolean;
  /** Stretches to the container width. */
  block?: boolean;
}

const VARIANT: Record<ButtonVariant, string> = {
  // DESIGN.md button-primary — coral is spent here and essentially nowhere else.
  primary:
    "bg-coral text-on-coral hover:bg-coral-active active:bg-coral-active disabled:bg-elevated disabled:text-faint",
  // DESIGN.md button-secondary-on-dark
  secondary:
    "border border-line bg-elevated text-ink hover:border-faint/60 hover:bg-elevated/70 disabled:border-line-soft disabled:bg-raised disabled:text-faint",
  ghost: "text-muted hover:bg-elevated hover:text-ink disabled:bg-transparent disabled:text-faint/70",
  danger: "bg-fault text-ink hover:bg-fault-bright disabled:bg-fault/30 disabled:text-muted",
};

const BTN_SIZE: Record<ButtonSize, string> = {
  sm: "h-8 gap-1.5 px-3 text-[13px]",
  md: "h-10 gap-2 px-5 text-button",
  lg: "h-12 gap-2 px-6 text-title-sm",
};

export function Button({
  variant = "primary",
  size = "md",
  icon,
  loading = false,
  block = false,
  disabled,
  className = "",
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      disabled={disabled || loading}
      className={[
        "inline-flex flex-none items-center justify-center rounded-md font-sans font-medium",
        "transition-[color,background-color,border-color,transform] duration-150",
        "active:translate-y-px disabled:active:translate-y-0",
        "disabled:cursor-not-allowed",
        VARIANT[variant],
        BTN_SIZE[size],
        block ? "w-full" : "",
        className,
      ].join(" ")}
      {...rest}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
      {children}
    </button>
  );
}

// ---- Field ---------------------------------------------------------------
// DESIGN.md text-input, on dark. Labels are sans (not mono) — mono is
// reserved for values the robot produced.

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-2">
      <span className="font-sans text-label uppercase text-muted">
        {label}
      </span>
      {children}
      {error ? (
        <span className="font-sans text-caption text-fault-bright">{error}</span>
      ) : (
        hint && <span className="font-sans text-caption text-faint">{hint}</span>
      )}
    </label>
  );
}

/** Shared input styling — apply to any bare <input> so they can't drift. */
export const inputClass =
  "h-10 w-full rounded-md border border-line bg-canvas px-3 font-sans text-body-sm text-ink " +
  "placeholder:text-faint transition-colors hover:border-faint/50 focus:border-coral " +
  "disabled:cursor-not-allowed disabled:opacity-50";

// ---- Skeleton ------------------------------------------------------------

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-breathe rounded-md bg-elevated ${className}`} />;
}

// ---- EmptyState ----------------------------------------------------------

export function EmptyState({
  icon,
  title,
  description,
  action,
  className = "",
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-1 flex-col items-center justify-center gap-2 px-lg py-lg text-center ${className}`}
    >
      {icon && (
        <div className="lit mb-2 flex h-12 w-12 items-center justify-center rounded-lg border border-line bg-raised text-faint [&_svg]:h-5 [&_svg]:w-5">
          {icon}
        </div>
      )}
      <p className="font-sans text-title-sm text-body">{title}</p>
      {description && (
        <p className="max-w-xs text-pretty font-sans text-body-sm text-faint">{description}</p>
      )}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

// ---- SectionTitle --------------------------------------------------------
// The editorial voice from DESIGN.md: serif display for the thing you're
// looking at, sans for everything that describes it.

export function SectionTitle({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-lg">
      <div className="min-w-0">
        {eyebrow && (
          <p className="mb-2 flex items-center gap-2 font-sans text-label uppercase text-muted">
            {eyebrow}
          </p>
        )}
        <h1 className="text-balance font-display text-display-md text-ink">{title}</h1>
        {description && (
          <p className="mt-2 max-w-xl font-sans text-body-sm text-muted">{description}</p>
        )}
      </div>
      {action && <div className="flex flex-none items-center gap-2">{action}</div>}
    </div>
  );
}

// ---- KeyValue ------------------------------------------------------------
// Spec tables: sans label, mono value. Used by the Dashboard hardware panel.

export function KeyValue({
  label,
  value,
  mono = true,
}: {
  label: string;
  value: ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-lg border-b border-line-soft py-2.5 last:border-0">
      <span className="flex-none font-sans text-body-sm text-muted">{label}</span>
      <span className={`truncate text-right text-body-sm text-body ${mono ? "font-mono" : "font-sans"}`}>
        {value}
      </span>
    </div>
  );
}

export { TONE_TEXT };
