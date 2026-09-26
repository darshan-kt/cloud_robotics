import { DistributionTemplate } from "./DistributionTemplate";
import { appMeta } from "../../lib/appCatalog";

const { app, section } = appMeta("/ai/distributions/normal");
const MU = 0;
const SIGMA = 0.011; // metres — the Astra's depth error at 1 m

export function NormalPage() {
  return (
    <DistributionTemplate
      app={app}
      section={section}
      summary="The assumption underneath every filter on this robot. Sums of many small independent errors tend toward it, which is why it describes sensor noise so well — and why it describes outliers so badly."
      facts={[
        { label: "Parameters", value: "μ, σ" },
        { label: "Mean", value: "μ" },
        { label: "Variance", value: "σ²" },
        { label: "Within ±2σ", value: "95.45 %" },
      ]}
      pdf={(x) => (1 / (SIGMA * Math.sqrt(2 * Math.PI))) * Math.exp(-((x - MU) ** 2) / (2 * SIGMA ** 2))}
      domain={[-0.04, 0.04]}
      markers={[
        { x: -SIGMA, label: "−σ" },
        { x: MU, label: "μ", dashed: false },
        { x: SIGMA, label: "+σ" },
      ]}
      xLabel="depth error (m)"
      formula="f(x) = (1 / (σ√(2π))) · e^(−(x − μ)² / 2σ²)"
      support="(−∞, ∞)"
      params={[
        { k: "μ (mean)", v: "0.000 m" },
        { k: "σ (std dev)", v: "0.011 m" },
        { k: "Fitted from", v: "Astra @ 1.0 m" },
      ]}
      moments={[
        { label: "Mean", value: "0.0000" },
        { label: "Variance", value: "0.000121" },
        { label: "Std dev", value: "0.0110" },
        { label: "±1σ mass", value: "68.27 %" },
      ]}
      usedFor={{
        where: "every estimator on board",
        body: (
          <>
            <p>
              The Kalman filter in the object tracker assumes Gaussian measurement noise on the blob
              centroid — that is what the 6 px measurement-noise parameter on that page <em>is</em>.
              AMCL's sensor model assumes Gaussian range error. The IMU fusion assumes Gaussian gyro
              noise. All three are the same assumption wearing different units.
            </p>
            <p className="mt-3">
              The curve above is the Astra's own depth error at 1 m, σ = 11 mm, fitted from a
              calibration run against a flat target. It is genuinely close to normal in the middle,
              which is why the tracker works.
            </p>
          </>
        ),
      }}
      breaks={{
        body: (
          <>
            <p>
              The tails are too thin. A Gaussian says an error of 10σ — 11 cm on that depth reading —
              happens about once in 10²³ samples. In practice the Astra produces one every few
              minutes, whenever the pattern lands on something glossy. The filter, told such a value
              is impossible, treats it as a real measurement and drags the estimate with it.
            </p>
            <p className="mt-3">
              That is the single most common failure in this codebase's estimators, and the fix is
              not a better σ. It is gating: reject measurements beyond about 3σ before they reach the
              update step, or use a heavier-tailed model. The depth-variance gate on the object
              tracker is exactly that, done in the measurement domain instead of the filter.
            </p>
          </>
        ),
      }}
      sampling={`# numpy
x = rng.normal(loc=0.0, scale=0.011, size=n)

# gate before the update step — the point above
if abs(z - z_pred) < 3.0 * sigma:
    kf.update(z)`}
    />
  );
}
