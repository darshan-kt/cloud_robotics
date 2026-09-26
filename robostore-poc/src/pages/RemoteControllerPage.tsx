import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type TouchEvent as ReactTouchEvent,
} from "react";
import { ArrowDownToLine, ArrowUpToLine, Home, OctagonX, Package } from "lucide-react";
import { AppShell } from "../components/layout/AppShell";
import { Button, Panel } from "../components/ui/Layout";
import { Readout, SignalTag } from "../components/ui/Signal";
import { useToast } from "../components/ui/Toast";
import * as localDb from "../lib/localDb";
import { GATEWAY_URL } from "../lib/config";
import { clamp } from "../lib/utils";
import { toWsUrl } from "../hooks/useReconnectingSocket";
import { useScan, type ScanFrame } from "../hooks/useScan";
import { useVelocityCtrl } from "../hooks/useVelocityCtrl";

const TICK_MS = 100; // 10 Hz teleop transmit loop
const PING_INTERVAL_MS = 3000;
const RECONNECT_DELAY_MS = 3000; // flat retry, no backoff - see the callout below

interface InlineRobotState {
  x: number;
  y: number;
  theta: number;
  battery: number; // hardcoded - the gateway contract has no battery field on this channel
  status: string;
}

// This page deliberately does NOT use the shared useTelemetry hook. It hand-
// rolls its own /api/telemetry connection with a flat 3s reconnect (no
// exponential backoff, unlike every other socket in this app) AND a custom
// ping/pong text-frame latency probe layered on the same socket - on open it
// sends the literal string "ping" every 3s and expects a literal "pong"
// back, timing the round trip itself. No other hook/page in this app
// measures latency this way. If a real backend doesn't echo "pong" for
// "ping", this page's latency badge simply never populates - harmless, just
// blank. Kept as its own thing rather than unified with useTelemetry because
// the ping/pong probe has nowhere natural to live in the shared hook without
// leaking a Remote-Controller-only concern into every other consumer.
function useInlineTelemetry() {
  const [connected, setConnected] = useState(false);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [robotState, setRobotState] = useState<InlineRobotState | null>(null);

  useEffect(() => {
    let cancelled = false;
    let socket: WebSocket | null = null;
    let pingInterval: number | null = null;
    let reconnectTimeout: number | null = null;
    let pingSentAt = 0;

    function connect() {
      if (cancelled) return;
      socket = new WebSocket(toWsUrl(GATEWAY_URL, "/api/telemetry"));

      socket.onopen = () => {
        setConnected(true);
        pingInterval = window.setInterval(() => {
          pingSentAt = Date.now();
          socket?.send("ping");
        }, PING_INTERVAL_MS);
      };

      socket.onmessage = (event) => {
        if (event.data === "pong") {
          setLatencyMs(Date.now() - pingSentAt);
          return;
        }
        try {
          const data = JSON.parse(event.data);
          if (data && data.type === "telemetry") {
            setRobotState({ x: data.x, y: data.y, theta: data.theta, battery: 78, status: "online" });
          }
        } catch {
          // Malformed frame - discard silently.
        }
      };

      socket.onclose = () => {
        setConnected(false);
        if (pingInterval !== null) window.clearInterval(pingInterval);
        if (cancelled) return;
        reconnectTimeout = window.setTimeout(connect, RECONNECT_DELAY_MS);
      };

      socket.onerror = () => {};
    }

    connect();

    return () => {
      cancelled = true;
      if (pingInterval !== null) window.clearInterval(pingInterval);
      if (reconnectTimeout !== null) window.clearTimeout(reconnectTimeout);
      if (socket) {
        socket.onclose = null;
        socket.close();
      }
    };
  }, []);

  return { connected, latencyMs, robotState };
}

// ---- LIDAR HUD canvas ------------------------------------------------

