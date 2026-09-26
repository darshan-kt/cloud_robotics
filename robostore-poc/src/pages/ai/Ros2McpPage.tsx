import { AppPage, Spec } from "../../components/layout/AppPage";
import { Chip, Panel } from "../../components/ui/Layout";
import { appMeta } from "../../lib/appCatalog";

const { app, section } = appMeta("/ai/driven/ros2-mcp");

// Tiering is the whole design. A model that can read the map and a model that
// can move the base are different risk propositions, and the boundary has to
// be mechanical — a broker/ACL decision, not a sentence in a system prompt.
const TOOLS = [
  { name: "get_robot_state", kind: "read", ros: "/robot_state · topic", tier: "observe" },
  { name: "get_scan_summary", kind: "read", ros: "/scan · topic", tier: "observe" },
  { name: "list_waypoints", kind: "read", ros: "/waypoints · service", tier: "observe" },
  { name: "get_battery", kind: "read", ros: "/battery_state · topic", tier: "observe" },
  { name: "plan_route", kind: "plan", ros: "nav2 ComputePath · action", tier: "propose" },
  { name: "estimate_duration", kind: "plan", ros: "local · computed", tier: "propose" },
  { name: "navigate_to_waypoint", kind: "act", ros: "nav2 NavigateToPose · action", tier: "commit" },
  { name: "dock", kind: "act", ros: "/dock · action", tier: "commit" },
  { name: "emergency_stop", kind: "act", ros: "/estop · service", tier: "always" },
];

const KIND_TONE: Record<string, "nominal" | "caution" | "fault" | "brand"> = {
  read: "nominal",
  plan: "brand",
  act: "fault",
};

