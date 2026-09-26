import type { ReactNode } from "react";

// ---------------------------------------------------------------------------
// Domain visualisations.
//
// Every one of these is hand-authored SVG driven by the theme tokens — no
// charting dependency, because adding one to draw six static figures would be
// a poor trade, and because a chart library's defaults (its own palette, its
// own type scale) would fight the design system rather than use it.
//
// House rules, same as the rest of the kit:
//   - Colour comes from `currentColor` on a token class, so a figure inherits
//     whatever semantic colour its container declares. No hex literals.
//   - Nothing animates on a loop. index.css documents why ambient motion was
//     removed from a safety console; a decorative figure is not a reason to
//     put it back.
//   - Every figure carries a <title> so it is not a blank hole to a screen
//     reader.
// ---------------------------------------------------------------------------

function Figure({
  label,
  viewBox,
  className = "",
  children,
}: {
  label: string;
  viewBox: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <svg
      viewBox={viewBox}
      role="img"
      aria-label={label}
      className={`block h-auto w-full ${className}`}
      preserveAspectRatio="xMidYMid meet"
    >
      <title>{label}</title>
      {children}
    </svg>
  );
}

// ---- Curve ----------------------------------------------------------------
// A plotted probability density, with axes and a filled area. Used by the
// three distribution pages; `fn` is the real PDF, evaluated here rather than
// approximated with a hand-drawn path.

export interface CurveMarker {
  x: number;
  label: string;
  /** Dashed verticals read as "a parameter", solid as "a measured value". */
  dashed?: boolean;
}

export function Curve({
  fn,
  domain,
  markers = [],
  xLabel,
  yLabel = "density",
  label,
  samples = 240,
}: {
  fn: (x: number) => number;
  domain: [number, number];
  markers?: CurveMarker[];
  xLabel: string;
  yLabel?: string;
  label: string;
  samples?: number;
}) {
  const W = 520;
  const H = 210;
  const PAD = { l: 38, r: 14, t: 14, b: 30 };
  const plotW = W - PAD.l - PAD.r;
  const plotH = H - PAD.t - PAD.b;

  const [x0, x1] = domain;
  const pts: Array<[number, number]> = [];
  for (let i = 0; i <= samples; i++) {
    const x = x0 + ((x1 - x0) * i) / samples;
    pts.push([x, Math.max(0, fn(x))]);
  }
  const yMax = Math.max(...pts.map((p) => p[1])) || 1;

  const sx = (x: number) => PAD.l + ((x - x0) / (x1 - x0)) * plotW;
  const sy = (y: number) => PAD.t + plotH - (y / (yMax * 1.12)) * plotH;

  const line = pts.map(([x, y]) => `${sx(x).toFixed(2)},${sy(y).toFixed(2)}`).join(" ");
  const area = `${sx(x0)},${PAD.t + plotH} ${line} ${sx(x1)},${PAD.t + plotH}`;

  // Four horizontal guides, so the eye can judge relative height.
  const guides = [0.25, 0.5, 0.75, 1].map((f) => PAD.t + plotH - f * plotH);

  return (
    <Figure label={label} viewBox={`0 0 ${W} ${H}`} className="text-coral">
      {guides.map((y, i) => (
        <line
          key={i}
          x1={PAD.l}
          x2={W - PAD.r}
          y1={y}
          y2={y}
          className="stroke-line-soft"
          strokeWidth="1"
        />
      ))}

      <polygon points={area} fill="currentColor" opacity="0.13" />
      <polyline points={line} fill="none" stroke="currentColor" strokeWidth="2" />

      {markers.map((m) => (
        <g key={m.label}>
          <line
            x1={sx(m.x)}
            x2={sx(m.x)}
            y1={PAD.t}
            y2={PAD.t + plotH}
            className="stroke-faint"
            strokeWidth="1"
            strokeDasharray={m.dashed === false ? undefined : "4 3"}
          />
          <text
            x={sx(m.x)}
            y={PAD.t - 3}
            textAnchor="middle"
            className="fill-muted font-mono text-[9px]"
          >
            {m.label}
          </text>
        </g>
      ))}

      {/* axes */}
      <line
        x1={PAD.l}
        x2={W - PAD.r}
        y1={PAD.t + plotH}
        y2={PAD.t + plotH}
        className="stroke-line"
        strokeWidth="1"
      />
      <line x1={PAD.l} x2={PAD.l} y1={PAD.t} y2={PAD.t + plotH} className="stroke-line" strokeWidth="1" />
      <text x={W - PAD.r} y={H - 8} textAnchor="end" className="fill-faint font-mono text-[9px]">
        {xLabel}
      </text>
      <text
        x={PAD.l - 6}
        y={PAD.t + 8}
        textAnchor="end"
        className="fill-faint font-mono text-[9px]"
      >
        {yLabel}
      </text>
    </Figure>
  );
}

