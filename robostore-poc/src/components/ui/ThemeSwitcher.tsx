import { useEffect, useRef, useState } from "react";
import { Check, Droplet, Monitor, Moon, Sun } from "lucide-react";
import { useTheme, type ThemePref } from "../../hooks/useTheme";

// ---------------------------------------------------------------------------
// Two presentations of one control, chosen by available width.
//
// From `sm` up it is a segmented radiogroup: four options is few enough that
// hiding three behind a click costs more than the 116px the row takes, and the
// active theme stays readable without opening anything.
//
// Below `sm` that row does not fit. Measured at 320px, the command bar has
// about 36px of slack once the wordmark, the E-stop and sign-out have taken
// their space — so the segmented form overflowed the bar, which is a bug this
// bar has been fixed for once already. There it collapses to a single trigger
// and a menu, which also gets to show real words instead of four icons.
// ---------------------------------------------------------------------------

const OPTIONS: Array<{ value: ThemePref; label: string; hint: string; icon: typeof Sun }> = [
  { value: "light", label: "Light", hint: "Warm cream", icon: Sun },
  { value: "dark", label: "Dark", hint: "Warm dark", icon: Moon },
  { value: "blue", label: "Blue", hint: "Cool navy", icon: Droplet },
  { value: "auto", label: "Auto", hint: "Follow system", icon: Monitor },
];

export function ThemeSwitcher() {
  const { pref, resolved, setPref } = useTheme();
  const current = OPTIONS.find((o) => o.value === pref) ?? OPTIONS[3];

  return (
    <>
      {/* Wide: segmented control */}
      <div
        role="radiogroup"
        aria-label="Colour theme"
        className="hidden flex-none items-center gap-0.5 rounded-md border border-line bg-canvas p-0.5 sm:flex"
      >
        {OPTIONS.map((opt) => {
          const Icon = opt.icon;
          const selected = pref === opt.value;
          return (
            <button
              key={opt.value}
              role="radio"
              aria-checked={selected}
              aria-label={labelFor(opt, resolved)}
              title={`${opt.label} — ${opt.hint}`}
              onClick={() => setPref(opt.value)}
              className={[
                "flex h-6 w-7 items-center justify-center rounded-sm transition-colors",
                selected ? "bg-elevated text-coral" : "text-faint hover:bg-elevated/60 hover:text-body",
              ].join(" ")}
            >
              <Icon className="h-3.5 w-3.5" />
            </button>
          );
        })}
      </div>

      {/* Narrow: trigger + menu */}
      <ThemeMenu current={current} pref={pref} resolved={resolved} setPref={setPref} />
    </>
  );
}

function labelFor(opt: (typeof OPTIONS)[number], resolved: string) {
  // "Auto" alone cannot say what it produced, so it carries the resolved
  // palette — otherwise a screen-reader user hears the preference and never
  // the outcome.
  return opt.value === "auto" ? `Auto theme, currently ${resolved}` : `${opt.label} theme`;
}

function ThemeMenu({
  current,
  pref,
  resolved,
  setPref,
}: {
  current: (typeof OPTIONS)[number];
  pref: ThemePref;
  resolved: string;
  setPref: (p: ThemePref) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const Icon = current.icon;

  // Dismiss on outside click and on Escape — a menu you can only close by
  // choosing something is a trap on a touch screen.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={wrap} className="relative flex-none sm:hidden">
      <button
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={labelFor(current, resolved)}
        onClick={() => setOpen((v) => !v)}
        className="flex h-7 w-7 items-center justify-center rounded-md border border-line bg-canvas text-coral transition-colors hover:bg-elevated"
      >
        <Icon className="h-3.5 w-3.5" />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Colour theme"
          // Fixed, not absolute: the app shell is a grid of overflow:hidden
          // regions, and an absolutely-positioned menu anchored to this
          // trigger extends left of the content column's edge, where it gets
          // clipped mid-word. Fixed escapes that clip entirely.
          className="animate-fade-in fixed right-3 top-[60px] z-50 w-48 overflow-hidden rounded-md border border-line bg-surface shadow-raise"
        >
          {OPTIONS.map((opt) => {
            const OptIcon = opt.icon;
            const selected = pref === opt.value;
            return (
              <button
                key={opt.value}
                role="menuitemradio"
                aria-checked={selected}
                onClick={() => {
                  setPref(opt.value);
                  setOpen(false);
                }}
                className={[
                  "flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors",
                  selected ? "bg-elevated text-ink" : "text-body hover:bg-elevated/60",
                ].join(" ")}
              >
                <OptIcon className={`h-3.5 w-3.5 flex-none ${selected ? "text-coral" : "text-faint"}`} />
                <span className="flex-1 font-sans text-body-sm">{opt.label}</span>
                <span className="font-sans text-caption text-faint">
                  {opt.value === "auto" ? resolved : opt.hint}
                </span>
                {selected && <Check className="h-3 w-3 flex-none text-coral" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
