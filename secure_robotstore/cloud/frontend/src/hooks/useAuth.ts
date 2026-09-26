import { useCallback, useEffect, useState } from "react";

// Session handling.
//
// INTERN TASK (security) — the problems here, each with its real-system
// counterpart in cloud-container/frontend/src/auth/:
//
//   1. The token lives in localStorage, readable by any script on the page.
//      An XSS bug therefore hands over the session. httpOnly cookies are
//      the usual answer.
//   2. Nothing validates or refreshes it. It never expires client-side
//      because the backend never put an expiry in it to begin with.
//   3. `isAuthenticated` is just "is there a string in localStorage" — so
//      typing `localStorage.setItem("demo_token","x")` in devtools logs you
//      in. That is not a bug in this hook; it is what happens when the
//      server does not check the token. Fix the server first.

const TOKEN_KEY = "demo_token";
const USER_KEY = "demo_user";

export interface Session {
  token: string;
  username: string;
}

function read(): Session | null {
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const username = localStorage.getItem(USER_KEY);
    return token && username ? { token, username } : null;
  } catch {
    return null;
  }
}

export function useAuth() {
  const [session, setSession] = useState<Session | null>(read);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setSession(read());
    setLoading(false);
  }, []);

  const signIn = useCallback((token: string, username: string) => {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, username);
    setSession({ token, username });
  }, []);

  const signOut = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    setSession(null);
  }, []);

  return { session, loading, signIn, signOut, isAuthenticated: session !== null };
}
