import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { decrypt, encrypt } from "./crypto";
import { env, requireSecret } from "./env";
import { GbpError, googleBase } from "./gbp-api";
import type { GoogleConnection, Review } from "./types";

/**
 * Google OAuth for the Business Profile integration: sign-in URL (with PKCE), code exchange, token refresh and
 * revocation. Credentials come only from the environment (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET,
 * GOOGLE_REDIRECT_URI). Tokens are stored encrypted (AES-256-GCM, TOKEN_ENCRYPTION_KEY) and never sent to the browser.
 */

export const MANAGE_SCOPE = "https://www.googleapis.com/auth/business.manage";
export const SCOPES = [MANAGE_SCOPE, "openid", "email"];

export const redirectUri = () => process.env.GOOGLE_REDIRECT_URI || `${env.appUrl()}/api/google/callback`;

/** A PKCE verifier and its S256 challenge (RFC 7636). */
export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

export function authUrl(state: string, codeChallenge: string): string {
  const p = new URLSearchParams({
    client_id: requireSecret("GOOGLE_CLIENT_ID"),
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline",
    // The account chooser lets owners with several Google accounts pick the one that manages the business.
    prompt: "select_account consent",
    include_granted_scopes: "true",
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

type Tokens = { access_token: string; refresh_token?: string; expires_at: number };
type TokenResponse = { access_token: string; refresh_token?: string; expires_in: number; id_token?: string; scope?: string };

/** Calls Google's token endpoint. invalid_grant (code used, refresh token revoked or expired) means "reconnect". */
async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  let res: Response;
  try {
    res = await fetch(`${googleBase("oauth")}/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: requireSecret("GOOGLE_CLIENT_ID"), client_secret: requireSecret("GOOGLE_CLIENT_SECRET"), ...body }),
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
  } catch {
    throw new GbpError("network");
  }
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { error?: string };
    console.error(`[gbp] token ${body.grant_type} -> ${res.status} ${j.error ?? ""}`);
    if (j.error === "invalid_grant" || res.status === 401) throw new GbpError("reconnect", res.status, j.error ?? "");
    if (res.status >= 500) throw new GbpError("unavailable", res.status, j.error ?? "");
    // invalid_client, unauthorized_client, redirect_uri_mismatch: a server setup problem, logged above.
    throw new GbpError("not_enabled", res.status, j.error ?? "");
  }
  return (await res.json()) as TokenResponse;
}

/** The email in Google's ID token, read only to show which account is connected. */
function emailFrom(idToken?: string): string {
  if (!idToken) return "";
  try {
    return JSON.parse(Buffer.from(idToken.split(".")[1], "base64url").toString()).email ?? "";
  } catch {
    return "";
  }
}

/**
 * Exchanges the sign-in code. Refuses a grant without the Business Profile scope (the owner can untick it on
 * Google's consent screen), and asks Google to cancel that partial grant.
 */
export async function exchangeCode(code: string, codeVerifier: string): Promise<{ conn: Omit<GoogleConnection, "connectedAt"> }> {
  const t = await tokenRequest({ code, code_verifier: codeVerifier, grant_type: "authorization_code", redirect_uri: redirectUri() });
  const scopes = (t.scope ?? "").split(/\s+/).filter(Boolean);
  const tokens: Tokens = { access_token: t.access_token, refresh_token: t.refresh_token, expires_at: Date.now() + t.expires_in * 1000 };
  const conn = { email: emailFrom(t.id_token), tokens: encrypt(JSON.stringify(tokens)), scopes };
  if (t.scope !== undefined && !scopes.includes(MANAGE_SCOPE)) {
    await revokeGoogle({ ...conn, connectedAt: "" });
    throw new GbpError("scope");
  }
  return { conn };
}

/**
 * Asks Google to cancel this app's access (revoking the refresh token ends the whole grant).
 * Best effort: the caller deletes the stored tokens either way. Returns true only when Google confirms.
 */
export async function revokeGoogle(conn: GoogleConnection): Promise<boolean> {
  try {
    const t = JSON.parse(decrypt(conn.tokens)) as Tokens;
    const token = t.refresh_token || t.access_token;
    if (!token) return false;
    const res = await fetch(`${googleBase("oauth")}/revoke`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }),
      signal: AbortSignal.timeout(8_000),
      cache: "no-store",
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Whether two stored connections hold the same Google grant (same refresh token). Revoking one ends both. */
export function sameGrant(a: GoogleConnection, b: GoogleConnection): boolean {
  try {
    const x = JSON.parse(decrypt(a.tokens)) as Tokens, y = JSON.parse(decrypt(b.tokens)) as Tokens;
    return Boolean(x.refresh_token && x.refresh_token === y.refresh_token);
  } catch {
    return false;
  }
}

/** A usable access token. Refreshes it a minute before it expires; `updated` is the new encrypted token set to save. */
export async function accessToken(conn: GoogleConnection): Promise<{ token: string; updated?: string }> {
  let t: Tokens;
  try {
    t = JSON.parse(decrypt(conn.tokens)) as Tokens;
  } catch {
    // Damaged, or encrypted with a different TOKEN_ENCRYPTION_KEY: only a new sign-in can fix it.
    throw new GbpError("reconnect", 0, "UNREADABLE_TOKENS");
  }
  if (t.expires_at > Date.now() + 60_000) return { token: t.access_token };
  if (!t.refresh_token) throw new GbpError("reconnect", 0, "NO_REFRESH_TOKEN");
  const r = await tokenRequest({ refresh_token: t.refresh_token, grant_type: "refresh_token" });
  // Google may issue a new refresh token; keep the old one otherwise.
  const next: Tokens = { access_token: r.access_token, refresh_token: r.refresh_token || t.refresh_token, expires_at: Date.now() + r.expires_in * 1000 };
  return { token: r.access_token, updated: encrypt(JSON.stringify(next)) };
}

/** Clearly labelled sample reviews shown until live Business Profile access is on and a location is chosen. */
export function sampleReviews(): Review[] {
  const d = (n: number) => new Date(Date.now() - n * 86400000).toISOString();
  return [
    { id: "sample-1", reviewer: "Rohit Nayak", stars: 5, comment: "Waited less than ten minutes and the staff explained everything clearly.", createdAt: d(2), replied: false, source: "sample" },
    { id: "sample-2", reviewer: "Sunita Das", stars: 2, comment: "Parking was a problem and I was called in 40 minutes after my slot.", createdAt: d(5), replied: false, source: "sample" },
    { id: "sample-3", reviewer: "Imran Sheikh", stars: 4, comment: "Good experience overall. Reception could be a little faster on the phone.", createdAt: d(9), replied: true, source: "sample" },
    { id: "sample-4", reviewer: "Pooja Mishra", stars: 5, comment: "", createdAt: d(14), replied: false, source: "sample" },
  ];
}
