import { getCurrentUserId } from "./userHeader";
import { j } from "./_fetch";

export interface User {
  id: number;
  api_key: string;
  first_name: string;
  created_at: string;
  last_seen_at: string;
}

export interface HealthInfo {
  status: string;
  mode: "standalone" | "multi_user";
}

export async function getHealth(): Promise<HealthInfo> {
  return j(await fetch("/api/health"));
}

export async function registerUser(
  api_key: string, first_name: string,
): Promise<User> {
  // Send WITHOUT the interceptor's auto-header — registration is the
  // one place the header would be wrong (we're claiming the key right
  // now, so sending it early would hit a 401 from the dep).
  return j(await fetch("/api/users/register", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-User-Id": "" },
    body: JSON.stringify({ api_key, first_name }),
  }));
}

export async function getMe(): Promise<User> {
  return j(await fetch("/api/me"));
}

export async function updateMe(first_name: string): Promise<User> {
  return j(await fetch("/api/me", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ first_name }),
  }));
}

/**
 * Validate a pasted api_key by trying to fetch /api/me with it. Returns
 * the user record on success; throws on 401.
 */
export async function verifyKey(api_key: string): Promise<User> {
  const r = await fetch("/api/me", { headers: { "X-User-Id": api_key } });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`${r.status} ${text}`);
  }
  return r.json();
}

/**
 * Generate 16 url-safe base64 characters from 96 bits of entropy.
 * crypto.getRandomValues is required — we refuse to fall back to
 * Math.random() since this IS the user's identity.
 */
export function generateApiKey(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function hasStoredKey(): boolean {
  return !!getCurrentUserId();
}
