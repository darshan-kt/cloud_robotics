import { useEffect } from "react";
import { Keyboard, OctagonX, ShieldCheck } from "lucide-react";
import { AppShell } from "../components/layout/AppShell";
import { EmptyState, Panel, Skeleton } from "../components/ui/Layout";
import { useToast } from "../components/ui/Toast";
import { useEmergencyStop } from "../hooks/useEmergencyStop";

// A note on the button's two labels, since the build brief this page comes
// from described them ambiguously ("armed -> STOP ENGAGED" / "active ->
// STOP RELEASED", which reads backwards from how a real physical E-stop's
// latch states are usually named): this implementation labels the button by
// its CURRENT STATE, not a call-to-action verb, because that's the
// unambiguous choice for a safety control - "what does this button say
// right now" should never require the operator to parse intent. Idle =
// "SYSTEM ARMED" (robot free to move, tap to stop it). Active = "E-STOP
// ACTIVE" (robot halted, tap to release).
//
// The state itself now lives in useEmergencyStop, shared with the command
// bar, so the stop can be engaged from any route and every surface agrees.

export function EmergencyStopPage() {
  const toast = useToast();
  const { isActive, history, loading, busy, toggle } = useEmergencyStop();

  async function handleToggle(nextActive: boolean, reason: string) {
    try {
      await toggle(nextActive, reason);
      toast.show(
        nextActive ? "error" : "success",
        nextActive ? "Emergency stop engaged." : "Emergency stop released.",
      );
    } catch {
      toast.show("error", "Failed to update emergency stop — try again.");
    }
  }

  // Global spacebar shortcut - only while this page is mounted, only
  // triggers the STOP (never the release - releasing should always be a
  // deliberate click, not a stray keypress).
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.code !== "Space") return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      event.preventDefault();
      if (!isActive) handleToggle(true, "Triggered via spacebar shortcut");
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive]);

  return (
    <AppShell title="Emergency Stop">
      <div className="mx-auto grid max-w-[1200px] lg:h-full grid-cols-1 gap-lg lg:grid-cols-[1fr_380px]">
        {/* ---- The control ---- */}
        <Panel className="animate-fade-up" tone={isActive ? "fault" : "neutral"}>
          <div className="flex flex-1 flex-col items-center justify-center gap-xl py-xl">
            <div className="text-center">
              <p className="font-sans text-label uppercase text-muted">
                Latching halt
              </p>
              <h2 className="mt-1.5 text-balance font-display text-display-md text-ink">
                {isActive ? "Robot is stopped" : "Robot is free to move"}
              </h2>
            </div>

            <button
              onClick={() =>
                handleToggle(!isActive, isActive ? "Released from console" : "Triggered from console")
              }
              disabled={busy || loading}
              aria-pressed={isActive}
              aria-label={isActive ? "Release emergency stop" : "Engage emergency stop"}
              className="group relative flex h-52 w-52 items-center justify-center rounded-pill disabled:cursor-not-allowed disabled:opacity-60"
            >
              {/* Two concentric rings, one solid one hairline. The old version
                  spun a dashed ring continuously; motion now means "stopped",
                  so only the engaged state animates. */}
              <span
                className={`absolute inset-0 rounded-pill border transition-colors ${
                  isActive ? "animate-alarm border-fault/60" : "border-line"
                }`}
              />
              <span
                className={`absolute inset-5 rounded-pill border transition-colors ${
                  isActive ? "border-fault/40" : "border-line-soft"
                }`}
              />
              <span
                className={[
                  "relative flex h-36 w-36 flex-col items-center justify-center gap-2.5 rounded-pill border-2 text-center transition-all duration-200",
                  isActive
                    ? "border-fault bg-fault/20 text-fault-bright shadow-alarm"
                    : "border-nominal/50 bg-nominal/10 text-nominal group-hover:border-nominal group-hover:bg-nominal/15",
                ].join(" ")}
              >
                {isActive ? <OctagonX className="h-8 w-8" /> : <ShieldCheck className="h-8 w-8" />}
                <span className="font-sans text-label uppercase">
                  {isActive ? "E-Stop active" : "System armed"}
                </span>
              </span>
            </button>

            <p className="max-w-xs text-center font-sans text-body-sm text-muted">
              {isActive
                ? "Press to release the latch and return control to the operator."
                : "Press to halt all motion immediately. The latch holds until released."}
            </p>

            <div className="flex items-start gap-3 rounded-md border border-line bg-raised px-md py-sm">
              <Keyboard className="mt-0.5 h-4 w-4 flex-none text-coral" />
              <p className="max-w-sm font-sans text-caption text-muted">
                Press{" "}
                <kbd className="rounded-xs border border-line bg-elevated px-1.5 py-0.5 font-mono text-[11px] text-body">
                  Space
                </kbd>{" "}
                anywhere on this page to stop instantly. Releasing always requires a deliberate
                click.
              </p>
            </div>
          </div>
        </Panel>

        {/* ---- Audit log ---- */}
        <Panel
          title="Trigger history"
          action={<span className="font-mono text-[11px] text-faint">{history.length}</span>}
          className="animate-fade-up stagger-1 min-h-0"
          scroll
        >
          {loading ? (
            <div className="flex flex-col gap-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-16 flex-none" />
              ))}
            </div>
          ) : history.length === 0 ? (
            <EmptyState
              icon={<OctagonX className="h-7 w-7" />}
              title="No events recorded"
              description="Every trigger and release is logged here with its reason and timestamp."
            />
          ) : (
            <ol className="flex flex-col gap-2">
              {history.map((entry) => (
                <li
                  key={entry.id}
                  className={`rounded-md border-l-2 border-y border-r border-line bg-raised p-sm ${
                    entry.is_active ? "border-l-fault" : "border-l-nominal"
                  }`}
                >
                  <div className="mb-1 flex items-baseline justify-between gap-2">
                    <span
                      className={`font-sans text-label uppercase ${
                        entry.is_active ? "text-fault-bright" : "text-nominal"
                      }`}
                    >
                      {entry.is_active ? "Triggered" : "Released"}
                    </span>
                    <time className="font-mono text-[11px] text-faint">
                      {new Date(entry.created_at).toLocaleTimeString()}
                    </time>
                  </div>
                  <p className="font-sans text-caption text-muted">{entry.reason}</p>
                </li>
              ))}
            </ol>
          )}
        </Panel>
      </div>
    </AppShell>
  );
}
