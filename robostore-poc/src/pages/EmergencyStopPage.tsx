import { useCallback, useEffect, useState } from "react";
import { Keyboard, OctagonX, ShieldCheck } from "lucide-react";
import { Header } from "../components/layout/Header";
import { Card, EmptyState, Skeleton } from "../components/ui/Layout";
import { useToast } from "../components/ui/Toast";
import * as localDb from "../lib/localDb";
import type { EmergencyStop } from "../types";

// A note on the button's two labels, since the build brief this page comes
// from described them ambiguously ("armed -> STOP ENGAGED" / "active ->
// STOP RELEASED", which reads backwards from how a real physical E-stop's
// latch states are usually named): this implementation labels the button by
// its CURRENT STATE, not a call-to-action verb, because that's the
// unambiguous choice for a safety control - "what does this button say
// right now" should never require the operator to parse intent. Idle =
// "SYSTEM ARMED" (robot free to move, tap to stop it). Active = "E-STOP
// ACTIVE" (robot halted, tap to release).

export function EmergencyStopPage() {
  const toast = useToast();
  const [robotId, setRobotId] = useState<string | null>(null);
  const [isActive, setIsActive] = useState(false);
  const [history, setHistory] = useState<EmergencyStop[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [busy, setBusy] = useState(false);

  const refreshHistory = useCallback(async () => {
    const stops = await localDb.getEmergencyStops(10);
    setHistory(stops);
    setIsActive(stops[0]?.is_active ?? false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const robot = await localDb.getRobot();
        if (cancelled) return;
        setRobotId(robot.id);
        await refreshHistory();
      } finally {
        if (!cancelled) setLoadingHistory(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [refreshHistory]);

  useEffect(() => {
    return localDb.onEmergencyStopUpdated((entry) => {
      setIsActive(entry.is_active);
      setHistory((h) => [entry, ...h].slice(0, 10));
    });
  }, []);

  const toggleStop = useCallback(
    async (nextActive: boolean, reason: string) => {
      if (!robotId || busy) return;
      setBusy(true);
      const previous = isActive;
      setIsActive(nextActive); // optimistic
      try {
        await localDb.triggerEmergencyStop(robotId, nextActive, reason);
        toast.show(nextActive ? "error" : "success", nextActive ? "Emergency stop engaged." : "Emergency stop released.");
      } catch {
        setIsActive(previous); // revert
        toast.show("error", "Failed to update emergency stop - try again.");
      } finally {
        setBusy(false);
      }
    },
    [robotId, busy, isActive, toast],
  );

  // Global spacebar shortcut - only while this page is mounted, only
  // triggers the STOP (never the release - releasing should always be a
  // deliberate click, not a stray keypress).
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.code !== "Space") return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      event.preventDefault();
      if (!isActive) {
        toggleStop(true, "Triggered via spacebar shortcut");
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isActive, toggleStop]);

  return (
    <div className="relative min-h-screen">
      {isActive && (
        <div className="pointer-events-none fixed inset-0 z-0 animate-pulse-gentle bg-rose-500/10" />
      )}

      <div className="relative z-10">
        <Header showBack title="Emergency Stop" icon={OctagonX} iconColor="text-rose-400" />

        <main className="mx-auto max-w-5xl px-4 py-8">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_360px]">
            <div className="flex flex-col items-center gap-6">
              <button
                onClick={() => toggleStop(!isActive, isActive ? "Released from console" : "Triggered from console")}
                disabled={busy}
                aria-label={isActive ? "Release emergency stop" : "Engage emergency stop"}
                className="group relative flex h-56 w-56 items-center justify-center rounded-full focus:outline-none focus-visible:ring-4 focus-visible:ring-accent disabled:cursor-not-allowed"
              >
                <span
                  className={`absolute inset-0 rounded-full border-2 border-dashed ${
                    isActive ? "animate-spin-slow border-rose-500/50" : "border-emerald-500/40"
                  }`}
                />
                <span
                  className={`absolute inset-4 rounded-full border border-dashed ${
                    isActive ? "border-rose-500/30" : "border-emerald-500/25"
                  }`}
                />
                <span
                  className={`absolute inset-8 rounded-full transition-colors ${
                    isActive ? "animate-pulse-status bg-rose-500/20" : "bg-emerald-500/10"
                  }`}
                />
                <span
                  className={`relative flex h-40 w-40 flex-col items-center justify-center gap-2 rounded-full border-4 text-center transition-colors ${
                    isActive
                      ? "border-rose-500 bg-rose-500/20 text-rose-300"
                      : "border-emerald-500 bg-emerald-500/10 text-emerald-300"
                  }`}
                >
                  {isActive ? <OctagonX className="h-9 w-9" /> : <ShieldCheck className="h-9 w-9" />}
                  <span className="font-mono text-sm font-bold tracking-wide">
                    {isActive ? "E-STOP ACTIVE" : "SYSTEM ARMED"}
                  </span>
                </span>
              </button>
              <p className="font-mono text-xs text-textMuted">
                {isActive ? "Tap the button to release and resume operation." : "Tap the button to halt the robot immediately."}
              </p>

              <Card className="flex items-start gap-3 p-4">
                <Keyboard className="mt-0.5 h-4 w-4 flex-shrink-0 text-accent" />
                <div>
                  <p className="font-mono text-xs font-semibold text-text">Keyboard Override Active</p>
                  <p className="mt-1 max-w-sm text-xs text-textMuted">
                    Press <kbd className="rounded border border-border bg-card px-1.5 py-0.5 font-mono text-[10px]">Space</kbd> anywhere
                    on this page to trigger an emergency stop instantly. Release always requires a deliberate click.
                  </p>
                </div>
              </Card>
            </div>

            <Card className="flex flex-col p-5">
              <h3 className="mb-4 font-mono text-xs uppercase tracking-wide text-textMuted">Trigger History</h3>
              {loadingHistory ? (
                <div className="space-y-2">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <Skeleton key={i} className="h-14" />
                  ))}
                </div>
              ) : history.length === 0 ? (
                <EmptyState icon={<OctagonX className="h-8 w-8" />} title="No history yet" description="Trigger and release events will appear here." />
              ) : (
                <ul className="space-y-2 overflow-y-auto">
                  {history.map((entry) => (
                    <li key={entry.id} className="rounded-lg border border-border/40 bg-background/40 p-3">
                      <div className="mb-1 flex items-center justify-between">
                        <span className={`font-mono text-xs font-semibold ${entry.is_active ? "text-rose-400" : "text-emerald-400"}`}>
                          {entry.is_active ? "TRIGGERED" : "RELEASED"}
                        </span>
                        <span className="font-mono text-[10px] text-textDim">
                          {new Date(entry.created_at).toLocaleTimeString()}
                        </span>
                      </div>
                      <p className="text-xs text-textMuted">{entry.reason}</p>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </main>
      </div>
    </div>
  );
}
