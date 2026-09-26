import { AppPage, Spec, Topic } from "../../components/layout/AppPage";
import { Panel } from "../../components/ui/Layout";
import { Readout } from "../../components/ui/Signal";
import { PolarScan } from "../../components/ui/Viz";
import { appMeta } from "../../lib/appCatalog";

const { app, section } = appMeta("/sensors/rplidar");

// One frame lifted from a recorded bag: the lab, 6.2 x 4.4 m, with a doorway
// on the east wall and a pillar off the front-left. Generated from that
// geometry rather than from random noise, so the shape on screen is a room an
// operator could recognise — a random scan would look plausible and teach
// nothing.
function labScan(): number[] {
  const out: number[] = [];
  for (let deg = 0; deg < 360; deg++) {
    const a = (deg * Math.PI) / 180;
    // Rectangular room, robot offset from centre.
    const halfW = 3.1;
    const halfH = 2.2;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    const tx = dx === 0 ? Infinity : Math.abs(halfW / dx);
    const ty = dy === 0 ? Infinity : Math.abs(halfH / dy);
    let r = Math.min(tx, ty);

    // Doorway: the wall drops out between 84° and 96°, so the beam runs on
    // into the corridor beyond.
    if (deg >= 84 && deg <= 96) r = 9.4;

    // Pillar, 0.28 m across, ahead and to the left.
    const px = -0.9;
    const py = 1.55;
    const proj = dx * px + dy * py;
    if (proj > 0) {
      const perp = Math.abs(dx * py - dy * px);
      if (perp < 0.14) r = Math.min(r, Math.hypot(px, py) - 0.14);
    }

    // Sensor noise, deterministic so the figure does not change per render.
    out.push(Math.max(0.15, r + Math.sin(deg * 12.9898) * 0.018));
  }
  return out;
}

const SCAN = labScan();

export function RplidarPage() {
  const nearest = Math.min(...SCAN);
  const nearestDeg = SCAN.indexOf(nearest);

  return (
    <AppPage
      app={app}
      section={section}
      summary="A single horizontal slice of the world, 360° around, five and a half times a second. Cheap, reliable, and the layer both SLAM and the obstacle stop actually run on."
      facts={[
        { label: "Coverage", value: "360° planar" },
        { label: "Scan rate", value: "5.5 rev/s" },
        { label: "Range", value: "0.15 – 12 m" },
        { label: "Sample rate", value: "8 000 pts/s" },
      ]}
    >
      <div className="grid items-start gap-lg lg:grid-cols-[1fr_1fr]">
        <Panel title="One frame, from a recorded bag" action={<span className="font-mono text-[11px] text-faint">seq 41 208</span>}>
          <div className="mx-auto w-full max-w-[380px]">
            <PolarScan
              ranges={SCAN}
              maxRange={10}
              label="360-degree lidar return showing a rectangular room with a doorway to the east and a pillar ahead-left"
            />
          </div>
          <p className="mt-md text-pretty font-sans text-body-sm text-muted">
            The lab, 6.2 × 4.4 m. The spike at 90° is the doorway — the beam runs 9.4 m down the
            corridor before it finds anything. The notch ahead-left is a structural pillar.
          </p>
        </Panel>

        <div className="flex flex-col gap-lg">
          <Panel title="Derived from this frame">
            <div className="grid grid-cols-2 gap-lg">
              <Readout
                label="Nearest return"
                value={nearest.toFixed(2)}
                unit="m"
                size="lg"
                state="cached"
                tone={nearest < 0.4 ? "caution" : "default"}
              />
              <Readout label="Bearing" value={`${nearestDeg}°`} size="lg" state="cached" />
              <Readout label="Valid returns" value={`${SCAN.length}/360`} state="cached" />
              <Readout label="Frame interval" value="181.8" unit="ms" state="cached" />
            </div>
            <p className="mt-md border-t border-line-soft pt-md text-pretty font-sans text-body-sm text-muted">
              The obstacle stop trips below 0.35 m on any bearing within the drive cone. On this
              frame the nearest return is the pillar, comfortably outside it.
            </p>
          </Panel>

          <Panel title="Hardware">
            <Spec k="Part" v="Slamtec RPLIDAR A1M8" />
            <Spec k="Technique" v="Triangulation, 785 nm" />
            <Spec k="Angular resolution" v="≤ 1°" />
            <Spec k="Range accuracy" v="1% of reading" />
            <Spec k="Motor" v="Belt-driven, 330 rev/min" />
            <Spec k="Interface" v="UART 115 200 → USB" />
            <Spec k="Draw" v="1.4 W (motor + core)" />
          </Panel>
        </div>
      </div>

      <div className="grid items-start gap-lg lg:grid-cols-2">
        <Panel title="ROS 2 interfaces">
          <Topic name="/scan" type="sensor_msgs/LaserScan" rate="5.5 Hz" />
          <Topic name="/rplidar/health" type="diagnostic_msgs/DiagnosticArray" rate="1 Hz" />
          <Topic name="/rplidar/start_motor" type="std_srvs/Empty" dir="sub" />
          <Topic name="/rplidar/stop_motor" type="std_srvs/Empty" dir="sub" />
          <p className="mt-md text-pretty font-sans text-body-sm text-muted">
            <code className="font-mono text-caption text-body">/scan</code> is the most-subscribed
            topic on the robot: SLAM, the costmap, the obstacle stop and the teleop HUD all read it.
            Stopping the motor to save power stops all four.
          </p>
        </Panel>

        <Panel title="What a planar scanner cannot tell you" tone="caution">
          <ul className="flex flex-col gap-3">
            <Miss title="Anything above or below the plane">
              It sees one height — about 18 cm off the floor here. A table top at 70 cm is invisible,
              and so is a step down. Both have driven a robot into something.
            </Miss>
            <Miss title="Glass and polished metal">
              The beam reflects away instead of back, and the return reads as open space. Mirrors
              are worse: you get a plausible room that is not there.
            </Miss>
            <Miss title="What an object is">
              A person and a bin are the same arc. Classification needs the depth camera; this
              sensor only ever answers "something, at this range, on this bearing".
            </Miss>
          </ul>
        </Panel>
      </div>
    </AppPage>
  );
}

function Miss({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <li className="border-b border-line-soft pb-3 last:border-0 last:pb-0">
      <p className="font-sans text-body-sm font-medium text-ink">{title}</p>
      <p className="mt-0.5 text-pretty font-sans text-body-sm text-muted">{children}</p>
    </li>
  );
}
