import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { login } from "../api/client";
import { useAuth } from "../hooks/useAuth";

// The login screen. Deliberately plain — it exists to gate the Remote Data
// page and to give interns a real request/response pair to harden.
//
// INTERN TASK (security): the demo credentials are printed on screen. That
// is honest for a teaching build, and the first thing to remove when this
// stops being one.

export function LoginPage() {
  const navigate = useNavigate();
  const { signIn } = useAuth();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const result = await login(username, password);
      if (result.ok && result.token && result.username) {
        signIn(result.token, result.username);
        navigate("/remote-data");
      } else {
        // The backend tells us *which* field was wrong. Surfacing it here
        // is the visible symptom of auth.py's INTERN TASK #7.
        setError(result.error ?? "Login failed.");
      }
    } catch {
      setError("Could not reach the backend. Is it running?");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8">
          <p className="mb-2 font-mono text-[11px] uppercase tracking-[1.5px] text-coral">
            secure_robotstore
          </p>
          <h1 className="text-2xl font-medium text-ink">Sign in</h1>
          <p className="mt-1.5 text-sm text-muted">
            Demo console for one device, two data streams.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          <label className="flex flex-col gap-2">
            <span className="font-mono text-[11px] uppercase tracking-[1.5px] text-muted">
              Username
            </span>
            <input
              type="text"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="operator"
              className="h-10 rounded-md border border-line bg-surface px-3 text-sm text-ink placeholder:text-faint focus:border-coral focus:outline-none"
            />
          </label>

          <label className="flex flex-col gap-2">
            <span className="font-mono text-[11px] uppercase tracking-[1.5px] text-muted">
              Password
            </span>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="h-10 rounded-md border border-line bg-surface px-3 text-sm text-ink placeholder:text-faint focus:border-coral focus:outline-none"
            />
          </label>

          {error && (
            <p role="alert" className="text-sm text-fault">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="h-10 rounded-md bg-coral text-sm font-medium text-canvas transition-colors hover:bg-[#a9583e] disabled:opacity-50"
          >
            {submitting ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <div className="mt-8 rounded-md border border-line bg-surface p-4">
          <p className="font-mono text-[11px] uppercase tracking-[1.5px] text-caution">
            Demo credentials
          </p>
          <p className="mt-2 font-mono text-sm text-body">operator / demo1234</p>
          <p className="mt-3 text-xs leading-relaxed text-faint">
            There is no real authentication in this build. The token is an
            unsigned blob and no endpoint checks it — see{" "}
            <span className="font-mono text-muted">backend/app/api/auth.py</span>.
          </p>
        </div>
      </div>
    </div>
  );
}
