import { AppPage, Spec, Topic } from "../../components/layout/AppPage";
import { Panel } from "../../components/ui/Layout";
import { Readout } from "../../components/ui/Signal";
import { RangeCone } from "../../components/ui/Viz";
import { appMeta } from "../../lib/appCatalog";

const { app, section } = appMeta("/sensors/ultrasonic");

// Four transducers on the front bumper. The two outer ones are angled 30° out
// so the array covers the full chassis width at bumper height, where the
// lidar plane cannot see.
const ARRAY = [
  { id: "FL", bearing: "-30°", distance: 0.42 },
  { id: "FC", bearing: "0°", distance: 1.17 },
  { id: "FR", bearing: "+30°", distance: 2.38 },
  { id: "RC", bearing: "180°", distance: null },
];

export function UltrasonicPage() {
  return (
    <AppPage
      app={app}
      section={section}
      summary="Four cheap transducers doing one job the expensive sensors cannot: seeing the 15 cm of floor directly in front of the bumper, below the lidar plane and inside the depth camera's blind zone."
      facts={[
        { label: "Transducers", value: "4 × HC-SR04" },
        { label: "Range", value: "0.02 – 4.0 m" },
        { label: "Beam", value: "15° cone" },
        { label: "Ping rate", value: "12 Hz round-robin" },
      ]}
    >
      <div className="grid items-start gap-lg lg:grid-cols-[1.3fr_1fr]">
        <Panel title="Array returns">
          <div className="grid grid-cols-2 gap-lg sm:grid-cols-4">
            {ARRAY.map((s) => (
              <div key={s.id} className="flex flex-col items-center gap-2">
                <RangeCone
                  beamDeg={15}
                  distance={s.distance}
                  maxRange={4}
                  label={`${s.id} transducer at ${s.bearing}: ${s.distance == null ? "no echo" : `${s.distance} metres`}`}
                />
                <Readout
                  label={`${s.id} · ${s.bearing}`}
                  value={s.distance == null ? null : s.distance.toFixed(2)}
                  unit="m"
                  state={s.distance == null ? "absent" : "cached"}
                  tone={s.distance != null && s.distance < 0.5 ? "caution" : "default"}
                  className="items-center text-center"
                />
              </div>
            ))}
          </div>
          <p className="mt-md border-t border-line-soft pt-md text-pretty font-sans text-body-sm text-muted">
            RC has no echo. That is not a fault — a rear transducer pointing down an empty corridor
            gets nothing back inside its 23 ms window, and the driver reports absence rather than
            the 4 m ceiling. The distinction matters: a stale 4 m reads as "clear".
          </p>
        </Panel>

        <div className="flex flex-col gap-lg">
          <Panel title="Hardware">
            <Spec k="Part" v="HC-SR04 ×4" />
            <Spec k="Frequency" v="40 kHz" />
            <Spec k="Resolution" v="3 mm" />
            <Spec k="Trigger pulse" v="10 µs TTL" />
            <Spec k="Echo window" v="23 ms" />
            <Spec k="Interface" v="GPIO via RP2040" />
            <Spec k="Draw" v="0.075 W (all four)" />
          </Panel>

          <Panel title="Why round-robin">
            <p className="text-pretty font-sans text-body-sm text-muted">
              Fired together, transducer FL hears FC's ping and reports a target that is not there —
              classic crosstalk. The RP2040 fires them in sequence with a 6 ms guard, which caps the
              array at 12 Hz but makes every reading attributable to one emitter.
            </p>
          </Panel>
        </div>
      </div>

      <div className="grid items-start gap-lg lg:grid-cols-2">
        <Panel title="ROS 2 interfaces">
          <Topic name="/ultrasonic/fl" type="sensor_msgs/Range" rate="12 Hz" />
          <Topic name="/ultrasonic/fc" type="sensor_msgs/Range" rate="12 Hz" />
          <Topic name="/ultrasonic/fr" type="sensor_msgs/Range" rate="12 Hz" />
          <Topic name="/ultrasonic/rc" type="sensor_msgs/Range" rate="12 Hz" />
          <p className="mt-md text-pretty font-sans text-body-sm text-muted">
            <code className="font-mono text-caption text-body">sensor_msgs/Range</code> carries the
            cone angle in the message, so the costmap inflates each return across its real 15°
            rather than treating it as a point.
          </p>
        </Panel>

        <Panel title="What it is bad at" tone="caution">
          <ul className="flex flex-col gap-3">
            <Bad title="Soft and angled surfaces">
              Fabric, foam and anything past about 45° scatter the pulse instead of returning it.
              A person in a wool coat can read as open floor.
            </Bad>
            <Bad title="Telling two things apart">
              The cone returns the nearest echo in a 15° spread and nothing else. Two obstacles
              80 mm apart at 2 m are one reading.
            </Bad>
            <Bad title="Air it has not been told about">
              Speed of sound moves roughly 0.17% per °C. The driver compensates from the IMU's
              temperature; without that, a cold corridor reads long.
            </Bad>
          </ul>
        </Panel>
      </div>
    </AppPage>
  );
}

function Bad({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <li className="border-b border-line-soft pb-3 last:border-0 last:pb-0">
      <p className="font-sans text-body-sm font-medium text-ink">{title}</p>
      <p className="mt-0.5 text-pretty font-sans text-body-sm text-muted">{children}</p>
    </li>
  );
}
