import { useEffect, useRef, useState, type ComponentType, type MouseEvent } from "react";
import { useNavigate } from "react-router-dom";
import { LayoutDashboard, OctagonX, Route, Smartphone } from "lucide-react";
import { Header } from "../components/layout/Header";
import { Badge, Skeleton } from "../components/ui/Layout";

interface AppDef {
  id: string;
  title: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
  theme: "emerald" | "rose" | "purple" | "amber";
  glow: string; // "r, g, b" for the --glow custom property
  tag: string;
  version: string;
  route: string;
}

const APPS: AppDef[] = [
  {
    id: "dashboard",
    title: "Dashboard",
    description: "Robot vitals, sensors, live configuration and the ROS 2 runtime, all in one console.",
    icon: LayoutDashboard,
    theme: "emerald",
    glow: "0, 229, 160",
    tag: "Core",
    version: "v0.1.0",
    route: "/dashboard",
  },
  {
    id: "emergency-stop",
    title: "Emergency Stop",
    description: "One-press physical-style E-Stop with a full trigger/release history log.",
    icon: OctagonX,
    theme: "rose",
    glow: "255, 77, 106",
    tag: "Safety",
    version: "v0.1.0",
    route: "/emergency-stop",
  },
  {
    id: "remote-controller",
    title: "Remote Controller",
    description: "Joystick + WASD teleop with a live LIDAR radar HUD and speed limits.",
    icon: Smartphone,
    theme: "purple",
    glow: "168, 85, 247",
    tag: "Manual",
    version: "v0.1.0",
    route: "/remote-controller",
  },
  {
    id: "simple-route-planner",
    title: "Simple Route Planner",
    description: "Click-to-place waypoints on the map and dispatch a navigation route.",
    icon: Route,
    theme: "amber",
    glow: "245, 158, 11",
    tag: "Planning",
    version: "v0.1.0",
    route: "/simple-route-planner",
  },
];

const TICKER_ITEMS = [
  "ALL SYSTEMS NOMINAL",
  "ROS 2 HUMBLE",
  "DDS DOMAIN 0",
  "MQTT LINK STABLE",
  "GATEWAY: STANDBY",
  "OPERATOR SESSION ACTIVE",
];

function useClock(): string {
  const [time, setTime] = useState(() => new Date());
  useEffect(() => {
    const interval = window.setInterval(() => setTime(new Date()), 1000);
    return () => window.clearInterval(interval);
  }, []);
  return time.toISOString().slice(11, 19);
}

const MOTES = Array.from({ length: 10 }, (_, i) => ({
  left: `${(i * 37 + 5) % 100}%`,
  top: `${(i * 53 + 12) % 100}%`,
  delay: `${(i % 5) * 0.7}s`,
  duration: `${6 + (i % 4)}s`,
}));

