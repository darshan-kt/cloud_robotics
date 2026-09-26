import type { ComponentType } from "react";
import {
  Brain,
  Camera,
  Compass,
  Crosshair,
  Equal,
  FlaskConical,
  Gamepad2,
  Gauge,
  MessageSquareCode,
  Network,
  OctagonX,
  PersonStanding,
  Radar,
  RadioTower,
  Route as RouteIcon,
  Sigma,
  SlidersHorizontal,
  Spline,
  TrendingDown,
  Waves,
  Waypoints,
} from "lucide-react";

// ---------------------------------------------------------------------------
// The app catalog — one source of truth for the whole information architecture.
//
// The rail, every section deck, and the route table in App.tsx are all derived
// from this array. The previous shell hardcoded its five rail items in
// AppShell.tsx and its four tiles again in AppStorePage.tsx, so adding an app
// meant editing three files and hoping they agreed. With seventeen apps across
// four sections that stops being viable: one of the three copies drifts, and
// the rail ends up pointing at a route the deck doesn't list.
//
// Shape: SECTION -> GROUP -> APP. Most sections have a single unnamed group,
// which renders as a plain tile grid. "AI & Robotics" has two named groups,
// which render as labelled bands — that nesting is the only reason `groups`
// exists rather than a flat `apps` array.
// ---------------------------------------------------------------------------

export type Icon = ComponentType<{ className?: string }>;

export interface AppDef {
  id: string;
  /** Tile heading and command-bar title. Sentence case. */
  title: string;
  /** What it does, in an operator's words — not marketing copy. */
  blurb: string;
  route: string;
  icon: Icon;
  /** Only the E-stop is allowed a colour, because only it is a safety control. */
  safety?: boolean;
  /**
   * Honest provenance label for the tile footer. Nothing in this POC streams
   * from a robot, so these say what is actually true — a spec sheet, a stored
   * model, a recorded bag — never "LIVE".
   */
  signal: string;
}

export interface AppGroup {
  id: string;
  /** Omitted for single-group sections, which render as a bare grid. */
  title?: string;
  description?: string;
  apps: AppDef[];
}

export interface SectionDef {
  id: string;
  /** Rail label. Two short words at most — the rail is 72px wide. */
  railLabel: string;
  /** Deck page heading. */
  title: string;
  eyebrow: string;
  description: string;
  route: string;
  icon: Icon;
  groups: AppGroup[];
}

