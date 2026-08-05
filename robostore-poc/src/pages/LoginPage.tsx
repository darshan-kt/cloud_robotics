import { useEffect, useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Eye, EyeOff, Rocket } from "lucide-react";
import { useAuth } from "../hooks/useAuth";
import { Button } from "../components/ui/Layout";
import { isValidDemoPassword, isValidEmail } from "../lib/utils";

const MAX_ATTEMPTS = 5;
const ATTEMPT_WINDOW_MS = 60_000;
const LOCKOUT_MS = 30_000;

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
      navigate("/store");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center px-4">
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            "radial-gradient(circle at 50% 0%, rgba(0,229,160,0.12), transparent 55%), linear-gradient(rgba(43,77,88,0.35) 1px, transparent 1px), linear-gradient(90deg, rgba(43,77,88,0.35) 1px, transparent 1px)",
          backgroundSize: "auto, 32px 32px, 32px 32px",
        }}
      />

      <div className="relative w-full max-w-sm animate-fade-up rounded-2xl border border-border/50 bg-surface p-8 shadow-2xl shadow-black/40">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-accent/10">
            <Rocket className="h-6 w-6 text-accent" />
          </div>
          <h1 className="font-mono text-xl font-semibold tracking-wide">
            ROBO<span className="text-accent">STORE</span>
          </h1>
          <p className="mt-1 text-sm text-textMuted">Mission deck sign-in</p>
        </div>

        {infoMessage && (
          <p className="mb-4 rounded-lg border border-info/30 bg-info/10 px-3 py-2 text-xs text-info">
            {infoMessage}
          </p>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="font-mono text-xs uppercase tracking-wide text-textMuted">Email</span>
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="operator@robot.local"
              disabled={isLocked}
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-text placeholder:text-textDim focus:border-accent focus:outline-none disabled:opacity-50"
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="font-mono text-xs uppercase tracking-wide text-textMuted">Password</span>
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••"
                disabled={isLocked}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 pr-9 text-sm text-text placeholder:text-textDim focus:border-accent focus:outline-none disabled:opacity-50"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-textDim hover:text-text"
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </label>

          {error && !isLocked && <p className="text-xs text-danger">{error}</p>}

          <Button type="submit" variant="primary" size="lg" loading={submitting} disabled={isLocked} className="w-full">
            {isLocked
              ? `Locked — retry in ${Math.ceil(lockRemainingMs / 1000)}s`
              : submitting
                ? "Signing in..."
                : "Enter mission deck"}
          </Button>
        </form>

        <p className="mt-5 text-center text-xs text-textDim">
          Enter any email + 6-digit password to get started.
        </p>
      </div>
    </div>
  );
}
