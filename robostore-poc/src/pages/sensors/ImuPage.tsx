import { AppPage, Step, Topic } from "../../components/layout/AppPage";
import { Chip, Panel } from "../../components/ui/Layout";
import { Readout } from "../../components/ui/Signal";
import { AxisBars } from "../../components/ui/Viz";
import { appMeta } from "../../lib/appCatalog";

const { app, section } = appMeta("/sensors/imu");

// One sample from the same recorded bag as the lidar page: the robot is
// stationary and level, so accel should read ~1 g on Z and the rest near
// zero. Showing the resting case is deliberate — it is the case an operator
// can sanity-check by eye, and a drifting gyro shows up here first.
const ACCEL = [
  { name: "X", value: 0.04 },
  { name: "Y", value: -0.07 },
  { name: "Z", value: 9.79 },
];
const GYRO = [
  { name: "X", value: 0.11 },
  { name: "Y", value: -0.06 },
  { name: "Z", value: 0.02 },
];
const MAG = [
  { name: "X", value: 21.4 },
  { name: "Y", value: -8.9 },
  { name: "Z", value: -43.6 },
];

export function ImuPage() {
  return (
    <AppPage
      app={app}
      section={section}
      summary="Nine axes at 100 Hz, fused on-chip into an orientation. It is what keeps odometry honest between wheel slips, and what tells the safety layer the robot is tipping."
      facts={[
        { label: "Part", value: "Bosch BNO055" },
        { label: "Fusion output", value: "100 Hz" },
        { label: "Accel range", value: "±4 g" },
        { label: "Gyro range", value: "±2000 °/s" },
      ]}
    >
      <div className="grid items-start gap-lg lg:grid-cols-3">
        <Panel
          title="Accelerometer"
          action={<span className="font-mono text-caption text-faint">m/s²</span>}
        >
          <AxisBars axes={ACCEL} range={12} unit="m/s²" label="Accelerometer: X 0.04, Y -0.07, Z 9.79 metres per second squared" />
          <p className="mt-sm text-pretty font-sans text-caption text-faint">
            Stationary and level: gravity sits almost entirely on Z. X and Y under ±0.1 is a good
            mounting.
          </p>
        </Panel>

        <Panel title="Gyroscope" action={<span className="font-mono text-caption text-faint">°/s</span>}>
          <AxisBars axes={GYRO} range={4} unit="°/s" label="Gyroscope: X 0.11, Y -0.06, Z 0.02 degrees per second" />
          <p className="mt-sm text-pretty font-sans text-caption text-faint">
            This is bias, not motion — the robot is still. Left uncorrected it integrates into about
            6° of yaw drift per minute.
          </p>
        </Panel>

        <Panel title="Magnetometer" action={<span className="font-mono text-caption text-faint">µT</span>}>
          <AxisBars axes={MAG} range={60} unit="µT" label="Magnetometer: X 21.4, Y -8.9, Z -43.6 microtesla" />
          <p className="mt-sm text-pretty font-sans text-caption text-faint">
            Magnitude 49.8 µT, close to Earth's field here. A reading far off that means something
            ferrous is nearby and heading is not trustworthy.
          </p>
        </Panel>
      </div>

      <div className="grid items-start gap-lg lg:grid-cols-[1fr_1.2fr]">
        <Panel
          title="Fused orientation"
          action={<Chip tone="caution">calib 2/3</Chip>}
        >
          <div className="grid grid-cols-3 gap-lg">
            <Readout label="Roll" value="0.8" unit="°" size="lg" state="cached" />
            <Readout label="Pitch" value="-1.4" unit="°" size="lg" state="cached" />
            <Readout label="Yaw" value="137.2" unit="°" size="lg" state="cached" />
          </div>
          <p className="mt-md border-t border-line-soft pt-md text-pretty font-sans text-body-sm text-muted">
            The chip reports calibration per subsystem, 0–3. Gyro and accel are fully calibrated
            here; the magnetometer is at 2, which is why yaw is usable for relative turns but not
            yet trusted as an absolute heading.
          </p>
        </Panel>

        <Panel title="Bring-up procedure">
          <ol className="flex flex-col gap-3">
            <Step n={1} title="Leave it still for 8 s at power-on">
              The gyro bias estimate is taken during this window. Moving the robot through it bakes
              the motion into the bias and every heading afterwards is wrong.
            </Step>
            <Step n={2} title="Figure-eight the chassis for the magnetometer">
              Two slow figure-eights in the air, away from the frame. Watch the calibration byte
              reach 3 before trusting absolute yaw.
            </Step>
            <Step n={3} title="Check gravity lands on Z">
              Level ground, Z within 9.75–9.85 m/s². If it does not, the mount is skewed and every
              tilt estimate inherits the error.
            </Step>
            <Step n={4} title="Confirm the fusion rate">
              <code className="font-mono text-caption">ros2 topic hz /imu/data</code> should hold
              near 100 Hz. Dropping to 50 usually means the I²C bus is shared and contended.
            </Step>
          </ol>
        </Panel>
      </div>

      <Panel title="ROS 2 interfaces">
        <div className="grid gap-x-xl gap-y-0 lg:grid-cols-2">
          <div>
            <Topic name="/imu/data" type="sensor_msgs/Imu" rate="100 Hz" />
            <Topic name="/imu/mag" type="sensor_msgs/MagneticField" rate="20 Hz" />
            <Topic name="/imu/temperature" type="sensor_msgs/Temperature" rate="1 Hz" />
          </div>
          <div>
            <Topic name="/imu/calib_status" type="diagnostic_msgs/DiagnosticArray" rate="1 Hz" />
            <Topic name="/imu/reset" type="std_srvs/Trigger" dir="sub" />
            <Topic name="/imu/save_calib" type="std_srvs/Trigger" dir="sub" />
          </div>
        </div>
      </Panel>
    </AppPage>
  );
}
