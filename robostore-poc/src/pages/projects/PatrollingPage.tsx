import { ProjectTemplate } from "./ProjectTemplate";
import { Panel } from "../../components/ui/Layout";
import { Spec } from "../../components/layout/AppPage";
import { appMeta } from "../../lib/appCatalog";

const { app, section } = appMeta("/projects/patrolling");

export function PatrollingPage() {
  return (
    <ProjectTemplate
      app={app}
      section={section}
      summary="Drives a fixed waypoint circuit on a schedule and reports what is different from last time. The autonomy is ordinary Nav2 — the interesting part is deciding what counts as a change worth waking someone for."
      facts={[
        { label: "Waypoints", value: "7 per circuit" },
        { label: "Circuit", value: "182 m · 9.4 min" },
        { label: "Stack", value: "Nav2 + AMCL" },
        { label: "Schedule", value: "hourly, 06:00–22:00" },
      ]}
      stages={[
        { name: "Localise", detail: "AMCL on /scan" },
        { name: "Plan", detail: "Nav2 to next wp" },
        { name: "Observe", detail: "RGB-D at wp" },
        { name: "Diff", detail: "vs baseline" },
        { name: "Report", detail: "MQTT event" },
      ]}
      steps={[
        {
          title: "Confirm localisation before moving",
          body: "AMCL covariance under 0.25 m² or the circuit does not start. A patrol that begins lost visits seven wrong places and reports confidently about all of them.",
        },
        {
          title: "Drive waypoint to waypoint under Nav2",
          body: "Nothing custom here. The behaviour tree handles recovery, and a waypoint that fails twice is skipped and logged rather than retried forever.",
        },
        {
          title: "Stop, settle, then observe",
          body: "A 1.5 s pause at each waypoint. Motion blur and rolling shutter make a moving observation useless for comparison, and the settle costs 10 s per circuit.",
        },
        {
          title: "Compare against the waypoint's baseline",
          body: "Each waypoint stores a reference RGB-D frame captured at commissioning. The diff is structural — depth histogram distance — rather than pixel-wise, so lighting changes do not fire it.",
        },
        {
          title: "Report only what crosses the threshold",
          body: "A change score over 0.18 raises an event with the before and after frames attached. Below that it goes in the log and nobody is woken.",
        },
      ]}
      params={[
        { k: "Waypoints", v: "7" },
        { k: "Settle time", v: "1.5 s" },
        { k: "AMCL cov. gate", v: "0.25 m²" },
        { k: "Nav2 xy tolerance", v: "0.22 m" },
        { k: "Nav2 yaw tolerance", v: "0.18 rad" },
        { k: "Change threshold", v: "0.18" },
        { k: "Retries per waypoint", v: "2" },
        { k: "Cruise speed", v: "0.38 m/s" },
      ]}
      metrics={[
        { label: "Circuits completed", value: "41/43", tone: "caution" },
        { label: "Mean circuit", value: "9.4", unit: "min" },
        { label: "Changes flagged", value: "6" },
        { label: "False positives", value: "2", tone: "caution" },
      ]}
      trace={{
        values: [9.2, 9.4, 9.3, 9.5, 9.4, 9.3, 9.6, 11.8, 9.5, 9.4, 9.3, 9.4, 9.7, 9.4, 9.3, 9.5, 10.9, 9.4, 9.3, 9.4],
        caption: "Circuit duration over 20 consecutive runs. The two long runs are Nav2 recoveries at waypoint 4, where a propped-open fire door narrows the corridor to 0.8 m.",
        tone: "text-coral",
      }}
      extra={
        <Panel title="Circuit">
          <Spec k="WP1" v="Loading bay · 0.0 m" />
          <Spec k="WP2" v="East corridor · 24 m" />
          <Spec k="WP3" v="Server room door · 51 m" />
          <Spec k="WP4" v="Fire door · 78 m" />
          <Spec k="WP5" v="North stair · 106 m" />
          <Spec k="WP6" v="Workshop · 139 m" />
          <Spec k="WP7" v="Return dock · 182 m" />
        </Panel>
      }
      failures={[
        {
          title: "The two abandoned circuits",
          body: "Both were AMCL divergence in the east corridor, which is 24 m of featureless wall — the particle filter has nothing to correct against and drifts until the covariance gate trips at WP3.",
        },
        {
          title: "Baselines that age",
          body: "A commissioning frame taken in winter fires against the same scene in summer once the light changes enough. Baselines need periodic recapture, and nothing does that automatically yet.",
        },
        {
          title: "Predictability",
          body: "An hourly patrol on a fixed route is trivially avoidable by anyone who watches it once. Randomised intervals and reversed circuits are the obvious answer, and neither is implemented.",
        },
      ]}
    />
  );
}
