import { DistributionTemplate } from "./DistributionTemplate";
import { appMeta } from "../../lib/appCatalog";

const { app, section } = appMeta("/ai/distributions/uniform");
const A = -1.5;
const B = 1.5;

export function UniformPage() {
  return (
    <DistributionTemplate
      app={app}
      section={section}
      summary="Every value in the interval is equally likely, and everything outside it is impossible. The distribution you use when you genuinely know the bounds and nothing else."
      facts={[
        { label: "Parameters", value: "a, b" },
        { label: "Mean", value: "(a + b) / 2" },
        { label: "Variance", value: "(b − a)² / 12" },
        { label: "Entropy", value: "maximal, bounded" },
      ]}
      pdf={(x) => (x >= A && x <= B ? 1 / (B - A) : 0)}
      domain={[-2.4, 2.4]}
      markers={[
        { x: A, label: "a" },
        { x: B, label: "b" },
      ]}
      xLabel="x (m)"
      formula="f(x) = 1 / (b − a)   for a ≤ x ≤ b,  else 0"
      support="[a, b]"
      params={[
        { k: "a (lower)", v: "−1.5 m" },
        { k: "b (upper)", v: "+1.5 m" },
        { k: "Density", v: "0.333 m⁻¹" },
      ]}
      moments={[
        { label: "Mean", value: "0.000" },
        { label: "Variance", value: "0.750" },
        { label: "Std dev", value: "0.866" },
        { label: "Median", value: "0.000" },
      ]}
      usedFor={{
        where: "AMCL particle initialisation",
        body: (
          <>
            <p>
              When the patrol robot is switched on without a pose estimate, AMCL scatters its
              particle cloud uniformly across the free space of the map. That is the honest prior:
              before the first scan matches anything, no location in the building is more likely
              than any other.
            </p>
            <p className="mt-3">
              It also sets the dithering on the ultrasonic driver's ping schedule — a uniform jitter
              of ±4 ms on the round-robin interval, which stops the four transducers falling into a
              standing interference pattern with each other.
            </p>
          </>
        ),
      }}
      breaks={{
        body: (
          <>
            <p>
              A uniform prior over the whole map is expensive: covering a 40 × 25 m floor at useful
              density needs roughly 12 000 particles, and the first few seconds after boot are the
              worst-performing moments in the whole navigation stack.
            </p>
            <p className="mt-3">
              The real failure is using it as a noise model. Sensor error is almost never uniform —
              assuming it is means giving a reading 1.49 m away exactly the same weight as one 0.01 m
              away, right up to a cliff edge where it becomes impossible. Estimators built on that
              behave discontinuously near the bounds.
            </p>
          </>
        ),
      }}
      sampling={`# numpy
x = rng.uniform(-1.5, 1.5, size=n)

# ROS 2 / C++
std::uniform_real_distribution<double> d(-1.5, 1.5);
double x = d(gen);`}
    />
  );
}