export const SECTIONS: SectionDef[] = [
  // -- 1. Robot control ----------------------------------------------------
  {
    id: "control",
    railLabel: "Control",
    title: "Robot control",
    eyebrow: "Operator tools",
    description:
      "The four tools that drive the vehicle. Everything here talks to the robot directly, so everything here can move it.",
    route: "/control",
    icon: SlidersHorizontal,
    groups: [
      {
        id: "control-apps",
        apps: [
          {
            id: "dashboard",
            title: "Dashboard",
            blurb: "Vitals, sensor health, drive configuration and the ROS 2 runtime.",
            route: "/dashboard",
            icon: Gauge,
            signal: "SPEC + CACHE",
          },
          {
            id: "remote-control",
            title: "Remote control",
            blurb: "Direct drive with a live lidar HUD, speed caps and actuator control.",
            route: "/remote-controller",
            icon: Gamepad2,
            signal: "NEEDS LINK",
          },
          {
            id: "route-planner",
            title: "Route planner",
            blurb: "Place waypoints on the floor map and dispatch a navigation goal.",
            route: "/simple-route-planner",
            icon: RouteIcon,
            signal: "STORED MAPS",
          },
          {
            id: "emergency-stop",
            title: "Emergency stop",
            blurb: "Latching halt with a full trigger and release audit log.",
            route: "/emergency-stop",
            icon: OctagonX,
            safety: true,
            signal: "ARMED",
          },
        ],
      },
    ],
  },

  // -- 2. Robot sensors ----------------------------------------------------
  {
    id: "sensors",
    railLabel: "Sensors",
    title: "Robot sensors",
    eyebrow: "Perception hardware",
    description:
      "One page per sensor on the platform: what it measures, what it publishes, and what it costs you in bandwidth and compute.",
    route: "/sensors",
    icon: RadioTower,
    groups: [
      {
        id: "sensor-apps",
        apps: [
          {
            id: "astra",
            title: "Orbbec Astra",
            blurb: "Structured-light depth camera. Registered RGB-D at 30 fps, 0.6–8 m.",
            route: "/sensors/astra",
            icon: Camera,
            signal: "SPEC SHEET",
          },
          {
            id: "rplidar",
            title: "RPLIDAR A1",
            blurb: "360° planar scanner, 5.5 rev/s. The layer SLAM and obstacle stops run on.",
            route: "/sensors/rplidar",
            icon: Radar,
            signal: "RECORDED BAG",
          },
          {
            id: "imu",
            title: "9-DOF IMU",
            blurb: "BNO055 accel, gyro and magnetometer with on-chip sensor fusion.",
            route: "/sensors/imu",
            icon: Compass,
            signal: "RECORDED BAG",
          },
          {
            id: "ultrasonic",
            title: "Ultrasonic array",
            blurb: "Four HC-SR04 rangefinders covering the lidar's blind band below 150 mm.",
            route: "/sensors/ultrasonic",
            icon: Waves,
            signal: "SPEC SHEET",
          },
        ],
      },
    ],
  },

  // -- 3. Robotics projects ------------------------------------------------
  {
    id: "projects",
    railLabel: "Projects",
    title: "Robotics projects",
    eyebrow: "Behaviour packages",
    description:
      "Autonomous behaviours you can load onto the platform. Each one is a state machine over the same sensor set — the difference is what it decides to do with it.",
    route: "/projects",
    icon: FlaskConical,
    groups: [
      {
        id: "project-apps",
        apps: [
          {
            id: "line-following",
            title: "Line follower",
            blurb: "PID on the centroid of a thresholded floor stripe. The classic first build.",
            route: "/projects/line-following",
            icon: Spline,
            signal: "BENCH RESULTS",
          },
          {
            id: "object-tracking",
            title: "Object tracker",
            blurb: "Locks a colour-and-depth blob and keeps it centred while it moves.",
            route: "/projects/object-tracking",
            icon: Crosshair,
            signal: "BENCH RESULTS",
          },
          {
            id: "human-follower",
            title: "Human follower",
            blurb: "Follows one person at a set standoff, and stops when that person turns.",
            route: "/projects/human-follower",
            icon: PersonStanding,
            signal: "BENCH RESULTS",
          },
          {
            id: "patrolling",
            title: "Patrol loop",
            blurb: "Repeats a waypoint circuit on a schedule and reports what changed.",
            route: "/projects/patrolling",
            icon: Waypoints,
            signal: "BENCH RESULTS",
          },
        ],
      },
    ],
  },

  // -- 4. AI & robotics ----------------------------------------------------
  {
    id: "ai",
    railLabel: "AI",
    title: "AI & robotics",
    eyebrow: "Models and reasoning",
    description:
      "The maths under the autonomy, and the newer work putting a language model in the loop. Reference material, not a control surface — nothing on these pages can move the robot.",
    route: "/ai",
    icon: Brain,
    groups: [
      {
        id: "distributions",
        title: "Statistical distributions",
        description:
          "Every estimator on this platform assumes a noise model. These are the three that actually appear in its code, with the place each one is used.",
        apps: [
          {
            id: "uniform",
            title: "Uniform",
            blurb: "Equal density across a bounded interval. The honest prior when you know nothing.",
            route: "/ai/distributions/uniform",
            icon: Equal,
            signal: "REFERENCE",
          },
          {
            id: "exponential",
            title: "Exponential",
            blurb: "Waiting time between independent events. Memoryless, and that matters.",
            route: "/ai/distributions/exponential",
            icon: TrendingDown,
            signal: "REFERENCE",
          },
          {
            id: "normal",
            title: "Normal (Gaussian)",
            blurb: "The sensor-noise workhorse. What every Kalman filter on board assumes.",
            route: "/ai/distributions/normal",
            icon: Sigma,
            signal: "REFERENCE",
          },
        ],
      },
      {
        id: "ai-driven",
        title: "AI driven robot",
        description:
          "Work in progress: exposing the robot to a language model as a set of typed, permissioned tools rather than a free-text command line.",
        apps: [
          {
            id: "ros2-mcp",
            title: "ROS 2 MCP design",
            blurb: "Wrapping topics, services and actions as MCP tools a model may call.",
            route: "/ai/driven/ros2-mcp",
            icon: Network,
            signal: "DESIGN DRAFT",
          },
          {
            id: "prompting",
            title: "Prompting robotics",
            blurb: "Prompt patterns that survive contact with a machine that can hurt someone.",
            route: "/ai/driven/prompting",
            icon: MessageSquareCode,
            signal: "DESIGN DRAFT",
          },
        ],
      },
    ],
  },
];

// ---- derived lookups ------------------------------------------------------

/** Every app, flattened — used for the route table and for title lookup. */
export const ALL_APPS: AppDef[] = SECTIONS.flatMap((s) => s.groups.flatMap((g) => g.apps));

/** Total installed count, shown on the rail's home deck. */
export const APP_COUNT = ALL_APPS.length;

export function sectionByRoute(route: string): SectionDef | undefined {
  return SECTIONS.find((s) => s.route === route);
}

/** Which section owns a given app route — drives the rail's active state. */
export function sectionForApp(appRoute: string): SectionDef | undefined {
  return SECTIONS.find((s) => s.groups.some((g) => g.apps.some((a) => a.route === appRoute)));
}


/**
 * Resolve a route to its app + owning section. Every reference page calls this
 * once at module scope, so a typo'd route fails loudly at import time rather
 * than rendering a page with a blank header.
 */
export function appMeta(route: string): { app: AppDef; section: SectionDef } {
  const section = sectionForApp(route);
  const app = ALL_APPS.find((a) => a.route === route);
  if (!section || !app) throw new Error(`appCatalog: no app registered at "${route}"`);
  return { app, section };
}
