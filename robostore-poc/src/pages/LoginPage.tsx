import { useEffect, useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Eye, EyeOff } from "lucide-react";
import { useAuth } from "../hooks/useAuth";
import { Button, Field, inputClass } from "../components/ui/Layout";
import { SpikeMark } from "../components/layout/AppShell";
import { isValidDemoPassword, isValidEmail } from "../lib/utils";

const MAX_ATTEMPTS = 5;
const ATTEMPT_WINDOW_MS = 60_000;
const LOCKOUT_MS = 30_000;

// Sign-in. A two-panel split rather than a floating card on an empty grid:
// the left panel carries DESIGN.md's editorial voice (serif display, one
// honest sentence about what this is), the right holds the form. It also
// stops the page from being 900px of background with a 420px box in the
// middle of it.

export function LoginPage() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const infoMessage = (location.state as { message?: string } | null)?.message;

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempts, setAttempts] = useState<number[]>([]);
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());

  const lockRemainingMs = lockedUntil ? Math.max(0, lockedUntil - now) : 0;
  const isLocked = lockRemainingMs > 0;

  useEffect(() => {
    if (!isLocked) return;
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [isLocked]);

  function recordFailure() {
    const cutoff = Date.now() - ATTEMPT_WINDOW_MS;
    const recent = [...attempts.filter((t) => t > cutoff), Date.now()];
    setAttempts(recent);
    if (recent.length >= MAX_ATTEMPTS) {
      setLockedUntil(Date.now() + LOCKOUT_MS);
      setNow(Date.now());
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (isLocked) return;

    if (!isValidEmail(email)) {
      setError("Enter a valid email address.");
      recordFailure();
      return;
    }
    if (!isValidDemoPassword(password)) {
      setError("Password must be at least 6 digits.");
      recordFailure();
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await signIn(email);
      navigate("/control");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="grid h-dvh grid-cols-1 overflow-hidden lg:grid-cols-[1.1fr_1fr]">
      {/* ---- Editorial panel ---- */}
      <section className="relative hidden flex-col justify-between overflow-hidden border-r border-line bg-surface p-xxl lg:flex">
        <div className="flex items-center gap-2.5">
          <SpikeMark className="h-5 w-5 text-coral" />
          <span className="font-sans text-title-sm font-medium tracking-[-0.2px] text-ink">
            Robo<span className="text-coral">store</span>
          </span>
        </div>

        <div className="max-w-lg">
          <h1 className="font-display text-display-xl text-ink">
            One robot,
            <br />
            four instruments.
          </h1>
          <p className="mt-lg max-w-md font-sans text-body-md text-muted">
            A console for a single autonomous vehicle — vitals, direct teleoperation, route
            dispatch, and a latching emergency stop that is reachable from every screen.
          </p>
        </div>

        <dl className="flex gap-xxl">
          {[
            ["Vehicle", "AMR-X200"],
            ["Runtime", "ROS 2 Humble"],
            ["Transport", "DDS · MQTT"],
          ].map(([term, value]) => (
            <div key={term}>
              <dt className="font-sans text-label uppercase text-faint">
                {term}
              </dt>
              <dd className="mt-1 font-mono text-caption text-body">{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* ---- Form panel ---- */}
      <section className="flex items-center justify-center overflow-y-auto p-lg">
        <div className="w-full max-w-[380px] animate-fade-up">
          <div className="mb-xl lg:hidden">
            <SpikeMark className="mb-sm h-6 w-6 text-coral" />
            <h1 className="font-display text-display-md text-ink">Robostore</h1>
          </div>

          <h2 className="font-display text-display-sm text-ink">Sign in</h2>
          <p className="mt-1.5 font-sans text-body-sm text-muted">
            Operator credentials for this vehicle.
          </p>

          {infoMessage && (
            <p className="mt-lg rounded-md border border-coral/30 bg-coral/10 px-3 py-2.5 font-sans text-caption text-coral">
              {infoMessage}
            </p>
          )}

          <form onSubmit={handleSubmit} className="mt-xl flex flex-col gap-lg">
            <Field label="Email">
              <input
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="operator@robot.local"
                disabled={isLocked}
                className={inputClass}
              />
            </Field>

            <Field
              label="Password"
              error={error && !isLocked ? error : null}
              hint={isLocked ? null : "Any six or more digits."}
            >
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••"
                  disabled={isLocked}
                  className={`${inputClass} pr-10`}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-faint transition-colors hover:text-ink"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </Field>

            <Button type="submit" size="lg" loading={submitting} disabled={isLocked} block>
              {isLocked
                ? `Locked — retry in ${Math.ceil(lockRemainingMs / 1000)}s`
                : submitting
                  ? "Signing in…"
                  : "Enter the deck"}
            </Button>

            {isLocked && (
              <p className="text-center font-sans text-caption text-caution">
                Too many attempts. The form unlocks automatically.
              </p>
            )}
          </form>

          <p className="mt-xl border-t border-line-soft pt-lg font-sans text-caption text-faint">
            Demo build — authentication is a local stub and no credentials leave this browser.
            See <span className="font-mono text-muted">README.md</span>.
          </p>
        </div>
      </section>
    </div>
  );
}
