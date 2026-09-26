import { ProjectTemplate } from "./ProjectTemplate";
import { Panel } from "../../components/ui/Layout";
import { appMeta } from "../../lib/appCatalog";

const { app, section } = appMeta("/projects/human-follower");

export function HumanFollowerPage() {
  return (
    <ProjectTemplate
      app={app}
      section={section}
      summary="Follows one specific person at a fixed standoff. The hard part is not following — it is deciding which person, and refusing to follow anyone else once that decision is made."
      facts={[
        { label: "Sensors", value: "Astra depth + /scan" },
        { label: "Standoff", value: "1.4 m" },
        { label: "Loop rate", value: "15 Hz" },
        { label: "Max speed", value: "0.42 m/s" },
      ]}
      stages={[
        { name: "Detect", detail: "MobileNet-SSD" },
        { name: "Re-ID", detail: "colour histogram" },
        { name: "Fuse", detail: "depth + lidar leg" },
        { name: "Standoff", detail: "PD on range" },
        { name: "Safety", detail: "gate → /cmd_vel" },
      ]}
      steps={[
        {
          title: "Detect people at 15 Hz, not 30",
          body: "MobileNet-SSD on the companion computer runs a person detector in about 55 ms. Halving the loop rate keeps CPU headroom for the safety layer, which must never be starved.",
        },
        {
          title: "Pick a target once, deliberately",
          body: "The operator presses follow while standing in the centre of the frame. That frame's colour histogram becomes the target signature — the robot does not choose a person on its own.",
        },
        {
          title: "Re-identify every frame against that signature",
          body: "Bhattacharyya distance under 0.35 keeps the lock. Above it the robot stops and waits rather than following the nearest person, which is the behaviour that matters in a corridor.",
        },
        {
          title: "Confirm with the lidar's leg pattern",
          body: "A person at 1.4 m produces two leg returns 0.15–0.45 m apart in /scan. Requiring that alongside the visual detection is what stops it following a poster or a mannequin.",
        },
        {
          title: "Hold the standoff, and stop early",
          body: "PD on range error with a 1.4 m setpoint. Below 0.9 m it publishes zero regardless of the controller — the hard floor sits under the loop, not inside it.",
        },
      ]}
      params={[
        { k: "Standoff setpoint", v: "1.4 m" },
        { k: "Hard stop", v: "0.9 m" },
        { k: "Detector confidence", v: "0.62" },
        { k: "Re-ID threshold", v: "0.35 Bhatt." },
        { k: "Leg-pair spacing", v: "0.15 – 0.45 m" },
        { k: "Kp (range)", v: "0.55" },
        { k: "Kd (range)", v: "0.12" },
        { k: "Lost-target timeout", v: "2.0 s" },
        { k: "Max speed", v: "0.42 m/s" },
      ]}
      metrics={[
        { label: "Standoff held", value: "1.38", unit: "m", tone: "nominal" },
        { label: "Standoff σ", value: "0.21", unit: "m" },
        { label: "Re-ID retained", value: "88.6", unit: "%", tone: "caution" },
        { label: "Hard stops", value: "3", tone: "caution" },
      ]}
      trace={{
        values: [1.9, 1.72, 1.55, 1.44, 1.39, 1.41, 1.37, 1.28, 1.12, 0.94, 1.18, 1.36, 1.42, 1.39, 1.4, 1.35, 1.44, 1.41, 1.38, 1.4],
        caption: "Range to target over one corridor run. The dip to 0.94 m is the subject stopping abruptly at a doorway — the hard stop fired and the robot recovered the standoff in 1.3 s.",
        tone: "text-nominal",
      }}
      extra={
        <Panel title="Why this one is different" tone="caution">
          <p className="text-pretty font-sans text-body-sm text-muted">
            This is the only project in the set that follows a person, which makes it the only one
            where a tracking failure has someone standing in front of it. Every parameter above is
            biased toward stopping: the hard floor ignores the controller, losing re-ID halts rather
            than re-targets, and the speed cap is below a walking pace on purpose. It should be dull
            to watch.
          </p>
        </Panel>
      }
      failures={[
        {
          title: "Two people in similar clothing",
          body: "A colour histogram is a weak signature. Two people in dark jackets sit under the 0.35 threshold of each other, and the lock transfers at a crossing. A proper re-ID embedding would fix it and costs 4× the compute.",
        },
        {
          title: "The subject turning around",
          body: "The histogram was captured from the front. A 180° turn changes it enough to drop the lock about one time in eight, which reads as the robot giving up for no reason.",
        },
        {
          title: "Following into a doorway",
          body: "The robot holds standoff, not clearance. It will follow someone through a gap narrower than itself and wedge. The costmap stops it hitting the frame, but nothing plans the approach.",
        },
      ]}
    />
  );
}
