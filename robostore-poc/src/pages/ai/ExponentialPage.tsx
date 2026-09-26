import { DistributionTemplate } from "./DistributionTemplate";
import { appMeta } from "../../lib/appCatalog";

const { app, section } = appMeta("/ai/distributions/exponential");
const LAMBDA = 0.8;

export function ExponentialPage() {
  return (
    <DistributionTemplate
      app={app}
      section={section}
      summary="The waiting time until the next independent event. Memoryless — having waited ten minutes tells you nothing about how much longer you will wait, which is either exactly right or badly wrong depending on what you are modelling."
      facts={[
        { label: "Parameter", value: "λ (rate)" },
        { label: "Mean", value: "1 / λ" },
        { label: "Variance", value: "1 / λ²" },
        { label: "Property", value: "memoryless" },
      ]}
      pdf={(x) => (x < 0 ? 0 : LAMBDA * Math.exp(-LAMBDA * x))}
      domain={[0, 7]}
      markers={[
        { x: 1 / LAMBDA, label: "μ = 1.25" },
        { x: Math.LN2 / LAMBDA, label: "median" },
      ]}
      xLabel="t (s)"
      formula="f(t) = λ · e^(−λt)   for t ≥ 0"
      support="[0, ∞)"
      params={[
        { k: "λ (rate)", v: "0.80 events/s" },
        { k: "Mean wait", v: "1.25 s" },
        { k: "Median wait", v: "0.87 s" },
      ]}
      moments={[
        { label: "Mean", value: "1.250" },
        { label: "Variance", value: "1.563" },
        { label: "Std dev", value: "1.250" },
        { label: "Median", value: "0.866" },
      ]}
      usedFor={{
        where: "gateway reconnect backoff",
        body: (
          <>
            <p>
              The console's reconnecting socket draws its retry jitter from an exponential. When a
              gateway drops, every connected browser would otherwise retry on the same schedule and
              arrive together — a thundering herd against a service that is already struggling.
            </p>
            <p className="mt-3">
              It also models time-between-faults in the reliability figures: obstacle-stop triggers
              on the patrol route arrive at an average of one per 1.25 minutes of driving, and
              treating them as a Poisson process with exponential gaps is what lets the schedule
              account for them.
            </p>
          </>
        ),
      }}
      breaks={{
        body: (
          <>
            <p>
              Memorylessness is the assumption that fails. It says a component that has run for a
              year is exactly as likely to fail in the next hour as a new one — which is true for
              electronics in their flat mid-life, and false for anything that wears. Belt-driven
              parts like the lidar motor do wear, so an exponential model of their failures is
              optimistic in exactly the period you care about.
            </p>
            <p className="mt-3">
              Using it for the wrong quantity is the other trap. Battery discharge is not
              exponential waiting; it is a curve with a knee. Fitting λ to it produces a remaining-
              time estimate that looks plausible at 80% and is badly wrong at 15%.
            </p>
          </>
        ),
      }}
      sampling={`# numpy — note numpy takes scale = 1/λ
t = rng.exponential(scale=1/0.8, size=n)

# inverse transform, if you only have uniforms
t = -math.log(1.0 - u) / 0.8`}
    />
  );
}
