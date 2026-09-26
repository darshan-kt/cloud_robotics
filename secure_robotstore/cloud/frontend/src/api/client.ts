import { API_URL } from "../config";
import type { LoginResponse } from "./types";

// INTERN TASK (security): no request signing, no CSRF token, and the
// stored auth token is never attached to any request — because nothing on
// the backend checks it. Once you add auth, this is where the
// `Authorization: Bearer` header goes.

export async function login(username: string, password: string): Promise<LoginResponse> {
  const res = await fetch(`${API_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    return { ok: false, error: `Server returned ${res.status}.` };
  }
  return res.json();
}

export async function fetchHealth(): Promise<Record<string, unknown>> {
  const res = await fetch(`${API_URL}/health/detail`);
  return res.json();
}
