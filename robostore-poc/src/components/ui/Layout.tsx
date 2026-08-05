import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";
import { Loader2 } from "lucide-react";

// Shared UI kit - every page composes from these. Don't hand-roll a button
// or a card in a page component; add a variant here instead.

export type Theme = "emerald" | "blue" | "amber" | "rose" | "purple" | "pink" | "teal" | "muted";

const THEME_BAR: Record<Exclude<Theme, "muted">, string> = {
  emerald: "from-emerald-400 to-emerald-600",
  blue: "from-blue-400 to-blue-600",
  amber: "from-amber-400 to-amber-600",
  rose: "from-rose-400 to-rose-600",
  purple: "from-purple-400 to-purple-600",
  pink: "from-pink-400 to-pink-600",
  teal: "from-teal-400 to-teal-600",
};

const THEME_BADGE: Record<Theme, string> = {
  emerald: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
  blue: "bg-blue-500/10 text-blue-400 border-blue-500/30",
  amber: "bg-amber-500/10 text-amber-400 border-amber-500/30",
  rose: "bg-rose-500/10 text-rose-400 border-rose-500/30",
  purple: "bg-purple-500/10 text-purple-400 border-purple-500/30",
  pink: "bg-pink-500/10 text-pink-400 border-pink-500/30",
  teal: "bg-teal-500/10 text-teal-400 border-teal-500/30",
  muted: "bg-textDim/10 text-textMuted border-textDim/30",
};

// ---- Card -----------------------------------------------------------

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  theme?: Exclude<Theme, "muted">;
  hover?: boolean;
  children: ReactNode;
}

export function Card({ theme, hover = false, className = "", children, ...rest }: CardProps) {
  return (
    <div
      className={[
        "relative overflow-hidden rounded-2xl border border-border/50 bg-surface",
        hover && "transition-transform duration-200 hover:-translate-y-1 hover:shadow-xl hover:shadow-black/30",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...rest}
    >
      {theme && (
        <div className={`absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r ${THEME_BAR[theme]}`} />
      )}
      {children}
    </div>
  );
}

// ---- Badge -----------------------------------------------------------

interface BadgeProps {
  theme?: Theme;
  children: ReactNode;
  className?: string;
}

export function Badge({ theme = "muted", children, className = "" }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 font-mono text-[11px] uppercase tracking-wide ${THEME_BADGE[theme]} ${className}`}
    >
      {children}
    </span>
  );
}

// ---- Button -----------------------------------------------------------

type ButtonVariant = "primary" | "secondary" | "outline" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
  loading?: boolean;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: "bg-accent text-background hover:bg-accent/90",
  secondary: "bg-info/90 text-background hover:bg-info",
  outline: "border border-border text-text hover:bg-card",
  ghost: "text-textMuted hover:text-text hover:bg-card",
  danger: "bg-danger text-background hover:bg-danger/90",
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: "px-3 py-1.5 text-xs",
  md: "px-4 py-2 text-sm",
  lg: "px-6 py-3 text-base",
};

export function Button({
  variant = "primary",
  size = "md",
  icon,
  loading = false,
  disabled,
  className = "",
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      disabled={disabled || loading}
      className={[
        "inline-flex items-center justify-center gap-2 rounded-lg font-mono font-medium tracking-wide",
        "transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        "disabled:cursor-not-allowed disabled:opacity-50",
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        className,
      ].join(" ")}
      {...rest}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
      {children}
    </button>
  );
}

// ---- Skeleton -----------------------------------------------------------

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-card ${className}`} />;
}

// ---- EmptyState -----------------------------------------------------------

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border/60 px-6 py-12 text-center">
      {icon && <div className="text-textDim">{icon}</div>}
      <p className="font-mono text-sm font-medium text-text">{title}</p>
      {description && <p className="max-w-sm text-sm text-textMuted">{description}</p>}
      {action}
    </div>
  );
}