// ---- PolarScan ------------------------------------------------------------
// A 360° planar lidar return. `ranges` is one reading per degree, in metres.

export function PolarScan({
  ranges,
  maxRange,
  label,
}: {
  ranges: number[];
  maxRange: number;
  label: string;
}) {
  const S = 260;
  const c = S / 2;
  const R = c - 22;

  const pts = ranges
    .map((r, i) => {
      const a = (i / ranges.length) * Math.PI * 2 - Math.PI / 2;
      const d = (Math.min(r, maxRange) / maxRange) * R;
      return `${(c + Math.cos(a) * d).toFixed(1)},${(c + Math.sin(a) * d).toFixed(1)}`;
    })
    .join(" ");

  const rings = [0.25, 0.5, 0.75, 1];

  return (
    <Figure label={label} viewBox={`0 0 ${S} ${S}`} className="text-nominal">
      {rings.map((f) => (
        <circle
          key={f}
          cx={c}
          cy={c}
          r={R * f}
          fill="none"
          className={f === 1 ? "stroke-line" : "stroke-line-soft"}
          strokeWidth="1"
        />
      ))}
      {[0, 45, 90, 135].map((deg) => {
        const a = (deg * Math.PI) / 180;
        return (
          <line
            key={deg}
            x1={c - Math.cos(a) * R}
            y1={c - Math.sin(a) * R}
            x2={c + Math.cos(a) * R}
            y2={c + Math.sin(a) * R}
            className="stroke-line-soft"
            strokeWidth="1"
          />
        );
      })}

      <polygon points={pts} fill="currentColor" opacity="0.16" />
      <polyline points={`${pts} ${pts.split(" ")[0]}`} fill="none" stroke="currentColor" strokeWidth="1.5" />

      {/* the vehicle, and its heading */}
      <circle cx={c} cy={c} r="3.5" className="fill-coral" />
      <line x1={c} y1={c} x2={c} y2={c - 16} className="stroke-coral" strokeWidth="1.5" />

      {rings.map((f) => (
        <text
          key={`t${f}`}
          x={c + 3}
          y={c - R * f + 9}
          className="fill-faint font-mono text-[8px]"
        >
          {(maxRange * f).toFixed(1)}m
        </text>
      ))}
      <text x={c} y={14} textAnchor="middle" className="fill-muted font-mono text-[9px]">
        0°
      </text>
    </Figure>
  );
}

// ---- AxisBars -------------------------------------------------------------
// Signed three-axis bars from a centre line. Used for IMU accel / gyro / mag.

export function AxisBars({
  axes,
  range,
  unit,
  label,
}: {
  axes: Array<{ name: string; value: number }>;
  /** Symmetric full-scale, e.g. 4 for ±4 g. */
  range: number;
  unit: string;
  label: string;
}) {
  const W = 260;
  const rowH = 34;
  const H = axes.length * rowH + 14;
  const left = 22;
  const right = W - 56;
  const mid = (left + right) / 2;
  const half = (right - left) / 2;

  return (
    <Figure label={label} viewBox={`0 0 ${W} ${H}`} className="text-coral">
      <line x1={mid} y1={6} x2={mid} y2={H - 8} className="stroke-line" strokeWidth="1" />
      {axes.map((a, i) => {
        const y = 10 + i * rowH;
        const clamped = Math.max(-range, Math.min(range, a.value));
        const w = (Math.abs(clamped) / range) * half;
        return (
          <g key={a.name}>
            <text x={4} y={y + 13} className="fill-muted font-mono text-[10px]">
              {a.name}
            </text>
            <rect x={left} y={y + 4} width={right - left} height="10" rx="2" className="fill-elevated" />
            <rect
              x={clamped < 0 ? mid - w : mid}
              y={y + 4}
              width={Math.max(w, 1.5)}
              height="10"
              rx="2"
              fill="currentColor"
            />
            <text x={right + 5} y={y + 13} className="fill-body font-mono text-[10px]">
              {a.value > 0 ? "+" : ""}
              {a.value.toFixed(2)}
            </text>
          </g>
        );
      })}
      <text x={left} y={H - 1} className="fill-faint font-mono text-[8px]">
        −{range} {unit}
      </text>
      <text x={right} y={H - 1} textAnchor="end" className="fill-faint font-mono text-[8px]">
        +{range} {unit}
      </text>
    </Figure>
  );
}

