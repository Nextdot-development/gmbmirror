import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { db } from "./store";
import type { AiUsage } from "./types";

/**
 * The owner of the background job being run, so its Claude calls are counted for them. Requests use the session.
 */
const who = new AsyncLocalStorage<{ userId: string }>();

export function runAsAiUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  return who.run({ userId }, fn);
}

/**
 * The user a Claude call is for: the background job's owner (runAsAiUser), or else the signed-in user of the current
 * request. Outside both (none today) the call is not attributed.
 */
export async function currentUser(): Promise<string | undefined> {
  const fromJob = who.getStore()?.userId;
  if (fromJob) return fromJob;
  try {
    const { getUser } = await import("./session");
    return (await getUser())?.id;
  } catch {
    return undefined;
  }
}

/** Claude calls allowed per user per calendar month (all features together). AI_MONTHLY_CALL_LIMIT overrides it. */
export const monthlyLimit = () => Number(process.env.AI_MONTHLY_CALL_LIMIT) > 0 ? Number(process.env.AI_MONTHLY_CALL_LIMIT) : 600;
const month = (d = new Date()) => d.toISOString().slice(0, 7);

/** Throws when the current user has used this month's allowance. Calls outside a user (none today) are not limited. */
export async function checkAiAllowance(): Promise<void> {
  const u = await currentUser();
  if (!u) return;
  const usage = await db.getUserKey<AiUsage>(u, "ai_usage", {});
  if ((usage[month()]?.calls ?? 0) >= monthlyLimit()) {
    throw new Error("This account has used its AI allowance for this month. It resets on the 1st.");
  }
}

/** Counts one Claude call and its tokens for the current user (per month and per feature). */
export async function recordAiUsage(feature: string, inputTokens: number, outputTokens: number): Promise<void> {
  const u = await currentUser();
  if (!u) return;
  const usage = await db.getUserKey<AiUsage>(u, "ai_usage", {});
  const m = month();
  const cur = usage[m] ?? { calls: 0, inputTokens: 0, outputTokens: 0, byFeature: {} };
  cur.calls += 1;
  cur.inputTokens += inputTokens;
  cur.outputTokens += outputTokens;
  cur.byFeature[feature] = (cur.byFeature[feature] ?? 0) + 1;
  // Keep the last 12 months.
  const keep = Object.fromEntries(Object.entries({ ...usage, [m]: cur }).sort(([a], [b]) => b.localeCompare(a)).slice(0, 12));
  await db.saveUserKey(u, "ai_usage", keep);
}
