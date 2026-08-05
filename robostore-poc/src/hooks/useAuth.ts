import { useCallback, useEffect, useState } from "react";

// Stub session, on purpose. There is no real backend for ROBOSTORE's app
// data yet (see lib/localDb.ts) - login exists to gate the /store hub behind
// something, and to give the UI a real "who's signed in" affordance, not to
// actually authenticate anyone. Every signIn call trivially succeeds after a
// short fake delay so the loading states in LoginPage are real to build
// against. Replace this with real session handling when app data moves to a
// real backend - see robostore-poc/README.md.

export interface Session {
  id: string;
  email: string;
}

const STORAGE_KEY = "robostore_session";
const FAKE_LATENCY_MS = 100;

function readStoredSession(): Session | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

export function useAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSession(readStoredSession());
      setLoading(false);
    }, FAKE_LATENCY_MS);
    return () => window.clearTimeout(timer);
  }, []);

  const signIn = useCallback(async (email: string): Promise<Session> => {
    await new Promise((resolve) => window.setTimeout(resolve, FAKE_LATENCY_MS));
    const next: Session = { id: "local-user", email };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    setSession(next);
    return next;
  }, []);

  const signOut = useCallback(() => {
    window.localStorage.removeItem(STORAGE_KEY);
    setSession(null);
  }, []);

  return { session, loading, signIn, signOut };
}
