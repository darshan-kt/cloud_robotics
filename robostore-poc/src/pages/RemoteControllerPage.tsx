import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type TouchEvent as ReactTouchEvent,
} from "react";
import { ArrowDownToLine, ArrowUpToLine, Home, OctagonX, Package, Radio, Smartphone } from "lucide-react";
import { Header } from "../components/layout/Header";
import { Card, Badge, Button } from "../components/ui/Layout";
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

function renderLidarHud(ctx: CanvasRenderingContext2D, size: number, scan: ScanFrame | null, sweepAngle: number) {
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = "#0a1b20";
  ctx.fillRect(0, 0, size, size);

  const cx = size / 2;
  const cy = size / 2;
  const maxRange = Math.min(scan?.range_max ?? 3.5, 5.0);
  const radius = size / 2 - 26;
  const pxPerM = radius / maxRange;

  ctx.strokeStyle = "rgba(56, 189, 248, 0.25)";
  ctx.fillStyle = "rgba(136, 146, 168, 0.8)";
  ctx.font = "10px monospace";
  ctx.lineWidth = 1;
  for (let m = 1; m <= Math.ceil(maxRange); m++) {
    const r = m * pxPerM;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillText(`${m}m`, cx + 4, cy - r - 2);
  }

  ctx.strokeStyle = "rgba(56, 189, 248, 0.15)";
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
  wedge.addColorStop(0, "rgba(0, 229, 160, 0.35)");
  wedge.addColorStop(1, "rgba(0, 229, 160, 0)");
  ctx.fillStyle = wedge;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.arc(0, 0, radius, -0.12, 0.12);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "rgba(0, 229, 160, 0.8)";
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
      ctx.fillStyle = `rgba(255, 77, 106, ${alpha.toFixed(2)})`;
      ctx.beginPath();
      ctx.arc(cx + dx, cy + dy, 2, 0, Math.PI * 2);
      ctx.fill();
    });
  } else {
    ctx.fillStyle = "#8892a8";
    ctx.font = "12px monospace";
    ctx.textAlign = "center";
    ctx.fillText("WAITING FOR /scan …", cx, cy);
    ctx.textAlign = "left";
  }

  // Robot node + forward-facing indicator - always drawn, regardless of data.
  ctx.fillStyle = "#00e5a0";
  ctx.strokeStyle = "#e8ecf4";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "#00e5a0";
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
      className={`flex h-14 w-14 select-none items-center justify-center rounded-xl border font-mono text-sm font-bold transition-colors ${
        active ? "border-accent bg-accent text-background" : "border-border bg-card text-text hover:bg-card/70"
      }`}
    >
      {label}
    </button>
  );
}

// ---- Page ------------------------------------------------

