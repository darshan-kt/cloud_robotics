import { useCallback, useEffect, useRef, useState, type ChangeEvent, type MouseEvent as ReactMouseEvent } from "react";
import { Crosshair, MapPin, Send, Upload, X } from "lucide-react";
import { AppShell } from "../components/layout/AppShell";
import { Button, Chip, EmptyState, Panel } from "../components/ui/Layout";
import { Readout, SignalTag } from "../components/ui/Signal";
import { useEmergencyStop } from "../hooks/useEmergencyStop";
import { useToast } from "../components/ui/Toast";
import * as localDb from "../lib/localDb";
import { GATEWAY_URL } from "../lib/config";
import { parsePgmToDataUrl, loadImage } from "../lib/pgmParser";
import type { MapData, Waypoint } from "../types";
import { useTelemetry, type Telemetry } from "../hooks/useTelemetry";
import { useLocalisation, type Localisation } from "../hooks/useLocalisation";
import { usePlan, type Plan } from "../hooks/usePlan";
import { useScan, type ScanFrame } from "../hooks/useScan";

const CANVAS_WIDTH = 900;
const CANVAS_HEIGHT = 600;

interface Point {
  x: number;
  y: number;
}

interface MapMeta {
  resolution: number;
  origin_x: number;
  origin_y: number;
}

const DEFAULT_MAP_META: MapMeta = { resolution: 0.05, origin_x: -10.0, origin_y: -10.0 };

// A hand-authored inline SVG "Warehouse Floor A" - the default map seeded
// the first time no published/complete map exists in localDb yet. Walls, 4
// rooms, a center silo - just enough to have something real to click
// waypoints onto without requiring a robot or a real map upload first.
const WAREHOUSE_FLOOR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600">
  <rect width="800" height="600" fill="#2a2825"/>
  <rect x="20" y="20" width="760" height="560" fill="none" stroke="#7d7a73" stroke-width="6"/>
  <line x1="400" y1="20" x2="400" y2="300" stroke="#57544e" stroke-width="5"/>
  <line x1="20" y1="300" x2="780" y2="300" stroke="#57544e" stroke-width="5"/>
  <line x1="400" y1="300" x2="400" y2="580" stroke="#57544e" stroke-width="5"/>
  <circle cx="400" cy="300" r="45" fill="#3a3733" stroke="#7d7a73" stroke-width="4"/>
  <text x="90" y="160" font-family="monospace" font-size="20" fill="#a09d96">ROOM A</text>
  <text x="490" y="160" font-family="monospace" font-size="20" fill="#a09d96">ROOM B</text>
  <text x="90" y="440" font-family="monospace" font-size="20" fill="#a09d96">ROOM C</text>
  <text x="490" y="440" font-family="monospace" font-size="20" fill="#a09d96">ROOM D</text>
