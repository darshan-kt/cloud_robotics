import { ProjectTemplate } from "./ProjectTemplate";
import { appMeta } from "../../lib/appCatalog";

const { app, section } = appMeta("/projects/line-following");

export function LineFollowingPage() {
  return (
    <ProjectTemplate
      app={app}
      section={section}
      summary="Threshold a stripe on the floor, find its centroid, and steer to put that centroid in the middle of the frame. The simplest closed loop on the platform, and the one that teaches the most about tuning."
      facts={[
        { label: "Sensor", value: "Astra RGB only" },
        { label: "Loop rate", value: "30 Hz" },
        { label: "Controller", value: "PID on centroid" },
        { label: "Top speed", value: "0.34 m/s" },
      ]}
      stages={[
        { name: "Crop", detail: "bottom 120 rows" },
        { name: "Threshold", detail: "HSV, V < 0.28" },
        { name: "Centroid", detail: "image moments" },
        { name: "PID", detail: "error → ω" },
        { name: "Publish", detail: "/cmd_vel" },
      ]}
      steps={[
        {
          title: "Look only where the line can be",
          body: "The top of the frame is metres ahead and mostly noise. Cropping to the bottom 120 rows cuts the work by 75% and removes most false positives in one line of code.",
        },
        {
          title: "Threshold in HSV, not RGB",
          body: "Value alone separates dark tape from light floor under changing brightness. RGB thresholds that work at noon fail under the afternoon window.",
        },
        {
          title: "Take the centroid, not the edges",
          body: "First-order image moments give a sub-pixel centre that degrades gracefully when the stripe is partly occluded. Edge-finding jumps to the wrong edge and the robot snaps sideways.",
        },
        {
          title: "PID on the horizontal error",
          body: "Error is centroid_x minus frame centre, in pixels. P turns, D damps the weave, I is left at zero — on a line follower it mostly winds up and overshoots corners.",
        },
        {
          title: "Stop when the line is gone",
          body: "Below 400 lit pixels the loop publishes zero velocity rather than steering on its last estimate. Guessing at a vanished line is how these robots drive into walls.",
        },
      ]}
      params={[
        { k: "Kp", v: "0.0042" },
        { k: "Ki", v: "0.0" },
        { k: "Kd", v: "0.0011" },
        { k: "Linear velocity", v: "0.34 m/s" },
        { k: "ω clamp", v: "±1.8 rad/s" },
        { k: "Value threshold", v: "0.28" },
        { k: "Min blob area", v: "400 px" },
        { k: "Lost-line timeout", v: "0.4 s" },
      ]}
      metrics={[
        { label: "Lap time", value: "48.3", unit: "s" },
        { label: "Mean error", value: "11.7", unit: "px" },
        { label: "Worst error", value: "63", unit: "px", tone: "caution" },
        { label: "Laps completed", value: "24/25", tone: "caution" },
      ]}
      trace={{
        values: [8, 12, 9, 14, 22, 41, 63, 38, 19, 11, 9, 13, 10, 8, 12, 27, 44, 26, 14, 9],
        caption: "Horizontal error across one lap. The two spikes are the 90° corners, where the stripe leaves the crop window before the turn completes.",
        tone: "text-caution",
      }}
      failures={[
        {
          title: "Corners tighter than the crop window",
          body: "At 90° the stripe exits the bottom 120 rows before the robot has turned into it. The fix is not more gain — it is slowing to 0.18 m/s on high error, or looking higher up the frame.",
        },
        {
          title: "Glare on polished floor",
          body: "A specular highlight thresholds identically to tape. The lab's window strip at 15:00 reliably produces a phantom second line, and the centroid sits between the two.",
        },
        {
          title: "The one lap it lost",
          body: "Run 17 crossed a floor expansion joint that thresholded dark. The centroid jumped 140 px, the D term slammed ω to the clamp, and it left the line. Rejecting jumps over 80 px would have caught it.",
        },
      ]}
    />
  );
}