// ---- RangeCone ------------------------------------------------------------
// A rangefinder's beam cone with the current echo drawn across it.

export function RangeCone({
  beamDeg,
  distance,
  maxRange,
  label,
}: {
  beamDeg: number;
  /** metres; null renders the cone with no echo, which is the honest empty state */
  distance: number | null;
  maxRange: number;
  label: string;
}) {
  const W = 240;
  const H = 150;
  const apexX = W / 2;
  const apexY = H - 16;
  const reach = H - 34;
  const half = ((beamDeg / 2) * Math.PI) / 180;

  const edge = (sign: number, len: number) => ({
    x: apexX + Math.sin(half) * sign * len,
    y: apexY - Math.cos(half) * len,
  });
  const l = edge(-1, reach);
  const r = edge(1, reach);

  const hit = distance == null ? null : Math.min(distance, maxRange) / maxRange;
  const hl = hit == null ? null : edge(-1, reach * hit);
  const hr = hit == null ? null : edge(1, reach * hit);

  return (
    <Figure label={label} viewBox={`0 0 ${W} ${H}`} className="text-caution">
      <path
        d={`M ${apexX} ${apexY} L ${l.x} ${l.y} A ${reach} ${reach} 0 0 1 ${r.x} ${r.y} Z`}
        className="fill-elevated stroke-line"
        strokeWidth="1"
      />
      {hit != null && hl && hr && (
        <>
          <path
            d={`M ${apexX} ${apexY} L ${hl.x} ${hl.y} A ${reach * hit} ${reach * hit} 0 0 1 ${hr.x} ${hr.y} Z`}
            fill="currentColor"
            opacity="0.2"
          />
          <path
            d={`M ${hl.x} ${hl.y} A ${reach * hit} ${reach * hit} 0 0 1 ${hr.x} ${hr.y}`}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          />
        </>
      )}
      <circle cx={apexX} cy={apexY} r="4" className="fill-coral" />
      <text x={apexX} y={H - 2} textAnchor="middle" className="fill-faint font-mono text-[8px]">
        {beamDeg}° beam
      </text>
    </Figure>
  );
}

// ---- Pipeline -------------------------------------------------------------
// A left-to-right processing chain. Used by the four project pages, where the
// thing worth showing is the order of operations, not a number.

export function Pipeline({
  stages,
  label,
}: {
  stages: Array<{ name: string; detail: string }>;
  label: string;
}) {
  const boxW = 118;
  const gap = 26;
  const W = stages.length * boxW + (stages.length - 1) * gap;
  const H = 76;

  return (
    <Figure label={label} viewBox={`0 0 ${W} ${H}`} className="text-coral">
      <defs>
        <marker id="viz-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
          <polygon points="0,0 10,5 0,10" className="fill-faint" />
        </marker>
      </defs>
      {stages.map((s, i) => {
        const x = i * (boxW + gap);
        return (
          <g key={s.name}>
            <rect
              x={x}
              y="10"
              width={boxW}
              height="46"
              rx="6"
              className="fill-elevated stroke-line"
              strokeWidth="1"
            />
            <text x={x + boxW / 2} y="30" textAnchor="middle" className="fill-ink font-sans text-[11px] font-medium">
              {s.name}
            </text>
            <text x={x + boxW / 2} y="45" textAnchor="middle" className="fill-faint font-mono text-[8.5px]">
              {s.detail}
            </text>
            {i < stages.length - 1 && (
              <line
                x1={x + boxW + 4}
                y1="33"
                x2={x + boxW + gap - 5}
                y2="33"
                className="stroke-faint"
                strokeWidth="1.4"
                markerEnd="url(#viz-arrow)"
              />
            )}
          </g>
        );
      })}
    </Figure>
  );
}

