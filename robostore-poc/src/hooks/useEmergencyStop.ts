import { useCallback, useEffect, useState } from "react";
import * as localDb from "../lib/localDb";
import type { EmergencyStop } from "../types";

// Shared emergency-stop state.
//
// This used to live inside EmergencyStopPage, with the Header keeping its
// own separate read-only copy of `is_active` just to render a status pill.
// Two consequences, both worth fixing:
//
//   1. The stop could only be *engaged* from one route. An operator driving
//      the robot on /remote-controller who needed to halt it had to navigate
//      away first. A safety control that is one navigation away from the
//      operator is not a safety control, so AppShell now renders a global
//      E-STOP and every route can trigger it.
//   2. Two components independently derived the same safety-critical boolean
//      from the same store. One hook, one subscription, one truth.

export interface EmergencyStopState {
  isActive: boolean;
  /** Full trigger/release log, newest first. */
  history: EmergencyStop[];
  /** True until the initial read resolves — don't render "clear" before this. */
  loading: boolean;
  /** True while a toggle is in flight. */
  busy: boolean;
  robotId: string | null;
  toggle: (nextActive: boolean, reason: string) => Promise<void>;
}

export function useEmergencyStop(historyLimit = 10): EmergencyStopState {
  const [robotId, setRobotId] = useState<string | null>(null);
  const [isActive, setIsActive] = useState(false);
  const [history, setHistory] = useState<EmergencyStop[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [robot, stops] = await Promise.all([
          localDb.getRobot(),
          localDb.getEmergencyStops(historyLimit),
        ]);
        if (cancelled) return;
        setRobotId(robot.id);
        setHistory(stops);
        setIsActive(stops[0]?.is_active ?? false);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [historyLimit]);

  // Every mounted consumer stays in sync — engaging the stop from the shell
  // updates the page, and vice versa.
  useEffect(() => {
    return localDb.onEmergencyStopUpdated((entry) => {
      setIsActive(entry.is_active);
      setHistory((h) => [entry, ...h.filter((e) => e.id !== entry.id)].slice(0, historyLimit));
    });
  }, [historyLimit]);

  const toggle = useCallback(
    async (nextActive: boolean, reason: string) => {
      if (!robotId || busy) return;
      setBusy(true);
      const previous = isActive;
      setIsActive(nextActive); // optimistic — a stop must feel instant
      try {
        await localDb.triggerEmergencyStop(robotId, nextActive, reason);
      } catch (err) {
        setIsActive(previous); // revert
        throw err;
      } finally {
        setBusy(false);
      }
    },
    [robotId, busy, isActive],
  );

  return { isActive, history, loading, busy, robotId, toggle };
}