export function Ros2McpPage() {
  return (
    <AppPage
      app={app}
      section={section}
      summary="A design for exposing the robot to a language model as typed, permissioned tools rather than a free-text command line. The interesting problem is not wiring MCP to ROS 2 — it is deciding what the model is allowed to call."
      facts={[
        { label: "Status", value: "Design draft" },
        { label: "Transport", value: "MCP over stdio" },
        { label: "Tools", value: "9 across 4 tiers" },
        { label: "Implemented", value: "none yet" },
      ]}
    >
      <Panel title="Proposed architecture" scroll>
        <div className="min-w-[640px]">
          <svg viewBox="0 0 660 230" role="img" aria-label="Architecture: language model calls an MCP server, which passes tool calls through a policy gate before they reach the ROS 2 graph; a hardware safety layer sits below and cannot be bypassed" className="block h-auto w-full">
            <title>Proposed MCP-to-ROS 2 architecture with a policy gate and an independent safety layer</title>
            <defs>
              <marker id="mcp-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
                <polygon points="0,0 10,5 0,10" className="fill-faint" />
              </marker>
            </defs>

            {[
              { x: 0, t: "Language model", s: "no ROS knowledge", cls: "fill-elevated stroke-line" },
              { x: 168, t: "MCP server", s: "typed tool schemas", cls: "fill-elevated stroke-line" },
              { x: 336, t: "Policy gate", s: "tier + rate + scope", cls: "fill-coral/10 stroke-coral" },
              { x: 504, t: "ROS 2 graph", s: "topics · services", cls: "fill-elevated stroke-line" },
            ].map((b, i) => (
              <g key={b.t}>
                <rect x={b.x} y="28" width="156" height="56" rx="7" className={b.cls} strokeWidth="1.4" />
                <text x={b.x + 78} y="52" textAnchor="middle" className="fill-ink font-sans text-[12px] font-medium">{b.t}</text>
                <text x={b.x + 78} y="68" textAnchor="middle" className="fill-faint font-mono text-[9px]">{b.s}</text>
                {i < 3 && (
                  <line x1={b.x + 158} y1="56" x2={b.x + 166} y2="56" className="stroke-faint" strokeWidth="1.4" markerEnd="url(#mcp-arrow)" />
                )}
              </g>
            ))}

            <line x1="414" y1="86" x2="414" y2="126" className="stroke-fault" strokeWidth="1.4" strokeDasharray="4 3" markerEnd="url(#mcp-arrow)" />
            <text x="424" y="110" className="fill-fault-bright font-mono text-[9px]">denied calls logged</text>

            <rect x="0" y="130" width="660" height="46" rx="7" className="fill-fault/10 stroke-fault/50" strokeWidth="1.4" />
            <text x="16" y="151" className="fill-ink font-sans text-[12px] font-medium">Hardware safety layer</text>
            <text x="16" y="167" className="fill-muted font-mono text-[9px]">watchdog · velocity envelope · physical e-stop — below the model, cannot be called by it</text>

            <text x="0" y="202" className="fill-muted font-sans text-[10px]">Every arrow above can fail. The band below is the only one that must not — which is why nothing in it is reachable from a tool call.</text>
            <text x="0" y="220" className="fill-faint font-mono text-[9px]">see /projects/human-follower for the same principle applied to a non-AI behaviour</text>
          </svg>
        </div>
      </Panel>

      <div className="grid items-start gap-lg lg:grid-cols-[1.3fr_1fr]">
        <Panel title="Proposed tool surface">
          <div className="flex flex-col">
            <div className="flex items-center gap-3 border-b border-line pb-2 font-sans text-label uppercase text-faint">
              <span className="w-[42px] flex-none">Kind</span>
              <span className="flex-1">Tool</span>
              <span className="hidden flex-1 sm:block">ROS 2 target</span>
              <span className="w-[62px] flex-none text-right">Tier</span>
            </div>
            {TOOLS.map((t) => (
              <div key={t.name} className="flex items-center gap-3 border-b border-line-soft py-2 last:border-0">
                <span className="w-[42px] flex-none">
                  <Chip tone={KIND_TONE[t.kind]}>{t.kind}</Chip>
                </span>
                <code className="min-w-0 flex-1 truncate font-mono text-body-sm text-ink">{t.name}</code>
                <span className="hidden min-w-0 flex-1 truncate font-mono text-caption text-faint sm:block">{t.ros}</span>
                <span className="w-[62px] flex-none text-right font-mono text-caption text-muted">{t.tier}</span>
              </div>
            ))}
          </div>
        </Panel>

        <div className="flex flex-col gap-lg">
          <Panel title="Permission tiers">
            <Spec k="observe" v="no approval" />
            <Spec k="propose" v="no approval, no effect" />
            <Spec k="commit" v="operator confirms" />
            <Spec k="always" v="stop only, never gated" />
            <p className="mt-sm text-pretty font-sans text-body-sm text-muted">
              <code className="font-mono text-caption">emergency_stop</code> sits in its own tier
              because it is the one call that must never be rate-limited, queued or refused. A gate
              that can block a stop is a worse failure than one that lets a bad move through.
            </p>
          </Panel>

          <Panel title="Deliberately not exposed" tone="caution">
            <ul className="flex flex-col gap-2 font-sans text-body-sm text-muted">
              <li>— Raw <code className="font-mono text-caption">/cmd_vel</code>. Velocity is not a decision a model should make directly; it may only name a destination.</li>
              <li>— Parameter setters. Retuning a PID gain at runtime is a maintenance action with no safe rollback.</li>
              <li>— Anything that writes the map. A corrupted map is silent until the robot is somewhere unexpected.</li>
              <li>— The camera stream. Bandwidth aside, this robot may operate near people, and frames leaving the site is a decision for a human.</li>
            </ul>
          </Panel>
        </div>
      </div>

      <Panel title="Open questions" tone="caution">
        <div className="grid gap-lg sm:grid-cols-3">
          <Open title="Who is the operator?">
            <code className="font-mono text-caption">commit</code> needs a human to confirm. If the
            model is running unattended overnight on the patrol schedule, there is nobody to ask — so
            either the tier is unavailable then, or the schedule pre-authorises a named route.
          </Open>
          <Open title="What does the model see on failure?">
            Returning a raw ROS error invites retry loops. Returning nothing invites confident
            hallucination about what happened. Neither is settled.
          </Open>
          <Open title="Prompt injection through sensors">
            A tool that returns text the robot read off a sign is untrusted input reaching the model.
            No design here treats sensor returns as hostile yet, and it should.
          </Open>
        </div>
      </Panel>
    </AppPage>
  );
}

function Open({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="font-sans text-body-sm font-medium text-ink">{title}</p>
      <p className="mt-1 text-pretty font-sans text-body-sm text-muted">{children}</p>
    </div>
  );
}
