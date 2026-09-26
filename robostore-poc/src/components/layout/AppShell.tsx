import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { LogOut, OctagonX } from "lucide-react";
import { SECTIONS, sectionForApp } from "../../lib/appCatalog";
import { useAuth } from "../../hooks/useAuth";
import { useEmergencyStop } from "../../hooks/useEmergencyStop";
import { useGatewayHealth } from "../../hooks/useGatewayHealth";
import { SignalTag, type Provenance } from "../ui/Signal";
import { ThemeSwitcher } from "../ui/ThemeSwitcher";
import { useToast } from "../ui/Toast";

// ---------------------------------------------------------------------------
// The application shell.
//
// Two structural problems this replaces:
//
// 1. DEAD SPACE. Every page was a `min-h-screen` document-flow column inside
//    `max-w-6xl mx-auto`. At 1440x900 the content stopped around y=500 and
//    left 400px of empty background below it on all six routes. This shell is
//    a fixed-height CSS grid (`h-dvh`, rail | content) whose content region
//    scrolls internally, so a page fills the viewport it was given and the
//    chrome never scrolls away.
//
// 2. NAVIGATION BY ROUND-TRIP. The four tools were reachable only from the
//    hub, via a back arrow. An operator watching lidar on /remote-controller
//    who wanted the route planner had to go back to /store and re-enter. The
//    rail makes all four permanently one click apart — and, more importantly,
//    puts the E-STOP on screen on every route (see below).
// ---------------------------------------------------------------------------

interface AppShellProps {
  /** Page title, shown in the command bar next to the wordmark. */
  title?: string;
  /** Optional controls docked to the right of the title. */
  toolbar?: ReactNode;
  /** When true the page body gets no padding (full-bleed canvases). */
  flush?: boolean;
  children: ReactNode;
}

export function AppShell({ title, toolbar, flush = false, children }: AppShellProps) {
  const estop = useEmergencyStop();

  return (
    <div className="grid h-dvh grid-cols-[theme(spacing.rail)_1fr] overflow-hidden">
      <Rail />

      <div className="grid min-w-0 grid-rows-[theme(spacing.bar)_1fr] overflow-hidden">
        <CommandBar title={title} toolbar={toolbar} estop={estop} />

        {/* The only scrolling region in the app. */}
        <main className={`scroll-region ${flush ? "" : "p-md sm:p-lg"}`}>{children}</main>
      </div>

      {/* A stopped robot must be unmissable from any route, at any scroll
          position, without stealing pointer events from the controls the
          operator needs in order to release it. */}
      {estop.isActive && (
        <div
          aria-hidden
          className="pointer-events-none fixed inset-0 z-50 animate-alarm shadow-alarm-frame"
        />
      )}
    </div>
  );
}

// ---- Rail ----------------------------------------------------------------

function Rail() {
  const { pathname } = useLocation();

  // A section is lit when you are on its deck OR on any app inside it, so an
  // operator reading the IMU page still sees where they are. NavLink can't
  // express that on its own: /sensors/imu is not a child path of every app
  // route (/dashboard lives under "Control"), so ownership comes from the
  // catalog rather than from URL prefixes.
  const owner = sectionForApp(pathname)?.id;

  return (
    <nav
      aria-label="Sections"
      className="flex flex-col items-center gap-1 border-r border-line bg-surface py-sm"
    >
      <Link
        to="/control"
        aria-label="ROBOSTORE home"
        className="mb-sm flex h-10 w-10 items-center justify-center rounded-md text-coral transition-colors hover:bg-elevated"
      >
        <SpikeMark className="h-5 w-5" />
      </Link>

      {SECTIONS.map((section) => {
        const Icon = section.icon;
        const isActive = pathname === section.route || owner === section.id;
        return (
          <Link
            key={section.id}
            to={section.route}
            title={section.title}
            aria-current={isActive ? "page" : undefined}
            className={[
              "group relative flex h-12 w-14 flex-col items-center justify-center gap-1 rounded-md transition-colors",
              isActive ? "bg-elevated text-ink" : "text-faint hover:bg-elevated/60 hover:text-body",
            ].join(" ")}
          >
            <span
              className={`absolute left-0 h-5 w-[2px] rounded-pill bg-coral transition-opacity ${
                isActive ? "opacity-100" : "opacity-0"
              }`}
            />
            <Icon className="h-[18px] w-[18px]" />
            <span className="text-[10px] font-medium">{section.railLabel}</span>
          </Link>
        );
      })}
    </nav>
  );
}