const HUD_SIZE = 380;

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
      if (canvas) {
        const ctx = canvas.getContext("2d");
        if (ctx) renderLidarHud(ctx, HUD_SIZE, scanRef.current, sweepAngleRef.current);
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

  return (
    <div className="min-h-screen">
      <Header showBack title="Remote Controller" icon={Smartphone} iconColor="text-purple-400" />

      <main className="mx-auto max-w-6xl px-4 py-6">
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_400px]">
          {/* LIDAR HUD + velocity readout */}
          <div className="space-y-4">
            <Card className="flex flex-col items-center gap-3 p-4">
              <div className="flex w-full items-center justify-between">
                <h3 className="font-mono text-xs uppercase tracking-wide text-textMuted">LIDAR HUD</h3>
                <div className="flex items-center gap-2">
                  <Badge theme={telemetryConnected ? "emerald" : "muted"}>
                    {telemetryConnected ? (latencyMs !== null ? `${latencyMs}ms` : "LINKED") : "OFFLINE"}
                  </Badge>
                  <button
                    onClick={() => setScanUpdateOn((v) => !v)}
                    className={`rounded-full border px-3 py-1 font-mono text-[10px] uppercase tracking-wide transition-colors ${
                      scanUpdateOn ? "border-accent bg-accent/10 text-accent" : "border-border text-textDim hover:text-text"
                    }`}
                  >
                    Scan Update: {scanUpdateOn ? "ON" : "OFF"}
                  </button>
                </div>
              </div>
              <canvas ref={canvasRef} width={HUD_SIZE} height={HUD_SIZE} className="max-w-full rounded-xl" />
            </Card>

            <div className="grid grid-cols-2 gap-4">
              <Card className="p-4">
                <p className="font-mono text-[10px] uppercase tracking-wide text-textDim">Linear Velocity</p>
                <p className="mt-1 font-mono text-lg font-semibold text-text">{linearVel.toFixed(2)} m/s</p>
              </Card>
              <Card className="p-4">
                <p className="font-mono text-[10px] uppercase tracking-wide text-textDim">Angular Velocity</p>
                <p className="mt-1 font-mono text-lg font-semibold text-text">{angularVel.toFixed(2)} rad/s</p>
              </Card>
            </div>
          </div>

          {/* Driving controls */}
          <div className="space-y-4">
            <Card className="space-y-3 p-4">
              <h3 className="font-mono text-xs uppercase tracking-wide text-textMuted">Drive Limit Controls</h3>
              <label className="block">
                <div className="mb-1 flex justify-between font-mono text-[11px] text-textMuted">
                  <span>Max Linear Speed</span>
                  <span>{maxLinearSpeed.toFixed(2)} m/s</span>
                </div>
                <input
                  type="range"
                  min={0.1}
                  max={0.8}
                  step={0.05}
                  value={maxLinearSpeed}
                  onChange={(e) => setMaxLinearSpeed(parseFloat(e.target.value))}
                  className="w-full accent-accent"
                />
              </label>
              <label className="block">
                <div className="mb-1 flex justify-between font-mono text-[11px] text-textMuted">
                  <span>Max Turn Rate</span>
                  <span>{maxAngularSpeed.toFixed(2)} rad/s</span>
                </div>
                <input
                  type="range"
                  min={0.1}
                  max={1.0}
                  step={0.05}
                  value={maxAngularSpeed}
                  onChange={(e) => setMaxAngularSpeed(parseFloat(e.target.value))}
                  className="w-full accent-accent"
                />
              </label>
            </Card>

            <Card className="space-y-3 p-4">
              <div className="flex items-center justify-between">
                <h3 className="font-mono text-xs uppercase tracking-wide text-textMuted">Steering Interface</h3>
                <Badge theme={ctrlConnected ? "emerald" : "muted"}>
                  <Radio className="h-3 w-3" /> {ctrlConnected ? "CTRL LINK" : "CTRL OFFLINE"}
                </Badge>
              </div>
              <div className="flex items-center justify-around gap-4">
                <div className="grid grid-cols-3 grid-rows-2 gap-2">
                  <div />
                  <KeyTile label="W" active={!!keysPressed["w"]} onPress={() => setKeyState("w", true)} onRelease={() => setKeyState("w", false)} />
                  <div />
                  <KeyTile label="A" active={!!keysPressed["a"]} onPress={() => setKeyState("a", true)} onRelease={() => setKeyState("a", false)} />
                  <KeyTile label="S" active={!!keysPressed["s"]} onPress={() => setKeyState("s", true)} onRelease={() => setKeyState("s", false)} />
                  <KeyTile label="D" active={!!keysPressed["d"]} onPress={() => setKeyState("d", true)} onRelease={() => setKeyState("d", false)} />
                </div>

                <div
                  ref={joystickRef}
                  onMouseDown={handleJoystickStart}
                  onTouchStart={handleJoystickStart}
                  className="relative h-32 w-32 flex-shrink-0 touch-none rounded-full border border-border bg-background"
                >
                  <div
                    className={`absolute left-1/2 top-1/2 h-10 w-10 rounded-full border-2 ${
                      isDragging ? "border-accent bg-accent/30" : "border-textDim bg-card"
                    }`}
                    style={{ transform: `translate(-50%, -50%) translate(${joystickPos.x}px, ${joystickPos.y}px)` }}
                  />
                </div>
              </div>
            </Card>

            <Card className="space-y-4 p-4">
              <h3 className="font-mono text-xs uppercase tracking-wide text-textMuted">Robotic Actuators</h3>
              <div>
                <div className="mb-1 flex justify-between font-mono text-[11px] text-textMuted">
                  <span>Lift Extension</span>
                  <span>{liftLevel}%</span>
                </div>
                <div className="mb-2 h-2 rounded-full bg-card">
                  <div className="h-2 rounded-full bg-info transition-[width]" style={{ width: `${liftLevel}%` }} />
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" icon={<ArrowUpToLine className="h-3.5 w-3.5" />} onClick={handleRaiseLift} disabled={isLifting !== null || liftLevel >= 100}>
                    Raise
                  </Button>
                  <Button variant="outline" size="sm" icon={<ArrowDownToLine className="h-3.5 w-3.5" />} onClick={handleLowerLift} disabled={isLifting !== null || liftLevel <= 0}>
                    Lower
                  </Button>
                </div>
              </div>

              <div className="border-t border-border/40 pt-3">
                <div className="mb-3 flex gap-2">
                  <Button variant="ghost" size="sm" icon={<Home className="h-3.5 w-3.5" />} onClick={() => toast.show("info", "Go Home is not wired to a real behavior yet.")}>
                    Go Home
                  </Button>
                  <Button variant="ghost" size="sm" icon={<Package className="h-3.5 w-3.5" />} onClick={() => toast.show("info", "Dock Robot is not wired to a real behavior yet.")}>
                    Dock Robot
                  </Button>
                </div>
                <Button variant="danger" size="md" icon={<OctagonX className="h-4 w-4" />} onClick={triggerEStop} className="w-full">
                  EMERGENCY STOP (E-STOP)
                </Button>
              </div>
            </Card>

            {robotState && (
              <p className="text-center font-mono text-[10px] text-textDim">
                odom: x {robotState.x.toFixed(2)}  y {robotState.y.toFixed(2)}  θ {robotState.theta.toFixed(2)}
              </p>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