// Canvas can't read Tailwind tokens, so the HUD's palette is declared once
// here against the same DESIGN.md values as tailwind.config.ts.
const HUD = {
  floor: "#100f0d", // canvas
  ring: "rgba(160, 157, 150, 0.16)", // muted, low alpha
  ringLabel: "rgba(160, 157, 150, 0.7)",
  crosshair: "rgba(160, 157, 150, 0.1)",
  sweep: "93, 184, 166", // nominal / accent-teal — the beam is "sensing"
  hit: "198, 69, 69", // fault — a return is an obstacle, and obstacles are red
  robot: "#cc785c", // coral — the vehicle itself is the brand mark on the map
  robotEdge: "#faf9f5",
  idle: "#908d86", // faint — the AA-measured tertiary tone
} as const;

function renderLidarHud(ctx: CanvasRenderingContext2D, size: number, scan: ScanFrame | null, sweepAngle: number) {
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = HUD.floor;
  ctx.fillRect(0, 0, size, size);

  const cx = size / 2;
  const cy = size / 2;
  const maxRange = Math.min(scan?.range_max ?? 3.5, 5.0);
  const radius = size / 2 - 26;
  const pxPerM = radius / maxRange;

  ctx.strokeStyle = HUD.ring;
  ctx.fillStyle = HUD.ringLabel;
  ctx.font = '10px "JetBrains Mono", monospace';
  ctx.lineWidth = 1;
  for (let m = 1; m <= Math.ceil(maxRange); m++) {
    const r = m * pxPerM;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillText(`${m}m`, cx + 4, cy - r - 2);
  }

  ctx.strokeStyle = HUD.crosshair;
  ctx.beginPath();
  ctx.moveTo(cx - radius, cy);
  ctx.lineTo(cx + radius, cy);
  ctx.moveTo(cx, cy - radius);
  ctx.lineTo(cx, cy + radius);
  ctx.stroke();

  // Cosmetic rotating sweep - independent of data arrival, purely visual.
  const normalizedSweep = ((sweepAngle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(normalizedSweep);
  const wedge = ctx.createLinearGradient(0, 0, radius, 0);
  wedge.addColorStop(0, `rgba(${HUD.sweep}, 0.28)`);
  wedge.addColorStop(1, `rgba(${HUD.sweep}, 0)`);
  ctx.fillStyle = wedge;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.arc(0, 0, radius, -0.12, 0.12);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = `rgba(${HUD.sweep}, 0.75)`;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(radius, 0);
  ctx.stroke();
  ctx.restore();

  if (scan) {
    scan.ranges.forEach((r, i) => {
      if (r === null || r < scan.range_min) return;
      const angle = scan.angle_min + i * scan.angle_increment;
      // ROS CCW-positive angle convention, robot-forward = screen-up.
      const dx = -Math.sin(angle) * r * pxPerM;
      const dy = -Math.cos(angle) * r * pxPerM;
      const screenAngle = ((Math.atan2(dy, dx) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      let angleDiff = Math.abs(screenAngle - normalizedSweep);
      if (angleDiff > Math.PI) angleDiff = Math.PI * 2 - angleDiff;
      const alpha = 0.35 + 0.65 * Math.max(0, 1 - angleDiff / 1.0);
      ctx.fillStyle = `rgba(${HUD.hit}, ${alpha.toFixed(2)})`;
      ctx.beginPath();
      ctx.arc(cx + dx, cy + dy, 2, 0, Math.PI * 2);
      ctx.fill();
    });
  } else {
    ctx.fillStyle = HUD.idle;
    ctx.font = '11px "JetBrains Mono", monospace';
    ctx.textAlign = "center";
    // Offset below the robot node so the text never sits under the marker,
    // which is what made the old HUD read as "WAITING FOR ● /scan".
    ctx.fillText("NO /scan DATA", cx, cy + 28);
    ctx.textAlign = "left";
  }

  // Robot node + forward-facing indicator - always drawn, regardless of data.
  ctx.fillStyle = HUD.robot;
  ctx.strokeStyle = HUD.robotEdge;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = HUD.robot;
  ctx.beginPath();
  ctx.moveTo(cx, cy - radius - 14);
  ctx.lineTo(cx - 6, cy - radius - 4);
  ctx.lineTo(cx + 6, cy - radius - 4);
  ctx.closePath();
  ctx.fill();
}

// ---- On-screen WASD keypad ------------------------------------------------

function KeyTile({ label, active, onPress, onRelease }: { label: string; active: boolean; onPress: () => void; onRelease: () => void }) {
  return (
    <button
      onMouseDown={onPress}
      onMouseUp={onRelease}
      onMouseLeave={() => active && onRelease()}
      onTouchStart={(e) => {
        e.preventDefault();
        onPress();
      }}
      onTouchEnd={onRelease}
      aria-label={`Drive ${label}`}
      aria-pressed={active}
      className={`flex h-12 w-12 select-none items-center justify-center rounded-md border font-mono text-title-sm transition-colors ${
        active
          ? "border-coral bg-coral text-on-coral"
          : "border-line bg-elevated text-body hover:border-faint/60 hover:text-ink"
      }`}
    >
      {label}
    </button>
  );
}

// ---- Page ------------------------------------------------

/** Smallest useful HUD; it grows to fill whatever the panel gives it. */
const HUD_MIN = 260;

export function RemoteControllerPage() {
  const toast = useToast();
  const { connected: telemetryConnected, latencyMs, robotState } = useInlineTelemetry();
  const { connected: ctrlConnected, sendVelocity } = useVelocityCtrl();

  const [robotId, setRobotId] = useState<string | null>(null);
  const [scanUpdateOn, setScanUpdateOn] = useState(false);
  const { scan } = useScan(scanUpdateOn);

  const [maxLinearSpeed, setMaxLinearSpeed] = useState(0.5);
  const [maxAngularSpeed, setMaxAngularSpeed] = useState(0.6);
  const [linearVel, setLinearVel] = useState(0);
  const [angularVel, setAngularVel] = useState(0);
  const [keysPressed, setKeysPressed] = useState<Record<string, boolean>>({});
  const [liftLevel, setLiftLevel] = useState(0);
  const [isLifting, setIsLifting] = useState<"raising" | "lowering" | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [joystickPos, setJoystickPos] = useState({ x: 0, y: 0 });

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hudBoxRef = useRef<HTMLDivElement>(null);
  const joystickRef = useRef<HTMLDivElement>(null);
  const scanRef = useRef<ScanFrame | null>(null);
  scanRef.current = scan;
  const sweepAngleRef = useRef(0);
  const linearVelRef = useRef(0);
  const angularVelRef = useRef(0);
  linearVelRef.current = linearVel;
  angularVelRef.current = angularVel;
  const wasDrivingRef = useRef(false);

  useEffect(() => {
    localDb.getRobot().then((robot) => {
      setRobotId(robot.id);
      setMaxLinearSpeed(clamp(robot.max_linear_speed, 0.1, 0.8));
      setMaxAngularSpeed(clamp(robot.max_turn_rate, 0.1, 1.0));
    });
  }, []);

  // requestAnimationFrame HUD loop, deliberately independent of data arrival
  // (reads scanRef, not React state) so 60fps redraw doesn't fight the
  // ~1Hz scan updates.
  useEffect(() => {
    let rafId: number;

    function draw() {
      const canvas = canvasRef.current;
      const box = hudBoxRef.current;
      if (canvas && box) {
        // Square, sized to the shorter edge of whatever space the panel has.
        const size = Math.max(HUD_MIN, Math.floor(Math.min(box.clientWidth, box.clientHeight)));
        const dpr = window.devicePixelRatio || 1;
        if (canvas.width !== size * dpr || canvas.height !== size * dpr) {
          canvas.width = size * dpr;
          canvas.height = size * dpr;
          canvas.style.width = `${size}px`;
          canvas.style.height = `${size}px`;
        }
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          renderLidarHud(ctx, size, scanRef.current, sweepAngleRef.current);
        }
      }
      sweepAngleRef.current += 0.04;
      rafId = requestAnimationFrame(draw);
    }

    rafId = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafId);
  }, []);

  // Teleop transmit loop: 10 Hz, independent of input source. Only sends
  // while actually driving, plus exactly one zero frame on release - the
  // channel goes quiet the rest of the time.
  useEffect(() => {
    const interval = window.setInterval(() => {
      const linear = linearVelRef.current;
      const angular = angularVelRef.current;
      if (linear !== 0 || angular !== 0) {
        sendVelocity(linear, angular);
        wasDrivingRef.current = true;
      } else if (wasDrivingRef.current) {
        sendVelocity(0, 0);
        wasDrivingRef.current = false;
      }
    }, TICK_MS);
    return () => window.clearInterval(interval);
  }, [sendVelocity]);

  const updateVelocityFromKeys = useCallback(
    (keys: Record<string, boolean>) => {
      let linear = 0;
      let angular = 0;
      if (keys["w"] || keys["ArrowUp"]) linear = maxLinearSpeed;
      else if (keys["s"] || keys["ArrowDown"]) linear = -maxLinearSpeed;
      if (keys["a"] || keys["ArrowLeft"]) angular = maxAngularSpeed;
      else if (keys["d"] || keys["ArrowRight"]) angular = -maxAngularSpeed;
      setLinearVel(linear);
      setAngularVel(angular);
    },
    [maxLinearSpeed, maxAngularSpeed],
  );

  const setKeyState = useCallback(
    (key: string, pressed: boolean) => {
      setKeysPressed((prev) => {
        const next = { ...prev, [key]: pressed };
        updateVelocityFromKeys(next);
        return next;
      });
    },
    [updateVelocityFromKeys],
  );

  useEffect(() => {
    const DRIVE_KEYS = new Set(["w", "a", "s", "d", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);
    function onKeyDown(e: KeyboardEvent) {
      if (!DRIVE_KEYS.has(e.key)) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      e.preventDefault();
      setKeyState(e.key, true);
    }
    function onKeyUp(e: KeyboardEvent) {
      if (!DRIVE_KEYS.has(e.key)) return;
      setKeyState(e.key, false);
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [setKeyState]);

  // ---- Joystick ------------------------------------------------

  const handleJoystickMove = useCallback(
    (clientX: number, clientY: number) => {
      const el = joystickRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      let rx = clientX - cx;
      let ry = clientY - cy;
      const maxRadius = rect.width / 2 - 20;
      const dist = Math.sqrt(rx * rx + ry * ry);
      if (dist > maxRadius) {
        rx = (rx / dist) * maxRadius;
        ry = (ry / dist) * maxRadius;
      }
      setJoystickPos({ x: rx, y: ry });

      const mag = Math.sqrt(rx * rx + ry * ry) / maxRadius;
      if (mag < 0.25) {
        setLinearVel(0);
        setAngularVel(0);
        return;
      }

      let angleDeg = (Math.atan2(-ry, rx) * 180) / Math.PI;
      if (angleDeg < 0) angleDeg += 360;

      let linear = 0;
      let angular = 0;
      if (angleDeg >= 80 && angleDeg <= 100) {
        linear = maxLinearSpeed;
      } else if (angleDeg >= 260 && angleDeg <= 280) {
        linear = -maxLinearSpeed;
      } else if (angleDeg >= 170 && angleDeg <= 190) {
        angular = maxAngularSpeed;
      } else if (angleDeg <= 10 || angleDeg >= 350) {
        angular = -maxAngularSpeed;
      } else if (angleDeg > 10 && angleDeg < 80) {
        linear = maxLinearSpeed * 0.5;
        angular = -maxAngularSpeed * 0.5;
      } else if (angleDeg > 100 && angleDeg < 170) {
        linear = maxLinearSpeed * 0.5;
        angular = maxAngularSpeed * 0.5;
      } else if (angleDeg > 190 && angleDeg < 260) {
        linear = -maxLinearSpeed * 0.5;
        angular = -maxAngularSpeed * 0.5;
      } else if (angleDeg > 280 && angleDeg < 350) {
        linear = -maxLinearSpeed * 0.5;
        angular = maxAngularSpeed * 0.5;
      }
      setLinearVel(linear);
      setAngularVel(angular);
    },
    [maxLinearSpeed, maxAngularSpeed],
  );

  const handleJoystickEnd = useCallback(() => {
    setIsDragging(false);
    setJoystickPos({ x: 0, y: 0 });
    setLinearVel(0);
    setAngularVel(0);
    sendVelocity(0, 0); // immediate - don't wait for the next 10Hz tick
    wasDrivingRef.current = false;
  }, [sendVelocity]);

  useEffect(() => {
    if (!isDragging) return;
    function onMove(e: MouseEvent) {
      handleJoystickMove(e.clientX, e.clientY);
    }
    function onTouchMove(e: TouchEvent) {
      const touch = e.touches[0];
      if (touch) handleJoystickMove(touch.clientX, touch.clientY);
    }
    function onUp() {
      handleJoystickEnd();
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("touchmove", onTouchMove);
    window.addEventListener("touchend", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onUp);
    };
  }, [isDragging, handleJoystickMove, handleJoystickEnd]);

  function handleJoystickStart(e: ReactMouseEvent<HTMLDivElement> | ReactTouchEvent<HTMLDivElement>) {
    setIsDragging(true);
    if ("touches" in e) {
      const touch = e.touches[0];
      if (touch) handleJoystickMove(touch.clientX, touch.clientY);
    } else {
      handleJoystickMove(e.clientX, e.clientY);
    }
  }

  // ---- Lift simulation ------------------------------------------------

  function handleRaiseLift() {
    if (isLifting !== null || liftLevel >= 100) return;
    setIsLifting("raising");
    toast.show("info", "Raising lift...");
    const interval = window.setInterval(() => {
      setLiftLevel((level) => {
        const next = Math.min(100, level + 5);
        if (next >= 100) {
          window.clearInterval(interval);
          setIsLifting(null);
          toast.show("success", "Lift fully raised.");
        }
        return next;
      });
    }, 150);
  }

  function handleLowerLift() {
    if (isLifting !== null || liftLevel <= 0) return;
    setIsLifting("lowering");
    toast.show("info", "Lowering lift...");
    const interval = window.setInterval(() => {
      setLiftLevel((level) => {
        const next = Math.max(0, level - 5);
        if (next <= 0) {
          window.clearInterval(interval);
          setIsLifting(null);
          toast.show("success", "Lift fully lowered.");
        }
        return next;
      });
    }, 150);
  }

  // ---- E-Stop ------------------------------------------------
  //
  // The build brief this page comes from describes its "EMERGENCY STOP"
  // button as cosmetic - zeroing velocity and showing a toast, but never
  // touching localDb's real E-Stop registry, so it wouldn't show up in the
  // header badge, the Emergency Stop page's history, or block the Route
  // Planner's dispatch guard. Left as-is, that's a real safety footgun: a
  // button labeled EMERGENCY STOP that doesn't actually engage the shared
  // system. Deliberate decision made here (see robostore-poc/README.md):
  // this button DOES engage the real E-Stop too, same as the dedicated
  // Emergency Stop page's button. It only ever triggers, never releases -
  // releasing stays a deliberate action on that dedicated page.
  async function triggerEStop() {
    sendVelocity(0, 0);
    setLinearVel(0);
    setAngularVel(0);
    wasDrivingRef.current = false;
    toast.show("error", "Emergency stop triggered - zero velocity sent.");
    if (robotId) {
      try {
        await localDb.triggerEmergencyStop(robotId, true, "Triggered from Remote Controller");
      } catch {
        toast.show("error", "Zero velocity sent, but failed to register with the E-Stop system.");
      }
    }
  }

  const driving = linearVel !== 0 || angularVel !== 0;

  return (
    <AppShell
      title="Teleop"
      toolbar={
        <div className="hidden items-center gap-md md:flex">
          <SignalTag
            state={ctrlConnected ? "live" : "absent"}
            label={ctrlConnected ? "CONTROL LINK" : "NO CONTROL LINK"}
          />
          <SignalTag
            state={telemetryConnected ? "live" : "absent"}
            label={
              telemetryConnected && latencyMs !== null ? `TELEMETRY ${latencyMs}MS` : "NO TELEMETRY"
            }
          />
        </div>
      }
    >
      {/* Two columns, both full-height. The HUD is the thing an operator
          watches while driving, so it gets every pixel the viewport allows
          instead of a fixed 380px square with empty page beneath it. */}
      <div className="mx-auto grid max-w-[1400px] lg:h-full grid-cols-1 gap-lg lg:grid-cols-[1fr_360px]">
        {/* ---- Left: the view out of the robot ---- */}
        <div className="flex min-h-0 flex-col gap-lg">
          <Panel
            title="Lidar"
            flush
            className="min-h-[320px] flex-1"
            action={
              <>
                {/* The tag describes the DATA, the button controls the
                    subscription — they must not both say "scan off". */}
                <SignalTag
                  state={scan ? "live" : "absent"}
                  label={scan ? "SCANNING" : scanUpdateOn ? "AWAITING FRAME" : "NO DATA"}
                />
                <button
                  onClick={() => setScanUpdateOn((v) => !v)}
                  aria-pressed={scanUpdateOn}
                  className={`rounded-md border px-2.5 py-1 font-sans text-label uppercase transition-colors ${
                    scanUpdateOn
                      ? "border-coral/40 bg-coral/10 text-coral"
                      : "border-line text-faint hover:border-faint/60 hover:text-body"
                  }`}
                >
                  Scan {scanUpdateOn ? "on" : "off"}
                </button>
              </>
            }
          >
            <div ref={hudBoxRef} className="flex min-h-0 flex-1 items-center justify-center p-md">
              <canvas
                ref={canvasRef}
                className="rounded-md"
                role="img"
                aria-label={
                  scan
                    ? `Lidar scan, ${scan.ranges.filter((r) => r !== null).length} returns`
                    : "Lidar scan, no data"
                }
              />
            </div>
          </Panel>

          {/* Commanded velocity. These are what the console is SENDING, not
              what the robot reports — labelled accordingly. */}
          <div className="grid flex-none grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line shadow-panel">
            <div className="bg-surface p-md">
              <Readout
                label="Commanded linear"
                value={linearVel.toFixed(2)}
                unit="m/s"
                state={ctrlConnected ? "live" : "absent"}
                tone={driving ? "nominal" : "default"}
              />
            </div>
            <div className="bg-surface p-md">
              <Readout
                label="Commanded angular"
                value={angularVel.toFixed(2)}
                unit="rad/s"
                state={ctrlConnected ? "live" : "absent"}
                tone={driving ? "nominal" : "default"}
              />
            </div>
          </div>
        </div>

        {/* ---- Right: the controls ---- */}
        <div className="flex min-h-0 flex-col gap-lg overflow-y-auto">
          <Panel title="Steering" className="flex-none">
            <div className="flex items-center justify-between gap-lg">
              <div className="grid grid-cols-3 grid-rows-2 gap-1.5">
                <div />
                <KeyTile
                  label="W"
                  active={!!keysPressed["w"]}
                  onPress={() => setKeyState("w", true)}
                  onRelease={() => setKeyState("w", false)}
                />
                <div />
                <KeyTile
                  label="A"
                  active={!!keysPressed["a"]}
                  onPress={() => setKeyState("a", true)}
                  onRelease={() => setKeyState("a", false)}
                />
                <KeyTile
                  label="S"
                  active={!!keysPressed["s"]}
                  onPress={() => setKeyState("s", true)}
                  onRelease={() => setKeyState("s", false)}
                />
                <KeyTile
                  label="D"
                  active={!!keysPressed["d"]}
                  onPress={() => setKeyState("d", true)}
                  onRelease={() => setKeyState("d", false)}
                />
              </div>

              <div
                ref={joystickRef}
                onMouseDown={handleJoystickStart}
                onTouchStart={handleJoystickStart}
                role="application"
                aria-label="Virtual joystick — or use W, A, S, D"
                className="relative h-28 w-28 flex-none touch-none rounded-pill border border-line bg-canvas"
              >
                {/* Centre crosshair, so the stick's rest position is legible. */}
                <span className="absolute left-1/2 top-1/2 h-6 w-px -translate-x-1/2 -translate-y-1/2 bg-line" />
                <span className="absolute left-1/2 top-1/2 h-px w-6 -translate-x-1/2 -translate-y-1/2 bg-line" />
                <div
                  className={`absolute left-1/2 top-1/2 h-10 w-10 rounded-pill border-2 transition-colors ${
                    isDragging ? "border-coral bg-coral/30" : "border-faint bg-elevated"
                  }`}
                  style={{
                    transform: `translate(-50%, -50%) translate(${joystickPos.x}px, ${joystickPos.y}px)`,
                  }}
                />
              </div>
            </div>

            <p className="mt-md font-sans text-caption text-faint">
              Hold <kbd className="font-mono text-muted">W A S D</kbd> or drag the stick. Release to
              stop — one zero frame is sent on release.
            </p>
          </Panel>

          <Panel title="Drive limits" className="flex-none" action={<SignalTag state="cached" label="LOCAL CAP" />}>
            <div className="flex flex-col gap-lg">
              <SliderRow
                label="Max linear speed"
                value={maxLinearSpeed}
                display={`${maxLinearSpeed.toFixed(2)} m/s`}
                min={0.1}
                max={0.8}
                step={0.05}
                onChange={setMaxLinearSpeed}
              />
              <SliderRow
                label="Max turn rate"
                value={maxAngularSpeed}
                display={`${maxAngularSpeed.toFixed(2)} rad/s`}
                min={0.1}
                max={1.0}
                step={0.05}
                onChange={setMaxAngularSpeed}
              />
            </div>
          </Panel>

          <Panel title="Actuators" className="flex-none">
            <div className="mb-1.5 flex items-baseline justify-between">
              <span className="font-sans text-body-sm text-muted">Lift extension</span>
              <span className="font-mono text-body-sm text-ink">{liftLevel}%</span>
            </div>
            <div
              className="h-1 overflow-hidden rounded-pill bg-elevated"
              role="meter"
              aria-valuenow={liftLevel}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Lift extension"
            >
              <div
                className="h-full rounded-pill bg-coral transition-[width] duration-150"
                style={{ width: `${liftLevel}%` }}
              />
            </div>

            <div className="mt-md flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                icon={<ArrowUpToLine className="h-3.5 w-3.5" />}
                onClick={handleRaiseLift}
                disabled={isLifting !== null || liftLevel >= 100}
              >
                Raise
              </Button>
              <Button
                variant="secondary"
                size="sm"
                icon={<ArrowDownToLine className="h-3.5 w-3.5" />}
                onClick={handleLowerLift}
                disabled={isLifting !== null || liftLevel <= 0}
              >
                Lower
              </Button>
            </div>

            <div className="mt-lg flex gap-2 border-t border-line-soft pt-md">
              <Button
                variant="ghost"
                size="sm"
                icon={<Home className="h-3.5 w-3.5" />}
                onClick={() => toast.show("info", "Go Home is not wired to a real behavior yet.")}
              >
                Go home
              </Button>
              <Button
                variant="ghost"
                size="sm"
                icon={<Package className="h-3.5 w-3.5" />}
                onClick={() => toast.show("info", "Dock Robot is not wired to a real behavior yet.")}
              >
                Dock
              </Button>
            </div>
          </Panel>

          {/* The driving page keeps its own large stop target in addition to
              the command bar's — while an operator's hand is on the controls,
              the stop should be the biggest thing they can hit. */}
          <Button
            variant="danger"
            size="lg"
            icon={<OctagonX className="h-4 w-4" />}
            onClick={triggerEStop}
            block
            className="flex-none"
          >
            Emergency stop
          </Button>

          {robotState && (
            <p className="flex-none text-center font-mono text-[11px] text-faint">
              odom x {robotState.x.toFixed(2)} · y {robotState.y.toFixed(2)} · θ{" "}
              {robotState.theta.toFixed(2)}
              {latencyMs !== null && <> · {latencyMs}ms</>}
            </p>
          )}
        </div>
      </div>
    </AppShell>
  );
}

/** A labelled range input. Both drive limits are safety caps, so the value is
 *  always visible rather than revealed on hover. */
function SliderRow({
  label,
  value,
  display,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  display: string;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block">
      <div className="mb-2 flex items-baseline justify-between">
        <span className="font-sans text-body-sm text-muted">{label}</span>
        <span className="font-mono text-body-sm text-ink">{display}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
    </label>
  );
}