// ---- Command bar ---------------------------------------------------------

function CommandBar({
  title,
  toolbar,
  estop,
}: {
  title?: string;
  toolbar?: ReactNode;
  estop: ReturnType<typeof useEmergencyStop>;
}) {
  const { session, signOut } = useAuth();
  const navigate = useNavigate();
  const gateway = useGatewayHealth();
  const toast = useToast();
  const clock = useClock();

  // The link tag tells the literal truth: unprobed, up (with latency), or
  // down (with how long it has been down).
  const linkState: Provenance = !gateway.probed ? "absent" : gateway.ok ? "live" : "stale";
  const linkLabel = !gateway.probed
    ? "PROBING LINK"
    : gateway.ok
      ? `LINK ${Math.round(gateway.latencyMs ?? 0)}MS`
      : "LINK DOWN";

  async function handleEstop() {
    try {
      await estop.toggle(
        !estop.isActive,
        estop.isActive ? "Released from command bar" : "Triggered from command bar",
      );
      toast.show(
        estop.isActive ? "success" : "error",
        estop.isActive ? "Emergency stop released." : "Emergency stop engaged.",
      );
    } catch {
      toast.show("error", "Failed to update emergency stop — try again.");
    }
  }

  function handleSignOut() {
    signOut();
    navigate("/login");
  }

  return (
    <header className="z-40 flex min-w-0 items-center justify-between gap-sm border-b border-line bg-surface px-md sm:gap-lg sm:px-lg">
      <div className="flex min-w-0 items-center gap-sm">
        <span className="font-sans text-title-sm font-medium tracking-[-0.2px] text-ink">
          Robo<span className="text-coral">store</span>
        </span>
        {title && (
          <>
            <span className="hidden h-4 w-px flex-none bg-line sm:block" />
            <h1 className="hidden truncate font-sans text-nav text-body sm:block">{title}</h1>
          </>
        )}
      </div>

      <div className="flex flex-none items-center gap-sm sm:gap-lg">
        {toolbar}

        <div className="hidden items-center gap-lg lg:flex">
          <SignalTag state={linkState} label={linkLabel} age={gateway.lastOkAt} />
          <span className="font-mono text-[11px] tracking-[1px] text-faint">{clock} UTC</span>
        </div>

        <ThemeSwitcher />

        {/* The global stop. Present on every route, always in the same place. */}
        <button
          onClick={handleEstop}
          disabled={estop.busy || estop.loading}
          aria-pressed={estop.isActive}
          className={[
            "flex h-8 items-center gap-2 rounded-md border px-3 font-sans text-[12px] font-medium uppercase tracking-[1px] transition-[color,background-color,border-color,transform] active:translate-y-px disabled:opacity-40",
            estop.isActive
              ? "border-fault bg-fault text-ink hover:bg-fault-bright"
              : "border-fault/40 text-fault-bright hover:border-fault hover:bg-fault/10",
          ].join(" ")}
        >
          <OctagonX className={`h-3.5 w-3.5 ${estop.isActive ? "animate-alarm" : ""}`} />
          {estop.isActive ? "Release" : "E-Stop"}
        </button>

        {session && (
          <div className="flex items-center gap-sm">
            <span className="hidden font-sans text-caption text-faint xl:inline">{session.email}</span>
            <button
              onClick={handleSignOut}
              aria-label="Sign out"
              className="flex h-8 w-8 items-center justify-center rounded-md text-faint transition-colors hover:bg-elevated hover:text-ink"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
    </header>
  );
}

// ---- bits ----------------------------------------------------------------

function useClock(): string {
  const [time, setTime] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setTime(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return time.toISOString().slice(11, 19);
}

/** DESIGN.md's 4-spoke radial spike mark, used as the brand glyph. */
export function SpikeMark({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden fill="currentColor">
      {[0, 45, 90, 135].map((angle) => (
        <rect
          key={angle}
          x="11.1"
          y="1.5"
          width="1.8"
          height="21"
          rx="0.9"
          transform={`rotate(${angle} 12 12)`}
        />
      ))}
    </svg>
  );
}
