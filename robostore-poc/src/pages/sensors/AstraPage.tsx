import { AppPage, Spec, Topic } from "../../components/layout/AppPage";
import { Panel } from "../../components/ui/Layout";
import { DepthFrustum } from "../../components/ui/Viz";
import { appMeta } from "../../lib/appCatalog";

const { app, section } = appMeta("/sensors/astra");

// Structured light: the projector throws a known speckle pattern, the IR
// camera sees how it deforms, and depth falls out of the disparity. Every
// limitation on this page follows from that one sentence.
export function AstraPage() {
  return (
    <AppPage
      app={app}
      section={section}
      summary="The platform's only source of dense 3-D structure. It sees shape, not just range — which is what makes object and person tracking possible at all."
      facts={[
        { label: "Depth", value: "640×480 · 30 fps" },
        { label: "Colour", value: "640×480 · 30 fps" },
        { label: "Working range", value: "0.6 – 8.0 m" },
        { label: "Field of view", value: "60° × 49.5°" },
      ]}
    >
      <div className="grid items-start gap-lg lg:grid-cols-[1.4fr_1fr]">
        <Panel title="Depth envelope, side elevation">
          <DepthFrustum
            minM={0.6}
            sweetM={3.5}
            maxM={8}
            fovDeg={49.5}
            label="Depth camera envelope: dead zone below 0.6 m, calibrated band to 3.5 m, degraded return to 8 m"
          />
          <div className="mt-md grid grid-cols-3 gap-md border-t border-line-soft pt-md">
            <LegendItem swatch="bg-fault/40" title="Blind">
              Under 0.6 m the pattern is out of focus. This band is why the ultrasonic array exists.
            </LegendItem>
            <LegendItem swatch="bg-nominal/40" title="Calibrated">
              0.6–3.5 m. Depth error stays under ~1.2 cm. Do tracking work here.
            </LegendItem>
            <LegendItem swatch="bg-caution/40" title="Degraded">
              Past 3.5 m error grows with the square of range; at 8 m it is ±8 cm and holes appear.
            </LegendItem>
          </div>
        </Panel>

        <Panel title="Hardware">
          <Spec k="Part" v="Orbbec Astra" />
          <Spec k="Technique" v="Structured light (IR)" />
          <Spec k="Depth sensor" v="1/6″ CMOS" />
          <Spec k="Baseline" v="75 mm" />
          <Spec k="Depth error @ 1 m" v="±1.1 mm" />
          <Spec k="Depth error @ 4 m" v="±18 mm" />
          <Spec k="Latency" v="~33 ms" />
          <Spec k="Bus" v="USB 2.0 · 480 Mbit/s" />
          <Spec k="Draw" v="2.4 W typical" />
        </Panel>
      </div>

      <div className="grid items-start gap-lg lg:grid-cols-2">
        <Panel title="ROS 2 interfaces">
          <Topic name="/camera/color/image_raw" type="sensor_msgs/Image" rate="30 Hz" />
          <Topic name="/camera/depth/image_raw" type="sensor_msgs/Image" rate="30 Hz" />
          <Topic name="/camera/depth/points" type="sensor_msgs/PointCloud2" rate="30 Hz" />
          <Topic name="/camera/color/camera_info" type="sensor_msgs/CameraInfo" rate="30 Hz" />
          <Topic name="/camera/set_exposure" type="orbbec_camera/SetInt32" dir="sub" />
          <p className="mt-md text-pretty font-sans text-body-sm text-muted">
            The point cloud is the expensive one — roughly 37 MB/s uncompressed. On the companion
            computer it is published only when a subscriber is attached, which is why the tracking
            projects subscribe on demand rather than leaving it running.
          </p>
        </Panel>

        <Panel title="Where it fails" tone="caution">
          <ul className="flex flex-col gap-3">
            <Fail title="Direct sunlight">
              Sun swamps the IR projector. Outdoors in daylight the depth image is mostly holes,
              and no amount of exposure tuning recovers it.
            </Fail>
            <Fail title="Glass, gloss and dark matte">
              Specular surfaces bounce the pattern away; very dark surfaces absorb it. Both return
              zero, which reads identically to "nothing there" — a glass door looks like open floor.
            </Fail>
            <Fail title="Thin structures">
              Chair legs and cable runs fall between speckles and disappear. The lidar catches
              these, which is the practical argument for keeping both sensors.
            </Fail>
          </ul>
        </Panel>
      </div>
    </AppPage>
  );
}

function LegendItem({ swatch, title, children }: { swatch: string; title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="flex items-center gap-2 font-sans text-label uppercase text-muted">
        <span className={`h-2 w-2 flex-none rounded-sm ${swatch}`} />
        {title}
      </span>
      <p className="text-pretty font-sans text-caption text-faint">{children}</p>
    </div>
  );
}

function Fail({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <li className="border-b border-line-soft pb-3 last:border-0 last:pb-0">
      <p className="font-sans text-body-sm font-medium text-ink">{title}</p>
      <p className="mt-0.5 text-pretty font-sans text-body-sm text-muted">{children}</p>
    </li>
  );
}
