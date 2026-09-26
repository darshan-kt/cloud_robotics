import { ProjectTemplate } from "./ProjectTemplate";
import { Panel } from "../../components/ui/Layout";
import { Spec } from "../../components/layout/AppPage";
import { appMeta } from "../../lib/appCatalog";

const { app, section } = appMeta("/projects/object-tracking");

export function ObjectTrackingPage() {
  return (
    <ProjectTemplate
      app={app}
      section={section}
      summary="Lock onto a coloured object, confirm it with depth, and rotate to keep it centred while it moves. Colour alone is not enough — the depth channel is what stops it chasing a poster of the target."
      facts={[
        { label: "Sensors", value: "Astra RGB + depth" },
        { label: "Loop rate", value: "30 Hz" },
        { label: "Lock range", value: "0.7 – 3.4 m" },
        { label: "Max yaw rate", value: "1.2 rad/s" },
      ]}
      stages={[
        { name: "HSV mask", detail: "hue ±12°" },
        { name: "Contours", detail: "largest blob" },
        { name: "Depth gate", detail: "reject flat" },
        { name: "Kalman", detail: "constant-velocity" },
        { name: "Yaw PD", detail: "→ /cmd_vel" },
      ]}
      steps={[
        {
          title: "Mask on hue, with a tolerance you measured",
          body: "±12° around the target hue, saturation above 0.35. The tolerance comes from photographing the object under all three lighting conditions in the lab, not from a guess.",
        },
        {
          title: "Take the largest contour, then check its shape",
          body: "Area over 900 px and an aspect ratio inside 0.6–1.7. This drops the long thin reflections that share the target's hue.",
        },
        {
          title: "Gate on depth variance — the step that matters",
          body: "A real object has depth that varies across its face; a printed image of it is flat to within a millimetre. Requiring a variance above 4 mm² is what makes the tracker ignore pictures, screens and reflections.",
        },
        {
          title: "Smooth with a constant-velocity Kalman filter",
          body: "Measurement noise on the blob centre is roughly 6 px. The filter carries the estimate through brief occlusion, so a hand passing in front does not reset the lock.",
        },
        {
          title: "Rotate only — never translate toward it",
          body: "This project deliberately does not drive at the target. Yaw-only means a tracking failure spins the robot in place instead of driving it into whatever it mistook for the object.",
        },
      ]}
      params={[
        { k: "Hue tolerance", v: "±12°" },
        { k: "Min saturation", v: "0.35" },
        { k: "Min contour area", v: "900 px" },
        { k: "Depth variance gate", v: "4.0 mm²" },
        { k: "Kalman process noise", v: "0.03" },
        { k: "Kalman meas. noise", v: "6.0 px" },
        { k: "Kp (yaw)", v: "0.0038" },
        { k: "Kd (yaw)", v: "0.0009" },
        { k: "Coast on loss", v: "0.6 s" },
      ]}
      metrics={[
        { label: "Lock acquired", value: "0.42", unit: "s" },
        { label: "Centre error", value: "17.4", unit: "px" },
        { label: "Lock held", value: "94.1", unit: "%", tone: "nominal" },
        { label: "False locks", value: "2", tone: "caution" },
      ]}
      trace={{
        values: [62, 41, 24, 18, 15, 17, 14, 19, 33, 47, 29, 16, 13, 15, 12, 18, 26, 21, 15, 14],
        caption: "Pixel error from frame centre while the target was walked around the bench. The hump at frame 9 is a partial occlusion the Kalman filter coasted through.",
        tone: "text-nominal",
      }}
      extra={
        <Panel title="Lock criteria">
          <Spec k="Hue match" v="within ±12°" />
          <Spec k="Area" v="> 900 px" />
          <Spec k="Aspect ratio" v="0.6 – 1.7" />
          <Spec k="Depth present" v="required" />
          <Spec k="Depth variance" v="> 4 mm²" />
          <p className="mt-sm text-pretty font-sans text-caption text-faint">
            All five must hold for three consecutive frames before the tracker declares a lock. One
            frame is enough to catch a passing reflection.
          </p>
        </Panel>
      }
      failures={[
        {
          title: "Two objects of the same colour",
          body: "The tracker takes the largest blob, so it swaps target whenever the second one gets closer. There is no identity here — it tracks a colour, not a thing.",
        },
        {
          title: "The two false locks",
          body: "Both were the orange safety cone by the door, at 4.2 m. Depth variance passed because the cone is genuinely 3-D; only the range gate would have rejected it, and it was set to 4 m at the time.",
        },
        {
          title: "Target under 0.7 m",
          body: "Inside the depth camera's dead zone the variance gate has nothing to read, so the lock drops even though the object fills the colour frame. This is the Astra's blind band, not a tracker bug.",
        },
      ]}
    />
  );
}