export function AppStorePage() {
  const clock = useClock();

  return (
    <div className="relative min-h-screen overflow-hidden">
      <Header />

      {/* Ambient background */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-24 -top-24 h-96 w-96 animate-pulse-gentle rounded-full bg-emerald-500/20 blur-3xl" />
        <div
          className="absolute -bottom-24 -right-24 h-96 w-96 animate-pulse-gentle rounded-full bg-purple-500/20 blur-3xl"
          style={{ animationDelay: "1.5s" }}
        />
        <div className="hub-grid-floor" />
        {MOTES.map((mote, i) => (
          <span
            key={i}
            className="absolute h-1 w-1 animate-pulse-gentle rounded-full bg-accent/60"
            style={{ left: mote.left, top: mote.top, animationDelay: mote.delay, animationDuration: mote.duration }}
          />
        ))}
      </div>

      <main className="relative mx-auto max-w-6xl px-4 pb-20 pt-10">
        {/* Hero */}
        <div className="mb-10 animate-fade-up">
          <p className="mb-3 font-mono text-xs uppercase tracking-widest text-textMuted">
            <span className="text-accent">●</span> Mission deck · UTC {clock} · OPERATOR SESSION
          </p>
          <h1 className="hub-gradient-text font-mono text-3xl font-bold tracking-tight sm:text-4xl">
            Choose your tool
            <span className="hub-cursor text-accent">_</span>
          </h1>
          <p className="mt-3 max-w-xl text-sm text-textMuted">
            Four apps, one robot. Launch a tool below to take the deck.
          </p>
        </div>

        {/* Status ticker */}
        <div className="mb-10 overflow-hidden rounded-full border border-border/50 bg-surface/60 py-2">
          <div className="hub-ticker-track">
            {[...TICKER_ITEMS, ...TICKER_ITEMS].map((item, i) => (
              <span
                key={i}
                className="flex items-center gap-2 whitespace-nowrap px-6 font-mono text-[11px] uppercase tracking-widest text-textDim"
              >
                <span className="h-1 w-1 rounded-full bg-accent" />
                {item}
              </span>
            ))}
          </div>
        </div>

        {/* App grid */}
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
          {APPS.map((app, i) => (
            <AppCard key={app.id} app={app} index={i} />
          ))}
        </div>
      </main>
    </div>
  );
}

function AppCard({ app, index }: { app: AppDef; index: number }) {
  const navigate = useNavigate();
  const [loaded, setLoaded] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Purely cosmetic loading simulation, staggered per card.
    const timer = window.setTimeout(() => setLoaded(true), 800 + index * 120);
    return () => window.clearTimeout(timer);
  }, [index]);

  function handleMouseMove(event: MouseEvent<HTMLDivElement>) {
    const el = cardRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const rotateY = ((x / rect.width) - 0.5) * 10;
    const rotateX = ((y / rect.height) - 0.5) * -10;
    el.style.setProperty("--mx", `${x}px`);
    el.style.setProperty("--my", `${y}px`);
    el.style.transform = `perspective(700px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateY(-4px)`;
  }

  function handleMouseLeave() {
    const el = cardRef.current;
    if (!el) return;
    el.style.transform = "perspective(700px) rotateX(0deg) rotateY(0deg) translateY(0)";
  }

  function launch() {
    navigate(app.route);
  }

  if (!loaded) {
    return (
      <div className="rounded-2xl border border-border/50 bg-surface p-5">
        <Skeleton className="mb-4 h-10 w-10 rounded-xl" />
        <Skeleton className="mb-2 h-4 w-2/3" />
        <Skeleton className="mb-4 h-3 w-full" />
        <Skeleton className="h-3 w-1/3" />
      </div>
    );
  }

  const Icon = app.icon;

  return (
    <div
      ref={cardRef}
      role="button"
      tabIndex={0}
      onClick={launch}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          launch();
        }
      }}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      className={`hub-card animate-fade-up stagger-${Math.min(index + 1, 5)} group relative cursor-pointer overflow-hidden rounded-2xl border border-border/50 bg-surface p-5 outline-none focus-visible:ring-2 focus-visible:ring-accent`}
      style={{ ["--glow" as string]: app.glow }}
    >
      <span className="pointer-events-none absolute right-3 top-2 font-mono text-4xl font-bold text-white/5">
        {String(index + 1).padStart(2, "0")}
      </span>

      <div className="relative flex h-full flex-col">
        <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-white/5">
          <Icon className="h-5 w-5 text-text" />
          <span
            className="absolute h-1.5 w-1.5 rounded-full opacity-0 transition-opacity group-hover:opacity-100"
            style={{ background: `rgb(${app.glow})`, transform: "translate(14px, -14px)" }}
          />
        </div>

        <div className="mb-1 flex items-center gap-2">
          <h2 className="font-mono text-sm font-semibold text-text">{app.title}</h2>
          <Badge theme={app.theme}>{app.tag}</Badge>
        </div>

        <p className="mb-4 flex-1 text-xs leading-relaxed text-textMuted">{app.description}</p>

        <div className="flex items-center justify-between">
          <span className="font-mono text-[10px] text-textDim">{app.version}</span>
          <span className="flex items-center gap-1 font-mono text-[11px] font-medium text-text transition-transform group-hover:translate-x-0.5">
            LAUNCH <span className="transition-transform group-hover:translate-x-1">→</span>
          </span>
        </div>
      </div>
    </div>
  );
}
