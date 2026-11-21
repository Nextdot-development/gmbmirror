import "server-only";
import { createHmac, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { env, requireSecret } from "./env";
import { sign, unsign } from "./crypto";

/**
 * "Recognised browser" cookie (OWASP: device cookies against account lockout).
 * After a successful login the browser gets a signed, httpOnly cookie naming the accounts it has logged in to.
 * A login from such a browser is limited by its own failure count, not the account-wide one, so someone guessing
 * passwords from elsewhere cannot lock the owner out of their usual browser. It holds no password or session.
 */
const COOKIE = "ge_device";
const DAYS = 180;
const MAX_ACCOUNTS = 5;

type Device = { id: string; accounts: string[] };

/** A short, keyed fingerprint of the email, so the cookie does not contain the address itself. */
export function accountTag(email: string): string {
  return createHmac("sha256", requireSecret("SESSION_SECRET")).update(`device:${email.trim().toLowerCase()}`).digest("base64url").slice(0, 16);
}

async function read(): Promise<Device | null> {
  const raw = (await cookies()).get(COOKIE)?.value;
  const payload = raw ? unsign(raw) : null;
  if (!payload) return null;
  try {
    const d = JSON.parse(Buffer.from(payload, "base64url").toString()) as Device;
    return typeof d.id === "string" && Array.isArray(d.accounts) ? d : null;
  } catch {
    return null;
  }
}

/** The id of this browser if it has logged in to this account before. */
export async function recognisedDevice(email: string): Promise<string | null> {
  const d = await read();
  return d && d.accounts.includes(accountTag(email)) ? d.id : null;
}

/** Marks this browser as recognised for the account. Called after a successful login or signup. */
export async function rememberDevice(email: string): Promise<void> {
  const d = (await read()) ?? { id: randomBytes(16).toString("hex"), accounts: [] };
  const tag = accountTag(email);
  d.accounts = [tag, ...d.accounts.filter((a) => a !== tag)].slice(0, MAX_ACCOUNTS);
  (await cookies()).set(COOKIE, sign(Buffer.from(JSON.stringify(d)).toString("base64url")), {
    httpOnly: true,
    sameSite: "lax",
    secure: env.appUrl().startsWith("https://"),
    path: "/",
    maxAge: DAYS * 86_400,
  });
}
