import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, LogOut, OctagonX, Radio, Rocket } from "lucide-react";
import { useAuth } from "../../hooks/useAuth";
import { getEmergencyStops, onEmergencyStopUpdated } from "../../lib/localDb";
import { GATEWAY_URL } from "../../lib/config";

const HEALTH_POLL_MS = 5000;

interface HeaderProps {
  showBack?: boolean;
  backTo?: string;
  onBack?: () => void;
  title?: string;
  icon?: ComponentType<{ className?: string }>;
  iconColor?: string;
}

function useEstopActive(): boolean {
  const [active, setActive] = useState(false);

  useEffect(() => {
    let cancelled = false;

    getEmergencyStops(1).then((stops) => {
      if (!cancelled) setActive(stops[0]?.is_active ?? false);
    });

    const unsubscribe = onEmergencyStopUpdated((entry) => setActive(entry.is_active));

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  return active;
}

function useGatewayConnected(): boolean {
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const res = await fetch(`${GATEWAY_URL}/health`, { signal: AbortSignal.timeout(3000) });
        if (!cancelled) setConnected(res.ok);
      } catch {
        if (!cancelled) setConnected(false);
      }
    }

    poll();
    const interval = window.setInterval(poll, HEALTH_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  return connected;
}

export function Header({ showBack = false, backTo = "/store", onBack, title, icon: Icon, iconColor }: HeaderProps) {
  const { session, signOut } = useAuth();
  const navigate = useNavigate();
  const estopActive = useEstopActive();
  const gatewayConnected = useGatewayConnected();

  function handleBack() {
    if (onBack) {
      onBack();
    } else {
      navigate(backTo);
    }
  }

  function handleSignOut() {
    signOut();
    navigate("/login");
  }

  return (
    <header className="sticky top-0 z-40 border-b border-border/50 bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4">
        <div className="flex items-center gap-3">
          {showBack ? (
            <button
              onClick={handleBack}
              aria-label="Back"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-textMuted hover:bg-card hover:text-text"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
          ) : (
            <Link to="/store" className="flex items-center gap-2">
              <Rocket className="h-5 w-5 text-accent" />
              <span className="font-mono text-sm font-semibold tracking-wide">
                ROBO<span className="text-accent">STORE</span>
              </span>
            </Link>
          )}

          {title && (
            <>
              <span className="h-5 w-px bg-border" />
              <div className="flex items-center gap-2">
                {Icon && <Icon className={`h-4 w-4 ${iconColor ?? "text-accent"}`} />}
                <span className="font-mono text-sm text-text">{title}</span>
              </div>
            </>
          )}
        </div>

        {session && (
          <div className="flex items-center gap-3">
            <Pill
              active={estopActive}
              activeClassName="border-rose-500/40 bg-rose-500/10 text-rose-400"
              idleClassName="border-border/50 text-textDim"
              icon={<OctagonX className="h-3 w-3" />}
              label={estopActive ? "E-STOP ACTIVE" : "E-STOP CLEAR"}
              pulse={estopActive}
            />
            <Pill
              active={gatewayConnected}
              activeClassName="border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
              idleClassName="border-border/50 text-textDim"
              icon={<Radio className="h-3 w-3" />}
              label={gatewayConnected ? "Connected" : "Not Connected"}
              pulse={gatewayConnected}
            />
            <span className="hidden font-mono text-xs text-textMuted sm:inline">{session.email}</span>
            <button
              onClick={handleSignOut}
              aria-label="Sign out"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-textMuted hover:bg-card hover:text-danger"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
    </header>
  );
}

function Pill({
  active,
  activeClassName,
  idleClassName,
  icon,
  label,
  pulse,
}: {
  active: boolean;
  activeClassName: string;
  idleClassName: string;
  icon: ReactNode;
  label: string;
  pulse: boolean;
}) {
  return (
    <span
      className={`hidden items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[11px] uppercase tracking-wide sm:inline-flex ${
        active ? activeClassName : idleClassName
      }`}
    >
      <span className={pulse ? "animate-pulse-status" : ""}>{icon}</span>
      {label}
    </span>
  );
}