</svg>`;
const WAREHOUSE_MAP_DATA_URI = `data:image/svg+xml;base64,${btoa(WAREHOUSE_FLOOR_SVG)}`;

function computeMapLayout(img: HTMLImageElement) {
  const scale = Math.min(CANVAS_WIDTH / img.width, CANVAS_HEIGHT / img.height);
  const drawWidth = img.width * scale;
  const drawHeight = img.height * scale;
  const drawX = (CANVAS_WIDTH - drawWidth) / 2;
  const drawY = (CANVAS_HEIGHT - drawHeight) / 2;
  return { scale, drawX, drawY, drawWidth, drawHeight };
}

type Layout = ReturnType<typeof computeMapLayout>;

/** Map-frame meters -> canvas pixels. Standard ROS map_server convention:
 * image row 0 (top) is the map's max Y, so the Y axis flips. Used for AMCL
 * and the Nav2 plan - NOT for the live robot marker, which the current
 * gateway sends already pre-mapped into canvas-pixel space (see the big
 * coordinate-systems callout below). */
function worldToCanvas(x: number, y: number, img: HTMLImageElement, layout: Layout, meta: MapMeta): Point {
  const imgX = (x - meta.origin_x) / meta.resolution;
  const imgY = img.height - (y - meta.origin_y) / meta.resolution;
  return { x: layout.drawX + imgX * layout.scale, y: layout.drawY + imgY * layout.scale };
}

/** Inverse of worldToCanvas - used only at send time, converting user-placed
 * waypoints (stored in canvas pixels) back to real map-frame meters. */
function canvasToWorld(cx: number, cy: number, img: HTMLImageElement, layout: Layout, meta: MapMeta): Point {
  const imgX = (cx - layout.drawX) / layout.scale;
  const imgY = (cy - layout.drawY) / layout.scale;
  const worldX = imgX * meta.resolution + meta.origin_x;
  const worldY = (img.height - imgY) * meta.resolution + meta.origin_y;
  return { x: worldX, y: worldY };
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

// ---- Canvas rendering ------------------------------------------------
//
// Three coordinate systems share this one canvas - see robostore-poc/README.md
// and the build brief this page comes from for the full explanation:
//   - Waypoints + AMCL: map-frame meters -> image pixels -> canvas pixels
//     (worldToCanvas, using mapMeta + the image's own scale/drawX/drawY).
//   - The live robot marker: telemetry.x/y used AS canvas pixels directly -
//     no conversion. The current (nonexistent) gateway is documented to
//     already pre-map odometry into canvas-pixel space; a real backend
//     sending raw map-frame meters instead would need the same
//     worldToCanvas conversion added here before this marker is correct.
//   - The Nav2 plan: real map-frame meters, goes through the full
//     worldToCanvas conversion, same as AMCL.

interface RenderState {
  mapImage: HTMLImageElement | null;
  layout: Layout | null;
  mapMeta: MapMeta;
  waypoints: Waypoint[];
  pendingWaypoint: Point | null;
  mousePos: Point;
  telemetry: Telemetry | null;
  localisation: Localisation | null;
  plan: Plan | null;
}

function renderRouteCanvas(ctx: CanvasRenderingContext2D, state: RenderState) {
  ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  ctx.fillStyle = "#100f0d";
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

  const { mapImage, layout, mapMeta, waypoints, pendingWaypoint, mousePos, telemetry, localisation, plan } = state;

  // (1) Map image
  if (mapImage && layout) {
    ctx.drawImage(mapImage, layout.drawX, layout.drawY, layout.drawWidth, layout.drawHeight);
  }

  // (2) Grid overlay
  ctx.strokeStyle = "rgba(160, 157, 150, 0.07)";
  ctx.lineWidth = 1;
  for (let x = 0; x <= CANVAS_WIDTH; x += 40) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, CANVAS_HEIGHT);
    ctx.stroke();
  }
  for (let y = 0; y <= CANVAS_HEIGHT; y += 40) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(CANVAS_WIDTH, y);
    ctx.stroke();
  }

  // (3) Nav2 global plan - intentionally NOT connected to the user-placed
  // waypoint markers below; this is the planner's own computed path.
  if (mapImage && layout && plan && plan.points.length >= 2) {
    const pts = plan.points.map((p) => worldToCanvas(p.x, p.y, mapImage, layout, mapMeta));
    ctx.lineWidth = 7;
    ctx.strokeStyle = "rgba(204, 120, 92, 0.25)";
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    pts.slice(1).forEach((p) => ctx.lineTo(p.x, p.y));
    ctx.stroke();

    ctx.lineWidth = 2.5;
    ctx.strokeStyle = "#cc785c";
    ctx.setLineDash([10, 8]);
    ctx.lineDashOffset = -((Date.now() / 40) % 18);
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    pts.slice(1).forEach((p) => ctx.lineTo(p.x, p.y));
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // (4) Placed waypoints
  waypoints.forEach((wp) => {
    ctx.fillStyle = "rgba(204, 120, 92, 0.22)";
    ctx.beginPath();
    ctx.arc(wp.x, wp.y, 16, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#cc785c";
    ctx.beginPath();
    ctx.arc(wp.x, wp.y, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#100f0d";
    ctx.font = "bold 10px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(wp.order), wp.x, wp.y);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";

    if (wp.theta !== undefined) {
      const ax = wp.x + Math.cos(wp.theta) * 22;
      const ay = wp.y + Math.sin(wp.theta) * 22;
      ctx.strokeStyle = "#e8a55a";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(wp.x, wp.y);
      ctx.lineTo(ax, ay);
      ctx.stroke();
    }
  });

  // (5) Live robot marker - telemetry.x/y used AS canvas pixels directly.
  if (telemetry) {
    const pulseR = 14 + Math.sin(Date.now() / 150) * 3;
    ctx.strokeStyle = "rgba(93, 184, 166, 0.55)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(telemetry.x, telemetry.y, pulseR, 0, Math.PI * 2);
    ctx.stroke();

    const hx = telemetry.x + Math.cos(telemetry.theta) * 18;
    const hy = telemetry.y - Math.sin(telemetry.theta) * 18;
    ctx.strokeStyle = "#5db8a6";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(telemetry.x, telemetry.y);
    ctx.lineTo(hx, hy);
    ctx.stroke();

    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(telemetry.x, telemetry.y, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  // (6) AMCL marker - the elaborate one: two phase-shifted sonar ripples, a
  // static accuracy halo, a directional heading wedge, and a breathing core.
  if (localisation && mapImage && layout) {
    const p = worldToCanvas(localisation.x, localisation.y, mapImage, layout, mapMeta);
    const now = Date.now();

    [0, 750].forEach((phaseShift) => {
      const t = ((now + phaseShift) % 1500) / 1500;
      const r = 8 + t * 30;
      ctx.strokeStyle = `rgba(93, 184, 166, ${(1 - t) * 0.7})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.stroke();
    });

    ctx.strokeStyle = "rgba(93, 184, 166, 0.25)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 22, 0, Math.PI * 2);
    ctx.stroke();

    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(-localisation.yaw);
    const wedge = ctx.createRadialGradient(0, 0, 0, 0, 0, 40);
    wedge.addColorStop(0, "rgba(56, 189, 248, 0.35)");
    wedge.addColorStop(1, "rgba(56, 189, 248, 0)");
    ctx.fillStyle = wedge;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, 40, -0.44, 0.44);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    const coreR = 6 + Math.sin(now / 300) * 0.8;
    ctx.fillStyle = "#faf9f5";
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(p.x, p.y, coreR, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  // (7) Pending-waypoint ghost preview
  if (pendingWaypoint) {
    ctx.fillStyle = "rgba(232, 165, 90, 0.5)";
    ctx.beginPath();
    ctx.arc(pendingWaypoint.x, pendingWaypoint.y, 9, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = "rgba(232, 165, 90, 0.6)";
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(pendingWaypoint.x, pendingWaypoint.y);
    ctx.lineTo(mousePos.x, mousePos.y);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

// ---- Scan Observation panel (simpler polar plot, separate from Remote
// Controller's full HUD) ------------------------------------------------

const SCAN_CANVAS_SIZE = 220;

function renderScanPolar(ctx: CanvasRenderingContext2D, scan: ScanFrame | null) {
  const size = SCAN_CANVAS_SIZE;
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = "#100f0d";
  ctx.fillRect(0, 0, size, size);

  const cx = size / 2;
  const cy = size / 2;
  const maxRange = scan?.range_max ?? 3.5;
  const radius = size / 2 - 12;

  ctx.strokeStyle = "rgba(160, 157, 150, 0.16)";
  ctx.lineWidth = 1;
  [0.25, 0.5, 0.75, 1.0].forEach((frac) => {
    ctx.beginPath();
    ctx.arc(cx, cy, radius * frac, 0, Math.PI * 2);
    ctx.stroke();
  });
  ctx.beginPath();
  ctx.moveTo(cx - radius, cy);
  ctx.lineTo(cx + radius, cy);
  ctx.moveTo(cx, cy - radius);
  ctx.lineTo(cx, cy + radius);
  ctx.stroke();

  if (scan) {
    const pxPerM = radius / maxRange;
    ctx.fillStyle = "#c64545";
    scan.ranges.forEach((r, i) => {
      if (r === null || r < scan.range_min) return;
      const angle = scan.angle_min + i * scan.angle_increment;
      const dx = Math.cos(angle) * r * pxPerM;
      const dy = -Math.sin(angle) * r * pxPerM;
      ctx.fillRect(cx + dx - 1, cy + dy - 1, 2, 2);
    });
  }

  ctx.fillStyle = "#cc785c";
  ctx.beginPath();
  ctx.arc(cx, cy, 3, 0, Math.PI * 2);
  ctx.fill();
}

// ---- Page ------------------------------------------------

export function SimpleRoutePlannerPage() {
  const toast = useToast();
  const { telemetry } = useTelemetry();
  const { localisation } = useLocalisation();
  const { plan } = usePlan();
  const [scanUpdateOn, setScanUpdateOn] = useState(false);
  const { scan } = useScan(scanUpdateOn);

  const [maps, setMaps] = useState<MapData[]>([]);
  const [selectedMap, setSelectedMap] = useState<MapData | null>(null);
  const [loading, setLoading] = useState(true);
  const [waypoints, setWaypoints] = useState<Waypoint[]>([]);
  const [drawMode, setDrawMode] = useState(false);
  const [missionId, setMissionId] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [sentSuccess, setSentSuccess] = useState(false);
  const [mapImage, setMapImage] = useState<HTMLImageElement | null>(null);
  const [mapMeta, setMapMeta] = useState<MapMeta>(DEFAULT_MAP_META);
  const [pendingWaypoint, setPendingWaypoint] = useState<Point | null>(null);
  const [mousePos, setMousePos] = useState<Point>({ x: 0, y: 0 });

  // Dispatch is blocked while the stop is latched. Same subscription the
  // command bar and the E-Stop page use, so all three always agree.
  const { isActive: eStopActive } = useEmergencyStop();

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scanCanvasRef = useRef<HTMLCanvasElement>(null);
  const robotMapLoadedRef = useRef(false);
  const renderStateRef = useRef<RenderState>({
    mapImage: null,
    layout: null,
    mapMeta: DEFAULT_MAP_META,
    waypoints: [],
    pendingWaypoint: null,
    mousePos: { x: 0, y: 0 },
    telemetry: null,
    localisation: null,
    plan: null,
  });

  renderStateRef.current = {
    mapImage,
    layout: mapImage ? computeMapLayout(mapImage) : null,
    mapMeta,
    waypoints,
    pendingWaypoint,
    mousePos,
    telemetry,
    localisation,
    plan,
  };
  const scanRef = useRef<ScanFrame | null>(null);
  scanRef.current = scan;


  // ---- Map loading, source 1: a static /map.pgm at the web root -----
  useEffect(() => {
    let cancelled = false;
    async function tryRobotMap() {
      try {
        const res = await fetch("/map.pgm");
        if (!res.ok) throw new Error("no map.pgm");
        const buffer = await res.arrayBuffer();
        const dataUrl = parsePgmToDataUrl(buffer);
        const img = await loadImage(dataUrl);
        if (cancelled) return;
        robotMapLoadedRef.current = true;
        setMapImage(img);
      } catch {
        // No static map.pgm - fall through to localDb/default sources below.
      }
    }
    tryRobotMap();
    return () => {
      cancelled = true;
    };
  }, []);

  // ---- Map loading, source 2: localDb (seeding the default warehouse map
  // on first run) - also creates the draft Mission this session writes into.
  useEffect(() => {
    let cancelled = false;
    async function loadDbMaps() {
      let all = await localDb.getMaps();
      let published = all.filter((m) => m.status === "published" || m.status === "complete");
      if (published.length === 0) {
        const seeded = await localDb.saveMap({
          name: "Warehouse Floor A",
          description: "Default seeded demo map",
          status: "published",
          source: "seed",
          resolution: DEFAULT_MAP_META.resolution,
          width: 800,
          height: 600,
          map_data: WAREHOUSE_MAP_DATA_URI,
        });
        published = [seeded];
      }
      if (cancelled) return;
      setMaps(published);
      const first = published[0];
      setSelectedMap(first ?? null);

      if (!robotMapLoadedRef.current && first) {
        try {
          const img = await loadImage(first.map_data as string);
          if (!cancelled && !robotMapLoadedRef.current) setMapImage(img);
        } catch {
          // Decode failure on the seeded/db map - leave mapImage null, the
          // canvas still renders the grid/markers with no basemap under them.
        }
      }

      const mission = await localDb.saveMission({
        map_id: first?.id ?? "",
        name: `Draft ${new Date().toLocaleString()}`,
        status: "draft",
        waypoints: [],
      });
      if (!cancelled) setMissionId(mission.id);
      if (!cancelled) setLoading(false);
    }
    loadDbMaps();
    return () => {
      cancelled = true;
    };
  }, []);

  // ---- Real map.pgm resolution/origin, if the gateway has it -----
  useEffect(() => {
    let cancelled = false;
    fetch(`${GATEWAY_URL}/api/map/meta`, { signal: AbortSignal.timeout(3000) })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("not ok"))))
      .then((data) => {
        if (cancelled) return;
        if (typeof data.resolution === "number" && typeof data.origin_x === "number" && typeof data.origin_y === "number") {
          setMapMeta({ resolution: data.resolution, origin_x: data.origin_x, origin_y: data.origin_y });
        }
      })
      .catch(() => {
        // Keep the hardcoded defaults.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // ---- Canvas render loops - redraw every frame regardless of a dirty
  // flag, matching the LIDAR HUD's approach on the Remote Controller page.
  useEffect(() => {
    let rafId: number;
    function draw() {
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext("2d");
        if (ctx) renderRouteCanvas(ctx, renderStateRef.current);
      }
      const scanCanvas = scanCanvasRef.current;
      if (scanCanvas) {
        const ctx = scanCanvas.getContext("2d");
        if (ctx) renderScanPolar(ctx, scanRef.current);
      }
      rafId = requestAnimationFrame(draw);
    }
    rafId = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafId);
  }, []);

  const persistWaypoints = useCallback(
    (updated: Waypoint[]) => {
      if (missionId) {
        localDb.saveMission({ id: missionId, waypoints: updated });
      }
    },
    [missionId],
  );

  function canvasPointFromEvent(e: ReactMouseEvent<HTMLCanvasElement>): Point {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
  }

  function handleCanvasMouseMove(e: ReactMouseEvent<HTMLCanvasElement>) {
    setMousePos(canvasPointFromEvent(e));
  }

  function handleCanvasClick(e: ReactMouseEvent<HTMLCanvasElement>) {
    if (!drawMode) return;
    const point = canvasPointFromEvent(e);

    if (!pendingWaypoint) {
      setPendingWaypoint(point);
      return;
    }

    const theta = Math.atan2(point.y - pendingWaypoint.y, point.x - pendingWaypoint.x);
    const order = waypoints.length + 1;
    const updated = [...waypoints, { x: pendingWaypoint.x, y: pendingWaypoint.y, theta, order, label: `WP-${order}` }];
    setWaypoints(updated);
    setPendingWaypoint(null);
    persistWaypoints(updated);
  }

  function removeWaypoint(index: number) {
    const updated = waypoints
      .filter((_, i) => i !== index)
      .map((wp, i) => ({ ...wp, order: i + 1, label: `WP-${i + 1}` }));
    setWaypoints(updated);
    persistWaypoints(updated);
  }

  async function handleUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsUploading(true);
    try {
      const dataUrl = file.name.toLowerCase().endsWith(".pgm")
        ? parsePgmToDataUrl(await file.arrayBuffer())
        : await readFileAsDataUrl(file);
      const img = await loadImage(dataUrl);
      robotMapLoadedRef.current = true; // a deliberate user choice - no automatic source should override it
      setMapImage(img);
      const saved = await localDb.saveMap({
        name: file.name,
        description: "Uploaded map",
        status: "published",
        source: "upload",
        resolution: mapMeta.resolution,
        width: img.width,
        height: img.height,
        map_data: dataUrl,
      });
      setMaps((prev) => [...prev, saved]);
      setSelectedMap(saved);
      toast.show("success", `Loaded ${file.name}`);
    } catch {
      toast.show("error", "Failed to load that file as a map.");
    } finally {
      setIsUploading(false);
      e.target.value = "";
    }
  }

  function selectMap(map: MapData) {
    setSelectedMap(map);
    robotMapLoadedRef.current = true; // deliberate user choice, same reasoning as upload
    loadImage(map.map_data as string)
      .then(setMapImage)
      .catch(() => toast.show("error", `Failed to render ${map.name}.`));
  }

  async function sendMission() {
    if (waypoints.length === 0 || !missionId || eStopActive || !mapImage) return;
    setIsSending(true);
    setSentSuccess(false);
    try {
      const layout = computeMapLayout(mapImage);
      const poses = waypoints.map((wp) => {
        const world = canvasToWorld(wp.x, wp.y, mapImage, layout, mapMeta);
        // Canvas Y-down needs flipping to ROS's Y-up convention before this
        // becomes a yaw-only quaternion.
        const theta = -(wp.theta ?? 0);
        return {
          header: { frame_id: "map" },
          pose: {
            position: { x: world.x, y: world.y, z: 0 },
            orientation: { x: 0, y: 0, z: Math.sin(theta / 2), w: Math.cos(theta / 2) },
          },
        };
      });

      const res = await fetch(`${GATEWAY_URL}/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: 22,
          behavior_name: "FollowRoute",
          task_id: missionId,
          note: "Sent from Simple Route Planner",
          poses,
        }),
      });

      if (res.status === 503) {
        const body = await res.json().catch(() => ({}) as { detail?: string });
        throw new Error(body.detail ?? "Gateway not ready (hive/nav2 not ready yet).");
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}) as { detail?: string });
        throw new Error(`Gateway error ${res.status}: ${body.detail ?? "unknown error"}`);
      }

      setSentSuccess(true);
      toast.show("success", "Route dispatched.");
    } catch (err) {
      if (err instanceof TypeError && /fetch/i.test(err.message)) {
        toast.show("error", `Cannot reach gateway at ${GATEWAY_URL} — is it running?`);
      } else {
        toast.show("error", err instanceof Error ? err.message : "Failed to send route.");
      }
    } finally {
      setIsSending(false);
    }
  }

  const distanceRemaining =
    localisation && plan && plan.points.length > 0
      ? Math.hypot(
          plan.points[plan.points.length - 1].x - localisation.x,
          plan.points[plan.points.length - 1].y - localisation.y,
        )
      : null;

  const validBeams: number[] = scan ? scan.ranges.filter((r): r is number => r !== null) : [];
  const closestRange = validBeams.length ? Math.min(...validBeams) : null;
  const farthestRange = validBeams.length ? Math.max(...validBeams) : null;

  return (
    <AppShell
      title="Route Planner"
      toolbar={
        <div className="hidden items-center gap-md md:flex">
          <SignalTag
            state={localisation ? "live" : "absent"}
            label={localisation ? "AMCL FIX" : "NO AMCL FIX"}
          />
        </div>
      }
    >
      <div className="mx-auto grid max-w-[1500px] lg:h-full grid-cols-1 gap-lg lg:grid-cols-[1fr_340px]">
        {/* ---- Left: the map ---- */}
        <div className="flex min-h-0 flex-col gap-lg">
          <Panel
            flush
            className="min-h-[360px] flex-1"
            title="Floor map"
            action={
              <>
                {selectedMap && <Chip>{selectedMap.name}</Chip>}
                <Button
                  variant={drawMode ? "primary" : "secondary"}
                  size="sm"
                  icon={<MapPin className="h-3.5 w-3.5" />}
                  onClick={() => {
                    setDrawMode((v) => !v);
                    setPendingWaypoint(null);
                  }}
                >
                  {drawMode ? "Click to place" : "Place waypoint"}
                </Button>
                <label className="flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-line bg-elevated px-3 font-sans text-[13px] font-medium text-ink transition-colors hover:border-faint/60">
                  <Upload className="h-3.5 w-3.5" />
                  {isUploading ? "Loading…" : "Upload"}
                  <input
                    type="file"
                    accept=".pgm,.png,.jpg,.jpeg"
                    onChange={handleUpload}
                    disabled={isUploading}
                    className="hidden"
                  />
                </label>
              </>
            }
          >
            {/* The canvas keeps its fixed internal resolution and scales to
                the panel, so the map fills the height the shell gives it
                rather than sitting in a fixed box with dead space below. */}
            <div className="flex min-h-0 flex-1 items-center justify-center p-sm">
              <canvas
                ref={canvasRef}
                width={CANVAS_WIDTH}
                height={CANVAS_HEIGHT}
                onClick={handleCanvasClick}
                onMouseMove={handleCanvasMouseMove}
                aria-label="Floor map — click to place waypoints"
                className={`max-h-full max-w-full rounded-md ${
                  drawMode ? "cursor-crosshair" : "cursor-default"
                }`}
              />
            </div>
            {loading && (
              <p className="flex-none px-lg pb-sm font-mono text-[11px] text-faint">Loading map…</p>
            )}
          </Panel>

          {maps.length > 1 && (
            <div className="flex flex-none flex-wrap items-center gap-2">
              <span className="font-sans text-label uppercase text-muted">
                Saved maps
              </span>
              {maps.map((m) => (
                <button
                  key={m.id}
                  onClick={() => selectMap(m)}
                  aria-pressed={selectedMap?.id === m.id}
                  className={`rounded-pill border px-3 py-1 font-sans text-[11px] font-medium transition-colors ${
                    selectedMap?.id === m.id
                      ? "border-coral/40 bg-coral/10 text-coral"
                      : "border-line text-muted hover:border-faint/60 hover:text-ink"
                  }`}
                >
                  {m.name}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* ---- Right: the route being built, then what the robot sees ---- */}
        <div className="flex min-h-0 flex-col gap-lg overflow-y-auto">
          <Panel
            className="flex-none"
            title="Route"
            action={<span className="font-mono text-[11px] text-faint">{waypoints.length} pts</span>}
          >
            {waypoints.length === 0 ? (
              <EmptyState
                icon={<MapPin className="h-6 w-6" />}
                title="No waypoints"
                description={'Choose "Place waypoint", then click the map twice — once for position, once for heading.'}
                className="py-lg"
              />
            ) : (
              <ol className="flex flex-col gap-1.5">
                {waypoints.map((wp, i) => (
                  <li
                    key={i}
                    className="flex items-center justify-between gap-2 rounded-md border border-line bg-raised px-3 py-2"
                  >
                    <span className="flex min-w-0 items-center gap-2.5">
                      <span className="flex h-5 w-5 flex-none items-center justify-center rounded-pill bg-coral/15 font-mono text-[11px] text-coral">
                        {i + 1}
                      </span>
                      <span className="truncate font-mono text-caption text-body">
                        {wp.x.toFixed(0)}, {wp.y.toFixed(0)}
                      </span>
                    </span>
                    <button
                      onClick={() => removeWaypoint(i)}
                      aria-label={`Remove ${wp.label}`}
                      className="flex-none text-faint transition-colors hover:text-fault-bright"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ol>
            )}

            {/* Dispatch is the one destructive-ish action on this page, so it
                gets the full-width primary and states its own blocker. */}
            <Button
              variant={eStopActive ? "danger" : "primary"}
              size="md"
              icon={<Send className="h-3.5 w-3.5" />}
              loading={isSending}
              disabled={waypoints.length === 0 || eStopActive}
              onClick={sendMission}
              block
              className="mt-md"
            >
              {eStopActive ? "Blocked — E-Stop active" : sentSuccess ? "Dispatched ✓" : "Dispatch route"}
            </Button>

            {eStopActive && (
              <p className="mt-2 font-sans text-caption text-fault-bright">
                Release the emergency stop before dispatching a route.
              </p>
            )}
          </Panel>

          <Panel
            className="flex-none"
            title="Scan"
            action={
              <>
                {/* The tag describes the DATA, the button controls the
                    subscription — they must not both say "off". */}
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
                  {scanUpdateOn ? "On" : "Off"}
                </button>
              </>
            }
          >
            <canvas
              ref={scanCanvasRef}
              width={SCAN_CANVAS_SIZE}
              height={SCAN_CANVAS_SIZE}
              className="mx-auto rounded-md"
              role="img"
              aria-label={scan ? `Lidar scan, ${validBeams.length} returns` : "Lidar scan, no data"}
            />
            <dl className="mt-md grid grid-cols-2 gap-x-md gap-y-2">
              <ScanFact label="Beams" value={scan ? `${validBeams.length}/${scan.ranges.length}` : null} />
              <ScanFact label="Frame" value={scan ? scan.frame_id : null} />
              <ScanFact label="Closest" value={closestRange !== null ? `${closestRange.toFixed(2)} m` : null} />
              <ScanFact label="Farthest" value={farthestRange !== null ? `${farthestRange.toFixed(2)} m` : null} />
            </dl>
          </Panel>

          <Panel title="Navigation" className="flex-none">
            <div className="flex flex-col gap-lg">
              <Readout
                label="Position"
                value={localisation ? `${localisation.x.toFixed(2)}, ${localisation.y.toFixed(2)}` : null}
                state={localisation ? "live" : "absent"}
                size="sm"
                icon={<Crosshair className="h-3.5 w-3.5" />}
              />
              <Readout
                label="Distance remaining"
                value={distanceRemaining !== null ? distanceRemaining.toFixed(2) : null}
                unit="m"
                state={distanceRemaining !== null ? "live" : "absent"}
                size="sm"
              />
            </div>
          </Panel>
        </div>
      </div>
    </AppShell>
  );
}

/** One label/value pair in the scan facts grid. Renders an em-dash, never a
 *  remembered value, when there is no scan. */
function ScanFact({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="min-w-0">
      <dt className="font-sans text-label uppercase text-muted">
        {label}
      </dt>
      <dd className={`truncate font-mono text-caption ${value ? "text-ink" : "text-faint"}`}>
        {value ?? "—"}
      </dd>
    </div>
  );
}