// ---- Sparkline ------------------------------------------------------------

export function Sparkline({
  values,
  label,
  tone = "text-nominal",
}: {
  values: number[];
  label: string;
  tone?: string;
}) {
  const W = 200;
  const H = 44;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values
    .map((v, i) => `${((i / (values.length - 1)) * W).toFixed(1)},${(H - 4 - ((v - min) / span) * (H - 10)).toFixed(1)}`)
    .join(" ");
  const last = values[values.length - 1];

  return (
    <Figure label={label} viewBox={`0 0 ${W} ${H}`} className={tone}>
      <polygon points={`0,${H} ${pts} ${W},${H}`} fill="currentColor" opacity="0.12" />
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.5" />
      <circle
        cx={W}
        cy={H - 4 - ((last - min) / span) * (H - 10)}
        r="2.5"
        fill="currentColor"
      />
    </Figure>
  );
}

// ---- DepthFrustum ---------------------------------------------------------
// Side elevation of a depth camera's usable envelope: the dead zone it cannot
// see, the calibrated band, and the falloff beyond it.

export function DepthFrustum({
  minM,
  sweetM,
  maxM,
  fovDeg,
  label,
}: {
  minM: number;
  sweetM: number;
  maxM: number;
  fovDeg: number;
  label: string;
}) {
  const W = 420;
  const H = 150;
  const apexX = 26;
  const apexY = H / 2;
  const scale = (W - apexX - 30) / maxM;
  const half = ((fovDeg / 2) * Math.PI) / 180;
  const spread = (d: number) => Math.tan(half) * d * scale;

  const band = (a: number, b: number) =>
    `M ${apexX + a * scale} ${apexY - spread(a)} L ${apexX + b * scale} ${apexY - spread(b)} ` +
    `L ${apexX + b * scale} ${apexY + spread(b)} L ${apexX + a * scale} ${apexY + spread(a)} Z`;

  return (
    <Figure label={label} viewBox={`0 0 ${W} ${H}`} className="text-nominal">
      <path d={band(0, minM)} className="fill-fault/15 stroke-fault/40" strokeWidth="1" />
      <path d={band(minM, sweetM)} fill="currentColor" opacity="0.18" />
      <path d={band(sweetM, maxM)} className="fill-caution/12 stroke-caution/30" strokeWidth="1" />

      <path
        d={`M ${apexX} ${apexY} L ${apexX + maxM * scale} ${apexY - spread(maxM)}`}
        className="stroke-line"
        strokeWidth="1"
      />
      <path
        d={`M ${apexX} ${apexY} L ${apexX + maxM * scale} ${apexY + spread(maxM)}`}
        className="stroke-line"
        strokeWidth="1"
      />

      <circle cx={apexX} cy={apexY} r="4" className="fill-coral" />

      {[
        { d: minM, t: `${minM} m`, cls: "fill-fault-bright" },
        { d: sweetM, t: `${sweetM} m`, cls: "fill-nominal" },
        { d: maxM, t: `${maxM} m`, cls: "fill-caution" },
      ].map((m) => (
        <g key={m.t}>
          <line
            x1={apexX + m.d * scale}
            y1={apexY - spread(m.d)}
            x2={apexX + m.d * scale}
            y2={apexY + spread(m.d)}
            className="stroke-line"
            strokeWidth="1"
            strokeDasharray="3 3"
          />
          <text x={apexX + m.d * scale} y={H - 4} textAnchor="middle" className={`${m.cls} font-mono text-[9px]`}>
            {m.t}
          </text>
        </g>
      ))}
      <text x={apexX - 4} y={apexY - 8} textAnchor="end" className="fill-faint font-mono text-[8px]">
        {fovDeg}°
      </text>
    </Figure>
  );
}
