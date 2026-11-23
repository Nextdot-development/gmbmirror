"use server";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { deleteLogin, getUser, logIn, logOut, requestPasswordReset, requireUser, requireVerifiedUser, setNewPassword, signUp } from "@/lib/session";
import { notifyAccountDeleted, notifyReport, notifySecurity, savePrefs, sendSupportMessage } from "@/lib/notify";
import { emailConfigured } from "@/lib/email";
import { requireScope } from "@/lib/ctx";
import { db, type Scope } from "@/lib/store";
import { aiGrowthRecommendations, draftActionContent, draftPost, draftPostVariants, draftReply, explainCompetitors, explainInsights, METHODOLOGY, runVisibility, visibilityFixes, type ReplyVariant } from "@/lib/ai";
import { classifyReview, defaultAutomation, replyIssues } from "@/lib/review-safety";
import { logAutomation } from "@/lib/job-handlers";
import { buildMonthlyReport } from "@/lib/reports";
import { loadGrowth } from "@/lib/growth-server";
import { medicalWarnings } from "@/lib/medical";
import { revokeGoogle, sameGrant } from "@/lib/google";
import { fetchLocations, findReview, live, locationFields, refreshInsights, syncBusinessFromGoogle, withGoogle } from "@/lib/gbp";
import { REPLY_MAX_BYTES, updateReply } from "@/lib/gbp-api";
import { publishPost, scheduleKey, schedulePrefix } from "@/lib/post-publish";
import { cancelJobs, cancelLocationJobs, cancelMatching, enqueue } from "@/lib/jobs";
import { env } from "@/lib/env";
import { BRAND } from "@/lib/brand";
const BRAND_EMAIL = BRAND.email;
import { clearShared, clientIp, LIMITS, peekShared, refundShared, takeShared, waitMessage } from "@/lib/ratelimit";
import { recognisedDevice, rememberDevice } from "@/lib/device";
import { AUDIT_ITEMS, CATEGORIES, categoryInfo, CHATGPT_PREPARE } from "@/lib/business";
import { defaultCategory, forgetGoogleValues } from "@/lib/business-sync";
import type { Business, GoogleConnection, GoogleVerdict, GridScan, MonthlyReport, PostDraft, ReplyDraft, ReplyHistoryEntry } from "@/lib/types";
import { metricsForHistory } from "@/lib/competition";
import { historyFor, tagHistory } from "@/lib/listing-history";
import { dashboardReturn } from "@/lib/return-to";
import { categoryQuery, competitors, findPlaces, isNotFound, placeNames, placeSummary, profileAudit, rankGrid, validPlaceId, type AuditItem, type PlaceSummary } from "@/lib/places";
import { GRID_SIZES, gridPointsPerDay, scanRequests, type GridSize } from "@/lib/grid";
import { gridPointsUsed } from "@/lib/grid-server";
import { labelMatches, type DiscoveryMatch } from "@/lib/discovery";

export type FormState = {
  error?: string; ok?: string; text?: string; fieldErrors?: Record<string, string>; values?: Record<string, string>; saved?: number; warnings?: string[];
  /** Reply status after the action (draft, approved, posted). */
  status?: string;
  /** Alternative drafts to choose from (post writer). */
  variants?: string[];
};

/**
 * A local "YYYY-MM-DDTHH:mm" plus the browser's time-zone offset (Date.getTimezoneOffset: minutes, UTC minus local)
 * as a UTC ISO time. Undefined when the offset is missing or not a real one.
 */
function toUtc(local: string, tz: FormDataEntryValue | null): string | undefined {
  const off = Number(tz);
  if (tz === null || String(tz).trim() === "" || !Number.isInteger(off) || Math.abs(off) > 840) return undefined;
  const [y, mo, d, h, mi] = local.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/)!.slice(1).map(Number);
  return new Date(Date.UTC(y, mo - 1, d, h, mi) + off * 60_000).toISOString();
}

const CTA_TYPES = ["BOOK", "ORDER", "SHOP", "LEARN_MORE", "SIGN_UP", "CALL"] as const;
/** The optional call-to-action button of a post. CALL needs no link (Google uses the profile's phone number). */
function postCta(fd: FormData): { value?: PostDraft["callToAction"] } | { error: string } {
  const type = String(fd.get("ctaType") ?? "");
  if (!type) return {};
  if (!(CTA_TYPES as readonly string[]).includes(type)) return { error: "Choose a button from the list." };
  if (type === "CALL") return { value: { actionType: "CALL" } };
  const url = String(fd.get("ctaUrl") ?? "").trim();
  if (!/^https?:\/\/\S+\.\S+$/i.test(url)) return { error: "The button needs a link that starts with http:// or https://." };
  return { value: { actionType: type as Exclude<(typeof CTA_TYPES)[number], "CALL">, url } };
}

/**
 * The optional photo of a post: a public https link that Google downloads when it publishes the post. The server
 * never fetches it (no requests to addresses people type). Local and private network addresses are refused, since
 * Google could not reach them anyway.
 */
function postImage(raw: string): { value?: string } | { error: string } {
  if (!raw) return {};
  let u: URL;
  try { u = new URL(raw); } catch { return { error: "The photo link is not a valid web address." }; }
  if (u.protocol !== "https:") return { error: "The photo link must start with https://." };
  if (raw.length > 2000) return { error: "The photo link is too long." };
  const h = u.hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal") || /^\[|^\d+\.\d+\.\d+\.\d+$/.test(h) || !h.includes(".")) return { error: "Use a public link to the photo (a web address, not a local or numeric one)." };
  if (u.username || u.password) return { error: "The photo link cannot contain a user name or password." };
  return { value: u.toString() };
}

/** A real local date-time from a datetime-local input ("YYYY-MM-DDTHH:mm"), rejecting values like 30 February. */
function isLocalDateTime(v: string): boolean {
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!m) return false;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const t = new Date(y, mo - 1, d, h, mi);
  return t.getFullYear() === y && t.getMonth() === mo - 1 && t.getDate() === d && t.getHours() === h && t.getMinutes() === mi;
}

/** React 19 clears uncontrolled fields after an action. Send values back so people do not retype after an error. */
function vals(fd: FormData, omit: string[] = ["password"]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of fd.entries()) if (typeof v === "string" && !omit.includes(k) && !k.startsWith("$")) out[k] = v;
  return out;
}

const emailSchema = z.string().trim().toLowerCase().email("Enter a valid email address.");
const passwordSchema = z.string().min(8, "Use at least 8 characters.").max(128);

function fieldErrors(err: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of err.issues) out[String(i.path[0] ?? "form")] ??= i.message;
  return out;
}

/* ---------------- Auth ---------------- */
export async function signUpAction(_: FormState, fd: FormData): Promise<FormState> {
  const parsed = z.object({ email: emailSchema, password: passwordSchema }).safeParse({ email: fd.get("email"), password: fd.get("password") });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error), values: vals(fd) };
  const rl = await takeShared(`signup:ip:${await clientIp()}`, LIMITS.signupPerIp);
  if (!rl.ok) return { error: waitMessage("sign up attempts", rl.retryAfterSec), values: vals(fd) };
  const r = await signUp(parsed.data.email, parsed.data.password);
  if (r.error) return { error: r.error, values: vals(fd) };
  if (r.needsConfirm) return { ok: "Account created. Check your email and click the link to confirm, then log in." };
  await rememberDevice(parsed.data.email);
  redirect("/app/onboarding");
}

export async function logInAction(_: FormState, fd: FormData): Promise<FormState> {
  const parsed = z.object({ email: emailSchema, password: z.string().min(1, "Enter your password.") }).safeParse({ email: fd.get("email"), password: fd.get("password") });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error), values: vals(fd) };
  const email = parsed.data.email;
  const ip = await clientIp();
  const tooMany = (retryAfterSec: number): FormState => ({ error: waitMessage("login attempts", retryAfterSec), values: vals(fd) });

  // 1. Every attempt from one address, whatever the account.
  const byIp = await takeShared(`login:ip:${ip}`, LIMITS.loginPerIp);
  if (!byIp.ok) return tooMany(byIp.retryAfterSec);

  // 2. Failures for this account from this client: this browser if it has logged in to the account before,
  //    otherwise this address. 3. Failures for this account from anywhere, which only unrecognised browsers wait for.
  //    Only failures count, so someone guessing elsewhere cannot lock the owner out of a browser they use.
  const device = await recognisedDevice(email);
  const clientKey = `login:fail:${email}:${device ? `device:${device}` : `ip:${ip}`}`;
  const accountKey = `login:fail:${email}`;
  const byClient = await peekShared(clientKey, LIMITS.loginFailPerClient);
  const byAccount = device ? { ok: true, retryAfterSec: 0 } : await peekShared(accountKey, LIMITS.loginFailPerAccount);
  if (!byClient.ok || !byAccount.ok) return tooMany(Math.max(byClient.retryAfterSec, byAccount.retryAfterSec));

  const r = await logIn(email, parsed.data.password);
  if (r.error) {
    await takeShared(clientKey, LIMITS.loginFailPerClient);
    await takeShared(accountKey, LIMITS.loginFailPerAccount);
    return { error: r.error, values: vals(fd) };
  }
  await clearShared(clientKey);
  await rememberDevice(email);
  // Back to the dashboard page that asked for a login (checked again here: the form field can be edited).
  redirect(dashboardReturn(String(fd.get("next") ?? "")) ?? "/app");
}

/** "Forgot password": sends a reset link if the account exists; the answer never says whether it does. */
export async function requestPasswordResetAction(_: FormState, fd: FormData): Promise<FormState> {
  const parsed = z.object({ email: emailSchema }).safeParse({ email: fd.get("email") });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error), values: vals(fd) };
  const byIp = await takeShared(`reset:ip:${await clientIp()}`, LIMITS.resetPerIp);
  if (!byIp.ok) return { error: waitMessage("reset requests", byIp.retryAfterSec), values: vals(fd) };
  // Over the per-email limit: answer as if it was sent, so the limit does not reveal anything either.
  const byEmail = await takeShared(`reset:email:${parsed.data.email}`, LIMITS.resetPerEmail);
  if (byEmail.ok) {
    const r = await requestPasswordReset(parsed.data.email);
    if (r.error) return { error: r.error, values: vals(fd) };
  }
  return { ok: "If an account uses that email, we have sent it a link to choose a new password. Check your inbox and spam folder." };
}

/** Sets a new password after the reset link signed the person in. */
export async function setNewPasswordAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireVerifiedUser();
  const parsed = z.object({ password: passwordSchema, confirm: z.string() }).refine((v) => v.password === v.confirm, { message: "The two passwords are different.", path: ["confirm"] })
    .safeParse({ password: fd.get("password"), confirm: fd.get("confirm") });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
  const r = await setNewPassword(parsed.data.password);
  if (r.error) return { error: r.error };
  after(() => notifySecurity(user, "password_changed").then(() => undefined, () => undefined));
  redirect("/app?password=updated");
}

export async function logOutAction() {
  await logOut();
  redirect("/");
}

/* ---------------- Business ---------------- */
/** A textarea with one entry per line, turned into a short list. */
function lines(max: number, maxLen: number, what: string) {
  return z
    .string()
    .optional()
    .transform((v) => [...new Set((v ?? "").split("\n").map((l) => l.trim()).filter(Boolean))])
    .refine((a) => a.length <= max, `Add at most ${max} ${what}, one per line.`)
    .refine((a) => a.every((l) => l.length <= maxLen), `Keep each line under ${maxLen} characters.`);
}

const websiteField = z
  .string()
  .trim()
  .max(200)
  .optional()
  .transform((v) => (!v ? "" : /^https?:\/\//i.test(v) ? v : `https://${v}`))
  .refine((v) => {
    if (!v) return true;
    try {
      const u = new URL(v);
      return /\./.test(u.hostname) && !/\s/.test(v);
    } catch {
      return false;
    }
  }, "Enter a valid website address.");

/** Business information. Every field is optional here: only the fields a form sends are changed. */
const businessSchema = z.object({
  type: z.enum(["healthcare", "general"]).optional(),
  name: z.string().trim().min(2, "Enter your business name.").max(120).optional(),
  website: websiteField,
  location: z.string().trim().min(2, "Enter the city or area.").max(120).optional(),
  category: z.string().trim().min(2, "Choose a category.").max(80).optional(),
  phone: z.string().trim().max(30).regex(/^[0-9+()\-\s]*$/, "Use digits, spaces, + and - only.").optional(),
});

const aiPrefsSchema = z.object({
  language: z.enum(["en", "hi", "hinglish"]).catch("en"),
  aliases: lines(5, 120, "other names"),
  customQuestions: lines(3, 200, "questions"),
  services: lines(10, 60, "services"),
  keywords: lines(5, 80, "search phrases"),
  reviewMessage: z.string().trim().max(500, "Keep the message under 500 characters.").optional()
    .refine((v) => !v || v.includes("{link}"), "Include {link} where the review link goes."),
});

const categoriesFor = (t: Business["type"]) => CATEGORIES.filter((c) => c.type === t).map((c) => c.label);

/**
 * Onboarding step 1 (step=basics: type, name, city, optional website) and Settings > Business information.
 * Only the submitted fields change, so saving here never touches AI preferences, the Google listing or anything else.
 * A value the owner types is marked as theirs, so Google never overwrites it later.
 */
export async function saveBusinessAction(_: FormState, fd: FormData): Promise<FormState> {
  const { user, scope } = await requireScope();
  const onboarding = fd.get("step") === "basics";
  const raw = Object.fromEntries([...fd.entries()].filter(([k]) => !k.startsWith("$")));
  const parsed = businessSchema.safeParse(raw);
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error), values: vals(fd) };
  const d = parsed.data;
  const missing: Record<string, string> = {};
  if (fd.has("name") && !d.name) missing.name = "Enter your business name.";
  if (fd.has("location") && !d.location) missing.location = "Enter the city or area.";
  if (Object.keys(missing).length) return { fieldErrors: missing, values: vals(fd) };
  const prev = await db.getBusiness(scope);
  if (!prev && (!d.name || !d.location || !d.type)) return { error: "Enter the business type, name and city.", values: vals(fd) };

  const type = d.type ?? prev!.type;
  const next: Business = prev
    ? { ...prev, sources: { ...(prev.sources ?? {}) } }
    : { name: d.name!, website: "", location: d.location!, type, category: defaultCategory(type), language: "en", audit: {}, sources: {}, createdAt: new Date().toISOString() };
  next.type = type;
  if (d.name !== undefined) next.name = d.name;
  if (d.location !== undefined) next.location = d.location;
  if (fd.has("website")) next.website = d.website;
  if (fd.has("phone")) next.phone = d.phone || undefined;
  if (fd.has("category") && d.category) {
    // A category of the chosen type, or the one already saved (older names stay valid until changed).
    if (!categoriesFor(type).includes(d.category) && !(prev && d.category === prev.category && categoryInfo(prev.category, prev.type).type === type)) {
      return { fieldErrors: { category: "Choose a category from the list." }, values: vals(fd) };
    }
    next.category = d.category;
  }
  // The type changed and the category belongs to the other type: use the general category for the new type.
  if (categoryInfo(next.category, type).type !== type) next.category = defaultCategory(type);

  // Values the owner changed are theirs from now on; Google will not replace them.
  for (const f of ["name", "website", "phone", "category"] as const) {
    if (!fd.has(f)) continue;
    const before = prev?.[f] ?? "", after = next[f] ?? "";
    if (!prev || before !== after) {
      if (after) next.sources![f] = "user";
      else delete next.sources![f];
    }
  }
  await db.saveBusiness(scope, next);
  revalidatePath("/app", "layout");
  if (onboarding) redirect("/app/onboarding/connect");
  return { ok: "Business details saved.", values: vals(fd) };
}

/** Settings > AI preferences: reply and post language, other names, own visibility questions. Nothing else changes. */
export async function saveAiPreferencesAction(_: FormState, fd: FormData): Promise<FormState> {
  const { user, scope } = await requireScope();
  const field = (k: string) => (fd.has(k) ? String(fd.get(k)) : undefined);
  const parsed = aiPrefsSchema.safeParse({ language: fd.get("language"), aliases: field("aliases") ?? "", customQuestions: field("customQuestions") ?? "",
    services: field("services") ?? "", keywords: field("keywords") ?? "", reviewMessage: field("reviewMessage") });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error), values: vals(fd) };
  const b = await db.getBusiness(scope);
  if (!b) return { error: "Add your business details first." };
  const d = parsed.data;
  // Only the fields this form sent change.
  await db.saveBusiness(scope, { ...b, language: d.language, aliases: d.aliases, customQuestions: d.customQuestions,
    ...(fd.has("services") ? { services: d.services } : {}), ...(fd.has("keywords") ? { keywords: d.keywords } : {}),
    ...(fd.has("reviewMessage") ? { reviewMessage: d.reviewMessage || undefined } : {}) });
  revalidatePath("/app", "layout");
  return { ok: "AI preferences saved.", values: vals(fd) };
}

/** The business finder's "Use this name" button: the owner chose the name shown on a Google listing. */
export async function renameBusinessAction(name: string): Promise<{ ok?: string; error?: string }> {
  const { user, scope } = await requireScope();
  const n = z.string().trim().min(2).max(120).safeParse(name);
  if (!n.success) return { error: "That name cannot be used." };
  const b = await db.getBusiness(scope);
  if (!b) return { error: "Add your business details first." };
  await db.saveBusiness(scope, { ...b, name: n.data, sources: { ...(b.sources ?? {}), name: "user" } });
  revalidatePath("/app", "layout");
  return { ok: `Business name changed to “${n.data}”.` };
}

/** Settings: take Google's value for one field. The value is read from the stored Google profile, never from the form. */
export async function useGoogleValueAction(fd: FormData): Promise<void> {
  const { user, scope } = await requireScope();
  const field = z.enum(["name", "website", "phone"]).safeParse(fd.get("field"));
  const [b, conn] = await Promise.all([db.getBusiness(scope), db.getGoogle(scope)]);
  if (!field.success || !b || !conn?.profile || conn.profile.location !== conn.locationName) return;
  const value = field.data === "name" ? conn.profile.title : conn.profile[field.data];
  if (!value) return;
  await db.saveBusiness(scope, { ...b, [field.data]: value, sources: { ...(b.sources ?? {}), [field.data]: "google" } });
  revalidatePath("/app", "layout");
}

/** Settings and onboarding: read the Business Profile again and fill what is missing. */
export async function refreshFromGoogleAction(_: FormState, __: FormData): Promise<FormState> {
  const { user, scope } = await requireScope();
  const rl = await takeShared(`gbp-refresh:${user.id}`, LIMITS.gbpRefreshPerUser);
  if (!rl.ok) return { error: waitMessage("updates", rl.retryAfterSec) };
  const r = await syncBusinessFromGoogle(scope);
  revalidatePath("/app", "layout");
  if (r.error) return { error: r.error };
  return { ok: syncMessage(r) };
}

const FIELD_NAME: Record<string, string> = { website: "website", phone: "phone", category: "category", name: "name" };
function syncMessage(r: { changed: string[]; placeIdChanged?: boolean }): string {
  const parts = [...r.changed.map((f) => FIELD_NAME[f]), ...(r.placeIdChanged ? ["Google listing"] : [])];
  return parts.length ? `Updated from Google: ${parts.join(", ")}.` : "Up to date with Google.";
}

export async function toggleAuditAction(fd: FormData) {
  const { user, scope } = await requireScope();
  const b = await db.getBusiness(scope);
  if (!b) return;
  const key = String(fd.get("key") ?? "");
  if (!AUDIT_ITEMS.some((i) => i.key === key && (!i.healthcareOnly || b.type === "healthcare"))) return;
  // "value" sets the answer (for example "use Google's answer"); without it the tick is toggled.
  const value = fd.get("value");
  b.audit = { ...b.audit, [key]: value === "true" ? true : value === "false" ? false : !b.audit[key] };
  await db.saveBusiness(scope, b);
  revalidatePath("/app", "layout");
}

/* ---------------- AI visibility ---------------- */
export async function runVisibilityAction(_: FormState, __: FormData): Promise<FormState> {
  const { user, scope } = await requireScope();
  const b = await db.getBusiness(scope);
  if (!b) return { error: "Add your business details first." };
  if (!env.anthropicConfigured() && !env.openaiConfigured() && !env.geminiConfigured()) {
    return { error: "No AI provider is configured. Add ANTHROPIC_API_KEY to your .env file and restart." };
  }
  const rlKey = `visibility:${user.id}`;
  const rl = await takeShared(rlKey, LIMITS.visibilityPerUser);
  if (!rl.ok) return { error: waitMessage("visibility checks", rl.retryAfterSec) };
  let failed: { label: string; error: string }[];
  try {
    const run = await runVisibility(b);
    failed = run.failedProviders;
    // The fix list is a bonus: if no provider can write it, the page shows the fixed list instead.
    const fixes = await visibilityFixes(b, run).catch(() => null);
    await db.addCheck(scope, {
      id: randomUUID(),
      checkedAt: new Date().toISOString(),
      businessName: b.name,
      location: b.location,
      category: b.category,
      results: run.results,
      methodology: METHODOLOGY,
      failedProviders: failed.length ? failed : undefined,
      fixes: fixes ?? undefined,
    });
  } catch (e) {
    await refundShared(rlKey); // a failed check is not counted toward the hourly limit
    return { error: e instanceof Error ? e.message : "The check failed. Try again in a minute." };
  }
  revalidatePath("/app", "layout");
  return failed.length
    ? { ok: `Check saved with partial results. Not included: ${failed.map((f) => f.label).join(", ")}.` }
    : { ok: "Check finished. Results are below." };
}

/* ---------------- Google connection ---------------- */
export async function chooseLocationAction(_: FormState, fd: FormData): Promise<FormState> {
  const { user, scope } = await requireScope();
  const conn = await db.getGoogle(scope);
  if (!conn) return { error: "Connect Google first." };
  const locationName = String(fd.get("location") ?? "");
  if (!locationName) return { error: "Choose a location." };
  // Never trust the submitted id: it ends up inside Google API URLs. Accept only a location that Google lists for
  // this user's own connected account, and take its account, title, address and Place ID from Google too.
  const { locations, error } = await fetchLocations(scope);
  if (error) return { error };
  const match = locations.find((l) => l.location === locationName);
  if (!match) return { error: "That location is not on your connected Google account. Reload the page and choose again." };
  // A different location has different reviews, posts, insights and profile: the cached ones are dropped.
  // Saved only for the sign-in this request started with (atomically), never over a newer one.
  let same = false, previous: string | undefined, saved = false;
  await db.updateGoogle(scope, conn.connectedAt, (cur) => {
    same = cur.locationName === match.location;
    previous = cur.locationName;
    saved = true;
    return { ...cur, ...locationFields(match), ...(same ? { insights: cur.insights, profile: cur.profile } : { profile: undefined }) };
  });
  if (!saved) return { error: "Your Google connection changed meanwhile. Reload the page and choose again." };
  if (!same && previous) {
    const b = await db.getBusiness(scope);
    if (b) await db.saveBusiness(scope, forgetGoogleValues(b));
  }
  // Read the new location's profile now and fill the business details from it.
  const sync = await syncBusinessFromGoogle(scope);
  revalidatePath("/app", "layout");
  if (fd.get("next") === "dashboard") redirect("/app");
  // Settings and the Google page hide the location list once one is chosen, so the result is shown after a redirect.
  if (fd.get("next") === "settings") redirect(`/app/settings?location=${sync.error ? "unsynced" : "saved"}#google`);
  return sync.error
    ? { ok: `Location saved: ${match.title}. Its details could not be read from Google yet: ${sync.error}` }
    : { ok: `Location saved: ${match.title}. ${syncMessage(sync)}` };
}

export async function disconnectGoogleAction(fd: FormData) {
  const { user, scope } = await requireScope();
  const conn = await db.getGoogle(scope);
  // Locations added from the same Google account share its grant: revoking it would disconnect them too, so Google
  // is asked to cancel access only when no other location uses it.
  const shared = conn ? await sharedWithOtherLocation(user.id, scope.loc, conn) : false;
  const revoked = conn ? (shared ? false : await revokeGoogle(conn)) : true;
  // The connection record holds the tokens, the chosen location, its profile snapshot and insights: all removed.
  await db.deleteGoogle(scope);
  if (conn) {
    const name = (await db.getBusiness(scope))?.name;
    after(() => notifySecurity(user, "google_disconnected", `Google account: ${conn.email ?? "unknown"}${name ? `, location: ${name}` : ""}.`).then(() => undefined, () => undefined));
  }
  revalidatePath("/app", "layout");
  const page = fd?.get("back") === "settings" ? "/app/settings" : "/app/google-profile";
  redirect(`${page}?disconnected=${shared ? "shared" : revoked ? "1" : "local"}`);
}

async function sharedWithOtherLocation(userId: string, loc: string, conn: GoogleConnection): Promise<boolean> {
  const { ids } = await db.getLocations(userId);
  for (const other of ids) {
    if (other === loc) continue;
    const c = await db.getGoogle({ userId, loc: other });
    if (c && sameGrant(c, conn)) return true;
  }
  return false;
}

/* ---------------- Automation ---------------- */

/**
 * Review automation for the current location. "auto" needs a connected Google profile and the owner's explicit
 * confirmation; pausing or switching to manual cancels any queued automatic work at once.
 */
export async function saveAutomationAction(_: FormState, fd: FormData): Promise<FormState> {
  const { user, scope } = await requireScope();
  const b = await db.getBusiness(scope);
  if (!b) return { error: "Add your business details first." };
  const cur = b.automation ?? defaultAutomation();
  const replies = z.enum(["manual", "approval", "auto"]).catch(cur.replies).parse(fd.get("replies") ?? cur.replies);
  const autoMinStars = fd.get("autoMinStars") === "4" ? 4 : 5;
  const paused = fd.has("paused") ? fd.get("paused") === "yes" : cur.paused;
  let autoOptInAt = cur.autoOptInAt;
  if (replies === "auto") {
    if (!live(await db.getGoogle(scope))) return { error: "Automatic publishing needs a connected Google Business Profile for this location." };
    if (cur.replies !== "auto" || !autoOptInAt) {
      if (fd.get("confirmAuto") !== "yes") return { error: "Tick the box to confirm that eligible replies may be published without you." };
      autoOptInAt = new Date().toISOString();
    }
  } else autoOptInAt = undefined;
  const next = { replies, paused, autoMinStars: autoMinStars as 4 | 5, autoOptInAt };
  await db.saveBusiness(scope, { ...b, automation: next });
  if (paused || replies === "manual") await cancelMatching(user.id, `review_sweep:${scope.loc}:`, paused ? "Automation paused by the owner." : "Review automation switched off.");
  await logAutomation(scope, { action: "Settings changed", result: "done", detail: `Replies: ${replies}${replies === "auto" ? `, ${autoMinStars}+ stars` : ""}${paused ? ", paused" : ""}.` });
  revalidatePath("/app", "layout");
  return { ok: paused ? "Automation paused. Nothing will run until you resume it." : replies === "manual" ? "Saved. Replies are drafted only when you ask." : replies === "approval" ? "Saved. New reviews get a draft reply for you to approve." : "Saved. Eligible replies will be published automatically; everything else waits for you." };
}

/** One-click pause or resume, from the Reviews page. */
export async function toggleAutomationPauseAction(fd: FormData) {
  const { user, scope } = await requireScope();
  const b = await db.getBusiness(scope);
  if (!b) return;
  const cur = b.automation ?? defaultAutomation();
  const paused = fd.get("paused") === "yes";
  await db.saveBusiness(scope, { ...b, automation: { ...cur, paused } });
  if (paused) await cancelMatching(user.id, `review_sweep:${scope.loc}:`, "Automation paused by the owner.");
  await logAutomation(scope, { action: paused ? "Automation paused" : "Automation resumed", result: "done", detail: "By the owner." });
  revalidatePath("/app", "layout");
}

/* ---------------- Monthly reports ---------------- */

/** Creates this month's report now (marked "month to date"), or rebuilds a past month's. Rate limited (Claude call). */
export async function createReportAction(_: FormState, fd: FormData): Promise<FormState> {
  const { user, scope } = await requireScope();
  const month = String(fd.get("month") ?? new Date().toISOString().slice(0, 7));
  if (!/^\d{4}-\d{2}$/.test(month) || month > new Date().toISOString().slice(0, 7)) return { error: "Choose this month or an earlier one." };
  const rl = await takeShared(`report:${user.id}`, { limit: 10, windowMs: 60 * 60_000 });
  if (!rl.ok) return { error: waitMessage("reports", rl.retryAfterSec) };
  const r = await buildMonthlyReport(scope, month, "owner");
  revalidatePath("/app/reports");
  if (r.error) return { error: r.error };
  return { ok: r.summaryError ? `Report created. The AI summary could not be written: ${r.summaryError}` : "Report created." };
}

/* ---------------- Review link sharing ---------------- */

const SHARE_EVENTS = ["whatsapp_opened", "qr_downloaded", "link_copied", "message_copied"] as const;
export type ShareEvent = (typeof SHARE_EVENTS)[number];

/**
 * Counts one share action in this app (per location and month). Only the action is counted: whether a customer then
 * wrote a review is not known and never claimed.
 */
export async function recordShareEventAction(kind: ShareEvent): Promise<void> {
  const { user, scope } = await requireScope();
  if (!SHARE_EVENTS.includes(kind)) return;
  if (!(await takeShared(`share:${user.id}`, { limit: 200, windowMs: 60 * 60_000 })).ok) return;
  const m = new Date().toISOString().slice(0, 7);
  // One atomic step, so two share actions at the same moment are both counted.
  await db.updateLocal<Record<string, Partial<Record<ShareEvent, number>>>>(scope, "share_events", {}, (all) => {
    const next = { ...all, [m]: { ...(all[m] ?? {}), [kind]: (all[m]?.[kind] ?? 0) + 1 } };
    return Object.fromEntries(Object.entries(next).sort(([x], [y]) => y.localeCompare(x)).slice(0, 12));
  });
}

/* ---------------- Locations ---------------- */

/** Switches the location the app shows. Only one of the user's own locations can be chosen. */
export async function switchLocationAction(fd: FormData) {
  const { user } = await requireScope();
  const loc = String(fd.get("loc") ?? "");
  let known = false;
  await db.updateLocations(user.id, (idx) => (idx.ids.includes(loc) ? ((known = true), { ...idx, active: loc }) : undefined));
  if (!known) return;
  revalidatePath("/app", "layout");
  redirect(String(fd.get("to") ?? "") === "overview" ? "/app/locations" : "/app");
}

const MAX_LOCATIONS = 25;

/** Adds an empty location and opens onboarding for it. Nothing from other locations is copied. */
export async function addLocationAction() {
  const { user } = await requireScope();
  const id = randomUUID().replace(/-/g, "").slice(0, 10);
  let full = false;
  await db.updateLocations(user.id, (idx) => (idx.ids.length >= MAX_LOCATIONS ? ((full = true), undefined) : { active: id, ids: [...idx.ids, id] }));
  if (full) redirect("/app/locations?error=limit");
  revalidatePath("/app", "layout");
  redirect("/app/onboarding");
}

/**
 * Removes one location after the owner typed its name. Its scheduled work is cancelled, its Google access is revoked
 * (unless another location shares the same Google sign-in), and only its own data is deleted. Other locations, the
 * account, and the business's Google Business Profile itself are not changed. The last location cannot be removed.
 */
export async function removeLocationAction(_: FormState, fd: FormData): Promise<FormState> {
  const { user } = await requireScope();
  const idx = await db.getLocations(user.id);
  const loc = String(fd.get("loc") ?? "");
  const i = idx.ids.indexOf(loc);
  if (i < 0) return { error: "That location is not in your account. Reload the page." };
  if (idx.ids.length < 2) return { error: "This is your only location. To remove everything, use Delete my data in Settings." };
  const scope: Scope = { userId: user.id, loc };
  const name = (await db.getBusiness(scope))?.name ?? `New location ${i + 1}`;
  const norm = (x: string) => x.trim().replace(/\s+/g, " ").toLowerCase();
  if (norm(String(fd.get("confirmName") ?? "")) !== norm(name)) return { error: `Type the location name exactly as shown (${name}) to confirm.` };
  await cancelLocationJobs(user.id, loc, "The location was removed.");
  const conn = await db.getGoogle(scope);
  if (conn && !(await sharedWithOtherLocation(user.id, loc, conn))) await revokeGoogle(conn); // best effort; tokens are deleted next
  const r = await db.removeLocation(user.id, loc);
  if (!r.ok) return { error: "The location could not be removed. Reload the page and try again." };
  revalidatePath("/app", "layout");
  redirect("/app/locations?removed=1");
}

/**
 * Adds another Business Profile location from the Google account connected to the current location. The new app
 * location shares that Google sign-in, gets its own location binding, and its details come from Google.
 */
export async function addGoogleLocationAction(_: FormState, fd: FormData): Promise<FormState> {
  const { user, scope } = await requireScope();
  const conn = await db.getGoogle(scope);
  const b = await db.getBusiness(scope);
  if (!live(conn) || !b) return { error: "Connect Google and choose a location first." };
  const idx = await db.getLocations(user.id);
  if (idx.ids.length >= MAX_LOCATIONS) return { error: `You can manage up to ${MAX_LOCATIONS} locations.` };
  const { locations, error } = await fetchLocations(scope);
  if (error) return { error };
  const pick = locations.find((l) => l.location === String(fd.get("location") ?? ""));
  if (!pick) return { error: "That location is not on your connected Google account. Reload the page and choose again." };
  // Never two app locations for one Business Profile location: their reviews and posts would be the same.
  for (const other of idx.ids) {
    const c = await db.getGoogle({ userId: user.id, loc: other });
    if (c?.locationName === pick.location) return { error: "That location is already in your account." };
  }
  const id = randomUUID().replace(/-/g, "").slice(0, 10);
  const next: Scope = { userId: user.id, loc: id };
  // The location is added to the list first: with the database a location must exist before data is saved to it.
  await db.updateLocations(user.id, (cur) => ({ active: id, ids: [...cur.ids, id] }));
  await db.saveBusiness(next, { name: pick.title, website: "", location: pick.city || b.location, type: b.type, category: defaultCategory(b.type), language: b.language ?? "en",
    audit: {}, sources: { name: "google" }, createdAt: new Date().toISOString() });
  await db.saveGoogle(next, { email: conn.email, tokens: conn.tokens, scopes: conn.scopes, connectedAt: new Date().toISOString(), ...locationFields(pick) });
  const sync = await syncBusinessFromGoogle(next);
  revalidatePath("/app", "layout");
  redirect(`/app?added=${sync.error ? "unsynced" : "1"}`);
}

/* ---------------- Reviews ---------------- */
/**
 * Reply workflow: draft (Claude or typed) -> save -> approve this exact text -> publish to Google.
 * Publishing needs an approved reply whose text is unchanged since approval; nothing is ever sent without it.
 */
export async function replyAction(_: FormState, fd: FormData): Promise<FormState> {
  const { user, scope } = await requireScope();
  const b = await db.getBusiness(scope);
  if (!b) return { error: "Add your business details first." };
  const intent = String(fd.get("intent"));
  const id = String(fd.get("reviewId"));
  // The review must be one this user can see: read from Google for their selected location, or a labelled sample.
  // Its text and rating come from that source, not from the submitted form.
  const { review, conn, error } = await findReview(scope, id);
  if (!review) return { error: error ?? "That review could not be found. Reload the page and try again." };
  const replies = await db.getReplies(scope);
  const now = new Date().toISOString();
  const cls = classifyReview(review, b.type);
  const saved = replies[id];
  const log = (entry: Omit<ReplyHistoryEntry, "at">) => [{ at: now, ...entry }, ...(saved?.history ?? [])].slice(0, 20);

  if (intent === "draft" || intent.startsWith("rewrite:")) {
    const variant = (intent === "draft" ? "new" : intent.slice(8)) as ReplyVariant;
    if (!["new", "regenerate", "shorter", "longer", "professional", "friendly"].includes(variant)) return { error: "Unknown action." };
    const current = String(fd.get("text") ?? "").trim();
    if (variant !== "new" && variant !== "regenerate" && !current) return { error: "Draft a reply first, then ask for a change." };
    const rl = await takeShared(`draft:${user.id}`, LIMITS.draftPerUser);
    if (!rl.ok) return { error: waitMessage("drafts", rl.retryAfterSec) };
    try {
      const text = await draftReply(b, { stars: review.stars, comment: review.comment, firstName: review.reviewer.split(" ")[0] },
        { variant, current, styleExamples: styleExamples(replies, id) });
      const warnings = replyIssues(text, review, b);
      replies[id] = { ...saved, text, status: "draft", updatedAt: now, holdReasons: [...cls.reasons, ...warnings], byAutomation: false,
        history: log({ action: variant === "new" ? "drafted" : "rewritten", by: "claude", text, note: variant === "new" ? undefined : variant }) };
      await db.saveReplies(scope, replies);
      revalidatePath("/app/reviews");
      return { text, status: "draft", warnings };
    } catch (e) {
      return { error: e instanceof Error ? e.message : "Could not draft a reply." };
    }
  }

  const text = String(fd.get("text") ?? "").trim();
  if (!text) return { error: "Write or draft a reply first." };
  if (Buffer.byteLength(text, "utf8") > REPLY_MAX_BYTES) return { error: "This reply is too long for Google. Shorten it (Google allows about 4000 English characters, fewer in Hindi)." };
  const warnings = replyIssues(text, review, b);
  const edited = saved?.text !== text;

  if (intent === "save") {
    replies[id] = { ...saved, text, status: "draft", updatedAt: now, holdReasons: [...cls.reasons, ...warnings], history: edited ? log({ action: "edited", by: "owner", text }) : saved?.history };
    await db.saveReplies(scope, replies);
    revalidatePath("/app/reviews");
    return { ok: "Draft saved.", text, warnings, status: "draft" };
  }

  if (intent === "approve" || intent === "post") {
    // Negative and sensitive reviews: the owner confirms they have read the reply (the checkbox is shown for them).
    if ((cls.sentiment === "negative" || cls.sensitive) && fd.get("confirmSensitive") !== "yes") {
      return { error: "This review needs extra care. Read the reply, then tick the box to confirm before approving.", text, warnings, status: saved?.status };
    }
    replies[id] = { ...saved, text, status: "approved", updatedAt: now, holdReasons: [...cls.reasons, ...warnings], history: log({ action: "approved", by: "owner", text }) };
    await db.saveReplies(scope, replies);
    revalidatePath("/app/reviews");
    const ok = conn ? "Approved. Check it once more, then publish it to Google." : "Approved and saved. It will be published only after Google is connected, a location is chosen, and you press Publish.";
    return { ok, text, warnings, status: "approved" };
  }

  if (intent === "publish") {
    if (!conn) return { error: "Publishing to Google is not available yet. Your approved reply is saved.", text, status: saved?.status };
    if (review.source !== "google_api") return { error: "This is a sample review and cannot be posted." };
    if (saved?.status !== "approved" || saved.text !== text) {
      return { error: "Approve this exact reply before publishing it. Changes made after approving need approving again.", text, status: saved?.status };
    }
    const rl = await takeShared(`gbp-edit:${conn.locationName}`, LIMITS.gbpEditsPerLocation);
    if (!rl.ok) return { error: "Google allows only a few changes a minute for one business. Try again in a minute.", text, status: "approved" };
    try {
      const r = await withGoogle(scope, conn, "reply", (t) => updateReply(t, id, text));
      replies[id] = { ...saved, text, status: "posted", updatedAt: now, postedAt: now, googleState: r.state, history: log({ action: "published", by: "owner", text, note: r.state }) };
      await db.saveReplies(scope, replies);
      // Not revalidated here: the review would leave the "Waiting for reply" list before the owner sees the result.
      const pending = r.state === "PENDING" ? " Google is checking it before it appears." : "";
      return { ok: (warnings.length ? "Published to Google. Reread it: " + warnings.join(" ") : "Published to Google.") + pending, text, status: "posted" };
    } catch (e) {
      replies[id] = { ...saved, history: log({ action: "failed", by: "owner", note: e instanceof Error ? e.message : "Google did not accept the reply." }) };
      await db.saveReplies(scope, replies);
      return { error: e instanceof Error ? e.message : "Google did not accept the reply.", text, status: "approved" };
    }
  }
  return { error: "Unknown action." };
}

/** Up to three replies the owner published at this location (not this review's), newest first, as style examples. */
function styleExamples(replies: Record<string, ReplyDraft>, except: string): string[] {
  return Object.entries(replies).filter(([k, r]) => k !== except && r.status === "posted" && r.text).sort(([, a], [, b]) => (b.postedAt ?? "").localeCompare(a.postedAt ?? "")).slice(0, 3).map(([, r]) => r.text);
}

/* ---------------- Posts ---------------- */
export async function postComposerAction(_: FormState, fd: FormData): Promise<FormState> {
  const { user, scope } = await requireScope();
  const b = await db.getBusiness(scope);
  if (!b) return { error: "Add your business details first." };
  const intent = String(fd.get("intent"));

  if (intent === "draft") {
    const topic = String(fd.get("topic") ?? "").trim();
    if (topic.length < 5) return { error: "Say what the post is about, in a few words.", values: vals(fd) };
    if (topic.length > 200) return { error: "Keep the topic under 200 characters.", values: vals(fd) };
    const rl = await takeShared(`draft:${user.id}`, LIMITS.draftPerUser);
    if (!rl.ok) return { error: waitMessage("drafts", rl.retryAfterSec), values: vals(fd) };
    const kind = String(fd.get("kind") ?? "STANDARD");
    const cta = String(fd.get("ctaType") ?? "") || undefined;
    // Recent posts, so Claude does not repeat them.
    const previous = (await db.getPosts(scope)).slice(0, 5).map((p) => p.text);
    try {
      const variants = await draftPostVariants(b, topic, { kind, cta, previous });
      const list = variants ?? [await draftPost(b, topic, { kind, cta, previous })];
      const flagged = b.type === "healthcare" && list.some((t) => medicalWarnings(t).length);
      return { text: list[0], variants: list.length > 1 ? list : undefined, values: vals(fd),
        ok: flagged ? "Drafted. Check the notes below before saving." : list.length > 1 ? `Drafted ${list.length} versions. Pick one, edit it, then save.` : "Drafted. Edit it, then save." };
    } catch (e) {
      return { error: e instanceof Error ? e.message : "Could not draft a post.", values: vals(fd) };
    }
  }

  const text = String(fd.get("text") ?? "").trim();
  const fail = (error: string): FormState => ({ error, values: vals(fd) });
  if (text.length < 10) return fail("Write the post text first.");
  if (text.length > 1500) return fail("Google posts can be at most 1500 characters.");
  const kind = z.enum(["STANDARD", "EVENT", "OFFER"]).catch("STANDARD").parse(fd.get("kind"));
  if (kind === "OFFER" && b.type === "healthcare") return fail("Offer posts are not available for healthcare businesses.");
  const scheduledFor = String(fd.get("scheduledFor") ?? "").trim() || undefined;
  if (scheduledFor && !isLocalDateTime(scheduledFor)) return fail("Choose a valid date and time for the schedule, or leave it empty.");
  const scheduledAt = scheduledFor ? toUtc(scheduledFor, fd.get("tz")) : undefined;
  if (scheduledFor && !scheduledAt) return fail("Your time zone could not be read. Reload the page and try again.");
  if (scheduledAt && Date.parse(scheduledAt) < Date.now() + 60_000) return fail("Choose a time in the future for the schedule.");
  const cta = postCta(fd);
  if ("error" in cta) return fail(cta.error);

  const str = (k: string) => String(fd.get(k) ?? "").trim();
  let event: PostDraft["event"];
  let offer: PostDraft["offer"];
  if (kind !== "STANDARD") {
    const title = str("eventTitle"), start = str("eventStart"), end = str("eventEnd");
    const what = kind === "EVENT" ? "event" : "offer";
    if (!title) return fail(`Give the ${what} a title.`);
    if (title.length > 100) return fail(`Keep the ${what} title under 100 characters.`);
    if (!isLocalDateTime(start) || !isLocalDateTime(end)) return fail(`Choose a valid start and end date and time for the ${what}.`);
    if (end <= start) return fail(`The ${what} must end after it starts.`);
    event = { title, start, end };
  }
  if (kind === "OFFER") {
    const couponCode = str("couponCode"), termsConditions = str("termsConditions"), redeemOnlineUrl = str("redeemOnlineUrl");
    if (couponCode.length > 60) return fail("Keep the coupon code under 60 characters.");
    if (termsConditions.length > 1500) return fail("Keep the terms under 1500 characters.");
    if (redeemOnlineUrl && !/^https?:\/\/\S+$/i.test(redeemOnlineUrl)) return fail("The redeem link must start with http:// or https://.");
    offer = { couponCode: couponCode || undefined, termsConditions: termsConditions || undefined, redeemOnlineUrl: redeemOnlineUrl || undefined };
  }

  const image = postImage(str("imageUrl"));
  if ("error" in image) return fail(image.error);

  const warnings = b.type === "healthcare" ? medicalWarnings([text, event?.title ?? ""].join(" ")) : [];
  const posts = await db.getPosts(scope);
  const p: PostDraft = { id: randomUUID(), text, kind, scheduledFor, scheduledAt, callToAction: cta.value, event, offer, imageUrl: image.value, status: "draft", warnings, createdAt: new Date().toISOString() };
  await db.savePosts(scope, [p, ...posts]);
  revalidatePath("/app/posts");
  return { ok: warnings.length ? "Saved as a draft. Read the notes before you approve it." : "Saved as a draft.", saved: Date.now() };
}

/** Approve, publish, delete and edit buttons on a saved post (plain form, no message shown). */
export async function postItemAction(fd: FormData): Promise<void> {
  await postItem(fd);
}

/** The edit form on a saved post. Same logic as postItemAction, but returns a message to show. */
export async function editPostAction(_: FormState, fd: FormData): Promise<FormState> {
  fd.set("intent", "edit");
  return postItem(fd);
}

async function postItem(fd: FormData): Promise<FormState> {
  const { user, scope } = await requireScope();
  const id = String(fd.get("id"));
  const intent = String(fd.get("intent"));
  let posts = await db.getPosts(scope);
  if (intent === "delete") {
    posts = posts.filter((p) => p.id !== id);
    await cancelMatching(user.id, schedulePrefix(scope.loc, id), "The post was deleted.");
  }
  const p = posts.find((x) => x.id === id);
  if (intent === "edit") {
    if (!p) return { error: "That post no longer exists. Reload the page." };
    const text = String(fd.get("text") ?? "").trim();
    // Same length rules as a new post.
    if (text.length < 10) return { error: "Write at least 10 characters." };
    if (text.length > 1500) return { error: "Google posts can be at most 1500 characters." };
    const b = await db.getBusiness(scope);
    // The schedule can be changed (or cleared) in the same form.
    let scheduledFor = p.scheduledFor, scheduledAt = p.scheduledAt;
    if (fd.has("scheduledFor")) {
      scheduledFor = String(fd.get("scheduledFor") ?? "").trim() || undefined;
      if (scheduledFor && !isLocalDateTime(scheduledFor)) return { error: "Choose a valid date and time for the schedule, or leave it empty." };
      scheduledAt = scheduledFor ? toUtc(scheduledFor, fd.get("tz")) : undefined;
      if (scheduledFor && !scheduledAt) return { error: "Your time zone could not be read. Reload the page and try again." };
      if (scheduledAt && scheduledAt !== p.scheduledAt && Date.parse(scheduledAt) < Date.now() + 60_000) return { error: "Choose a time in the future for the schedule." };
    }
    if (text === p.text && scheduledAt === p.scheduledAt) return { ok: "No changes to save." };
    // Any queued publication of the old version is cancelled; the post is approved (and queued) again.
    await cancelMatching(user.id, schedulePrefix(scope.loc, p.id), "The post was edited after it was scheduled.");
    p.scheduledFor = scheduledFor;
    p.scheduledAt = scheduledAt;
    p.text = text;
    p.status = "draft"; // an edited post must be approved again; a published one keeps its Google name for updating
    p.publishError = undefined;
    p.warnings = b?.type === "healthcare" ? medicalWarnings([text, p.event?.title ?? ""].join(" ")) : [];
    await db.savePosts(scope, posts);
    revalidatePath("/app/posts");
    return { ok: p.googleName ? "Changes saved. Approve them, then publish the changes to Google." : "Changes saved. The post is a draft again." };
  }
  if (p && intent === "approve") {
    p.status = "approved";
    p.publishError = undefined;
    // A future time puts the post in the publishing queue; a time already passed is never published silently.
    if (p.scheduledAt && Date.parse(p.scheduledAt) > Date.now()) {
      await enqueue(user.id, { kind: "publish_post", loc: scope.loc, key: scheduleKey(scope.loc, p), runAt: new Date(p.scheduledAt), payload: { postId: p.id, scheduledAt: p.scheduledAt } });
    } else if (p.scheduledAt) {
      p.publishError = "The scheduled time has passed. Publish it now, or edit it to choose a new time.";
    }
  }
  if (p && intent === "publish") {
    const r = await publishPost(scope, p);
    // The post stays approved after a failure so the owner can try again; the reason is shown on the post.
    if (r.ok) Object.assign(p, r.post);
    else p.publishError = r.reason;
    if (r.ok && p.scheduledAt) await cancelJobs(user.id, scheduleKey(scope.loc, p), "Published by hand before the scheduled time.");
  }
  await db.savePosts(scope, posts);
  revalidatePath("/app/posts");
  return {};
}

/* ---------------- ChatGPT guide ---------------- */
export async function toggleGuideAction(fd: FormData) {
  const { user, scope } = await requireScope();
  const g = await db.getProgress(scope);
  const key = String(fd.get("key"));
  if (!CHATGPT_PREPARE.some((i) => i.key === key)) return;
  g.done = { ...g.done, [key]: !g.done[key] };
  await db.saveProgress(scope, g);
  revalidatePath("/app/chatgpt-guide");
}

export async function saveGuideNotesAction(_: FormState, fd: FormData): Promise<FormState> {
  const { user, scope } = await requireScope();
  const g = await db.getProgress(scope);
  g.notes = String(fd.get("notes") ?? "").slice(0, 4000);
  await db.saveProgress(scope, g);
  revalidatePath("/app/chatgpt-guide");
  return { ok: "Notes saved." };
}

const insightSchema = z.object({
  date: z.string().min(1, "Choose the date."),
  label: z.string().trim().min(2, "Say what the number is.").max(80),
  value: z.string().trim().min(1, "Enter the value.").max(40),
});

export async function addInsightAction(_: FormState, fd: FormData): Promise<FormState> {
  const { user, scope } = await requireScope();
  const parsed = insightSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error), values: vals(fd) };
  const g = await db.getProgress(scope);
  g.insights = [parsed.data, ...g.insights].slice(0, 50);
  await db.saveProgress(scope, g);
  revalidatePath("/app/chatgpt-guide");
  return { ok: "Added." };
}

/**
 * Insights have no ids, so an entry is addressed by its position in the signed-in user's own list.
 * The form also sends the entry as it was shown; if the list changed since the page loaded, nothing is changed.
 */
async function findInsight(scope: Scope, fd: FormData) {
  const g = await db.getProgress(scope);
  const n = Number(fd.get("index"));
  const cur = Number.isInteger(n) && n >= 0 ? g.insights[n] : undefined;
  const same = cur && cur.date === fd.get("origDate") && cur.label === fd.get("origLabel") && cur.value === fd.get("origValue");
  return { g, n, found: Boolean(same) };
}

export async function editInsightAction(_: FormState, fd: FormData): Promise<FormState> {
  const { user, scope } = await requireScope();
  const parsed = insightSchema.safeParse({ date: fd.get("date"), label: fd.get("label"), value: fd.get("value") });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
  const { g, n, found } = await findInsight(scope, fd);
  if (!found) return { error: "This entry changed or was removed. Reload the page and try again." };
  g.insights[n] = parsed.data;
  await db.saveProgress(scope, g);
  revalidatePath("/app/chatgpt-guide");
  return { ok: "Saved." };
}

export async function deleteInsightAction(_: FormState, fd: FormData): Promise<FormState> {
  const { user, scope } = await requireScope();
  const { g, n, found } = await findInsight(scope, fd);
  if (!found) return { error: "This entry changed or was removed. Reload the page and try again." };
  g.insights.splice(n, 1);
  await db.saveProgress(scope, g);
  revalidatePath("/app/chatgpt-guide");
  return {};
}

/* ---------------- Google Places ---------------- */
async function placesBudget(userId: string, cost = 1): Promise<string | null> {
  const rl = await takeShared(`places:${userId}`, LIMITS.placesPerUser, cost);
  return rl.ok ? null : waitMessage("Google Places requests", rl.retryAfterSec);
}

/** Business finder: up to 5 Google listings for a name, city and optional state, labelled for the owner to choose from. */
export async function searchPlacesAction(name: string, city: string, state = ""): Promise<{ error?: string; note?: string; matches?: DiscoveryMatch[] }> {
  const { user, scope } = await requireScope();
  name = String(name ?? "").trim().slice(0, 120);
  city = String(city ?? "").trim().slice(0, 120);
  state = String(state ?? "").trim().slice(0, 60);
  if (name.length < 2 && city.length < 2) return { error: "Enter your business name and city first." };
  if (name.length < 2) return { error: "Enter your business name first." };
  if (city.length < 2) return { error: "Enter the city or area first." };
  if (!env.placesConfigured()) return { error: "Searching Google is not available right now. Enter your Place ID manually instead." };
  const wait = await placesBudget(user.id);
  if (wait) return { error: wait };
  try {
    const matches = labelMatches(name, await findPlaces(name, city, state));
    // Google often suggests loosely related places when nothing has the name; say so plainly.
    if (matches.length && matches.every((m) => m.match === "different"))
      return { matches, note: "Google found no business with this name. These are other places it suggested; select one only if it is really yours, or try a different spelling." };
    return matches.length
      ? { matches }
      : { error: "Google found no business with that name in that city. Check the spelling, try a shorter name or a nearby area, add the state, or enter your Place ID manually." };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "The search failed. Try again." };
  }
}

const placeIdInput = z.string().trim().refine((v) => validPlaceId(v), "That is not a Google Place ID. Place IDs look like ChIJ… and have no spaces or symbols.");

/** One listing's name and address, fetched fresh, to show the saved listing or check a typed Place ID. */
export async function lookupPlaceAction(placeId: string): Promise<{ place?: PlaceSummary; error?: string; notFound?: boolean }> {
  const { user, scope } = await requireScope();
  const id = placeIdInput.safeParse(placeId);
  if (!id.success) return { error: id.error.issues[0].message };
  if (!env.placesConfigured()) return { error: "Google cannot be checked right now." };
  const wait = await placesBudget(user.id);
  if (wait) return { error: wait };
  try {
    return { place: await placeSummary(id.data) };
  } catch (e) {
    if (isNotFound(e)) return { notFound: true, error: "Google has no listing with this Place ID. Check it, or search for your business instead." };
    return { error: e instanceof Error ? e.message : "Google could not be checked." };
  }
}

export type SavePlaceResult = { ok?: string; error?: string; needsConfirm?: boolean; canForce?: boolean; place?: PlaceSummary };

/**
 * Saves the Google listing for an existing business (Settings). Only the Place ID changes: name, category, city,
 * history and recommendations are kept. Replacing a saved listing needs `replace`; a typed ID is checked with
 * Google first, and can be saved unchecked (`force`) only when Google could not be reached, never when it says
 * the place does not exist.
 */
export async function savePlaceIdAction(placeId: string, opts: { replace?: boolean; force?: boolean } = {}): Promise<SavePlaceResult> {
  const { user, scope } = await requireScope();
  const b = await db.getBusiness(scope);
  if (!b) return { error: "Add your business details first." };
  const id = placeIdInput.safeParse(placeId);
  if (!id.success) return { error: id.error.issues[0].message };
  // Once a Business Profile location with a Place ID is chosen, the listing follows that location.
  const conn = await db.getGoogle(scope);
  if (live(conn) && conn.locationPlaceId && conn.locationPlaceId === b.placeId && id.data !== b.placeId) {
    return { error: "Your listing follows your Google Business Profile location. Change the location in Settings to use a different listing." };
  }
  if (b.placeId && b.placeId !== id.data && !opts.replace) return { needsConfirm: true };
  let place: PlaceSummary | undefined;
  if (env.placesConfigured() && !opts.force) {
    const wait = await placesBudget(user.id);
    if (wait) return { error: wait, canForce: true };
    try {
      place = await placeSummary(id.data);
    } catch (e) {
      if (isNotFound(e)) return { error: "Google has no listing with this Place ID. Check it, or search for your business instead." };
      return { error: `${e instanceof Error ? e.message : "Google could not be checked."} You can save the ID without checking.`, canForce: true };
    }
  }
  if (b.placeId !== id.data) {
    // Earlier measurements stay, labelled with the old listing, so they are never shown as the new one's.
    if (b.placeId) await db.savePlaces(scope, tagHistory(await db.getPlaces(scope), b.placeId));
    b.placeId = id.data;
    await db.saveBusiness(scope, b);
    revalidatePath("/app", "layout");
  }
  return { ok: place ? "Google listing saved." : "Place ID saved without checking it with Google.", place };
}

export type AuditState = { error?: string; name?: string; score?: number; previous?: number; items?: AuditItem[]; checklist?: Record<string, GoogleVerdict> };

export async function profileAuditAction(_: AuditState, __: FormData): Promise<AuditState> {
  const { user, scope } = await requireScope();
  const b = await db.getBusiness(scope);
  if (!b?.placeId || !validPlaceId(b.placeId)) return { error: "Add your Google Place ID in Settings first." };
  const wait = await placesBudget(user.id);
  if (wait) return { error: wait };
  try {
    const r = await profileAudit(b.placeId, b);
    const h = await db.getPlaces(scope);
    const previous = historyFor(h, b.placeId).profileScores[0]?.score;
    // Our own score, points per item and checklist verdicts only; Google's values are not kept.
    const items = Object.fromEntries(r.items.map((i) => [i.key, i.points]));
    h.profileScores = [{ score: r.score, at: new Date().toISOString(), items, checklist: r.checklist, placeId: b.placeId }, ...h.profileScores].slice(0, 30);
    await db.savePlaces(scope, h);
    revalidatePath("/app", "layout");
    return { ...r, previous };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "The profile audit failed." };
  }
}

export type CompetitorState = { error?: string } & Partial<Awaited<ReturnType<typeof competitors>>>;

export async function competitorsAction(_: CompetitorState, __: FormData): Promise<CompetitorState> {
  const { user, scope } = await requireScope();
  const b = await db.getBusiness(scope);
  if (!b?.placeId || !validPlaceId(b.placeId)) return { error: "Add your Google Place ID in Settings first." };
  const wait = await placesBudget(user.id, 2);
  if (wait) return { error: wait };
  try {
    const r = await competitors(b.placeId, b);
    // Counts only (how many were ahead or behind); names, ratings and other Google values are not kept.
    const h = await db.getPlaces(scope);
    const snapshot = { at: new Date().toISOString(), query: r.query, position: r.position, compared: r.analysis.compared, metrics: metricsForHistory(r.analysis), placeId: b.placeId };
    h.competitors = [snapshot, ...(h.competitors ?? [])].slice(0, 20);
    await db.savePlaces(scope, h);
    revalidatePath("/app", "layout");
    return r;
  } catch (e) {
    return { error: e instanceof Error ? e.message : "The comparison failed." };
  }
}

/** Claude's explanation of the latest competitor comparison for the current listing and search (saved with it). */
export async function explainCompetitorsAction(): Promise<FormState> {
  const { user, scope } = await requireScope();
  const b = await db.getBusiness(scope);
  if (!b) return { error: "Add your business details first." };
  const all = await db.getPlaces(scope);
  const snap = historyFor(all, b.placeId, categoryQuery(b)).competitors?.[0];
  if (!snap) return { error: "Run the competitor comparison first." };
  if (snap.explanation) return { ok: "Explained." };
  const rl = await takeShared(`draft:${user.id}`, LIMITS.draftPerUser);
  if (!rl.ok) return { error: waitMessage("AI requests", rl.retryAfterSec) };
  const facts = `Search: "${snap.query}". Businesses compared: ${snap.compared}. Owner's position: ${snap.position ?? "not in the top results"}.\n` +
    snap.metrics.map((m) => `${m.metric}: data for ${m.known}; ahead of the owner: ${m.ahead}; behind: ${m.behind}${m.youHave === undefined ? "" : `; the owner has it: ${m.youHave ? "yes" : "no"}`}`).join("\n");
  try {
    const text = await explainCompetitors(b, facts);
    const fresh = await db.getPlaces(scope);
    const i = (fresh.competitors ?? []).findIndex((c) => c.at === snap.at && c.query === snap.query);
    if (i >= 0) {
      fresh.competitors![i] = { ...fresh.competitors![i], explanation: text };
      await db.savePlaces(scope, fresh);
    }
    revalidatePath("/app/google-profile");
    return { ok: "Explained." };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not explain the comparison." };
  }
}

export type GridState = { error?: string; ok?: string };

/**
 * Runs a 3x3 (9 points) or 5x5 (25 points) rank grid scan. Cost controls: a daily allowance of grid points per user
 * (all locations together, counted from saved scans), and the hourly Google Places request budget, which is charged
 * the exact number of requests the scan makes before it starts.
 */
export async function rankScanAction(_: GridState, fd: FormData): Promise<GridState> {
  const { user, scope } = await requireScope();
  const b = await db.getBusiness(scope);
  if (!b?.placeId || !validPlaceId(b.placeId)) return { error: "Add your Google Place ID in Settings first." };
  const keyword = String(fd.get("keyword") ?? "").trim();
  if (keyword.length < 2 || keyword.length > 80) return { error: "Enter a search phrase of 2 to 80 characters, for example: skin clinic near me." };
  const radiusKm = Number(fd.get("radiusKm"));
  if (![1, 3, 5].includes(radiusKm)) return { error: "Choose 1, 3 or 5 km." };
  const size = Number(fd.get("size") ?? 3) as GridSize;
  if (!GRID_SIZES.includes(size)) return { error: "Choose a 3 x 3 or 5 x 5 grid." };
  const allowance = gridPointsPerDay();
  const used = await gridPointsUsed(user.id);
  if (used + size * size > allowance) {
    return { error: `This scan needs ${size * size} grid points, and ${Math.max(0, allowance - used)} of your ${allowance} daily points are left (all locations together). ${size === 5 && allowance - used >= 9 ? "A 3 x 3 scan still fits. " : ""}Points free up 24 hours after each scan.` };
  }
  const wait = await placesBudget(user.id, scanRequests(size));
  if (wait) return { error: wait };
  try {
    const { ranks, leaders } = await rankGrid(b.placeId, keyword, radiusKm, size);
    const scan: GridScan = { id: randomUUID(), keyword, radiusKm, size, ranks, leaders, at: new Date().toISOString(), placeId: b.placeId };
    await db.updatePlaces(scope, (h) => ({ ...h, scans: [scan, ...h.scans].slice(0, 30) }));
    revalidatePath("/app/google-profile");
    return { ok: `Scan saved: ${size * size} points, ${scanRequests(size)} Google Places requests. ${Math.max(0, allowance - used - size * size)} of ${allowance} grid points left for today.` };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "The scan failed." };
  }
}

/**
 * Names of the competitors recorded by one scan, read fresh from Google when the owner asks (names are not stored).
 * Only IDs saved in this location's own scan can be looked up. Uses one Places request per name (up to 5).
 */
export async function gridCompetitorNamesAction(scanId: string, only?: string[]): Promise<{ names?: Record<string, string>; error?: string }> {
  const { user, scope } = await requireScope();
  const scan = (await db.getPlaces(scope)).scans.find((s) => s.id === scanId);
  // Only names the page does not have yet are fetched (each costs a request).
  const ids = (scan?.leaders ?? []).map((l) => l.id).filter((id) => validPlaceId(id) && (!Array.isArray(only) || only.includes(id))).slice(0, 5);
  if (!ids.length) return { error: "That scan has no competitor data." };
  const wait = await placesBudget(user.id, ids.length);
  if (wait) return { error: wait };
  try {
    return { names: await placeNames(ids) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Google Places could not be reached." };
  }
}

/* ---------------- Business Profile insights ---------------- */
export async function refreshInsightsAction(): Promise<FormState> {
  const { user, scope } = await requireScope();
  const rl = await takeShared(`gbp-refresh:${user.id}`, LIMITS.gbpRefreshPerUser);
  if (!rl.ok) return { error: waitMessage("updates", rl.retryAfterSec) };
  const { error } = await refreshInsights(scope);
  revalidatePath("/app/google-profile");
  return error ? { error } : { ok: "Insights updated from Google." };
}

/** Asks Claude to explain the current performance numbers; saved with them, so it is not written twice. */
export async function explainInsightsAction(): Promise<FormState> {
  const { user, scope } = await requireScope();
  const [b, conn] = await Promise.all([db.getBusiness(scope), db.getGoogle(scope)]);
  const ins = conn?.insights;
  if (!b || !conn || !ins) return { error: "Load the insights from Google first." };
  if (ins.explanation) return { ok: "Explained." };
  const rl = await takeShared(`draft:${user.id}`, LIMITS.draftPerUser);
  if (!rl.ok) return { error: waitMessage("AI requests", rl.retryAfterSec) };
  const label: Record<string, string> = { searchViews: "Search views", mapsViews: "Maps views", calls: "Calls", website: "Website clicks", directions: "Direction requests", messages: "Message clicks", bookings: "Bookings" };
  const facts = Object.keys(label).map((k) => {
    const g = k as keyof typeof ins.current.totals;
    return ins.reported && !ins.reported.includes(g) ? `${label[k]}: not reported` : `${label[k]}: ${ins.current.totals[g]} (previous 28 days: ${ins.previous.totals[g]})`;
  }).join("\n") + (ins.monthly?.length ? `\nMonthly profile views: ${ins.monthly.map((m) => `${m.month} ${m.totals.searchViews + m.totals.mapsViews}`).join(", ")}` : "");
  try {
    const text = await explainInsights(b, `Period ${ins.current.start} to ${ins.current.end}.\n${facts}`);
    await db.updateGoogle(scope, conn.connectedAt, (cur) => (cur.insights?.at === ins.at ? { ...cur, insights: { ...cur.insights, explanation: { at: new Date().toISOString(), text } } } : cur));
    revalidatePath("/app/google-profile");
    return { ok: "Explained." };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not explain the numbers." };
  }
}

/* ---------------- Settings ---------------- */
export async function deleteAllDataAction() {
  const { user } = await requireScope();
  // Every location's Google access is cancelled (a sign-in shared by several locations once), then all data goes.
  const { ids } = await db.getLocations(user.id);
  const revoked: GoogleConnection[] = [];
  for (const loc of ids) {
    const conn = await db.getGoogle({ userId: user.id, loc });
    if (conn && !revoked.some((r) => sameGrant(r, conn))) {
      await revokeGoogle(conn); // best effort; the tokens are deleted below either way
      revoked.push(conn);
    }
  }
  await db.deleteAccountData(user.id);
  revalidatePath("/app", "layout");
  redirect("/app/onboarding");
}

/**
 * Deletes the whole account: cancels Google access for every connection, deletes all stored data in every location
 * (jobs, reports, tokens, preferences and email log included) and the sign-in account itself, then signs out.
 * The owner types their email address to confirm. The confirmation page and email say only what was really done.
 */
export async function deleteAccountAction(_: FormState, fd: FormData): Promise<FormState> {
  // Confirmed with the Auth server, not only the session token: this is irreversible.
  const user = await requireVerifiedUser();
  const typed = String(fd.get("confirmEmail") ?? "").trim().toLowerCase();
  const keep = { confirmEmail: String(fd.get("confirmEmail") ?? "") };
  if (!typed || typed !== user.email.trim().toLowerCase()) return { fieldErrors: { confirmEmail: "Type your account email address exactly to confirm." }, values: keep };
  if (fd.get("understand") !== "on") return { fieldErrors: { understand: "Tick the box to confirm you understand this cannot be undone." }, values: keep };
  const { ids } = await db.getLocations(user.id);
  const grants: GoogleConnection[] = [];
  for (const loc of ids) {
    const conn = await db.getGoogle({ userId: user.id, loc });
    if (conn && !grants.some((g) => sameGrant(g, conn))) grants.push(conn);
  }
  let googleRevoked = 0, googleFailed = 0;
  for (const g of grants) (await revokeGoogle(g)) ? googleRevoked++ : googleFailed++;
  await db.deleteAccountData(user.id);
  await clearShared(`reset:email:${user.email.trim().toLowerCase()}`).catch(() => undefined);
  const loginDeleted = await deleteLogin(user.id);
  if (!loginDeleted) {
    return { error: `Your data was deleted, but the sign-in account could not be removed right now. Nothing else is stored. Write to ${BRAND_EMAIL} and we will remove it.` };
  }
  const email = user.email;
  after(() => notifyAccountDeleted(email, { googleRevoked, googleFailed }).then(() => undefined, () => undefined));
  redirect(`/account-deleted?google=${grants.length === 0 ? "none" : googleFailed ? "partial" : "revoked"}`);
}

/* ---------------- Growth recommendations and action plans ---------------- */

export type GrowthRefresh = { status: "fresh" | "updated" | "rules" | "no-data" | "error"; message?: string };

/**
 * Asks Claude for new recommendations when the data behind them changed. Called by the dashboard after it has
 * rendered with the rules, so the page never waits for Claude. Does nothing when the cached set is current.
 */
export async function refreshGrowthAction(force = false): Promise<GrowthRefresh> {
  const { user, scope } = await requireScope();
  const b = await db.getBusiness(scope);
  if (!b) return { status: "no-data" };
  const { view, growth } = await loadGrowth(scope, b);
  if (!view.hasSignals || !view.candidates.length) return { status: "no-data" };
  if (!force && growth.cache?.fingerprint === view.fingerprint) return { status: growth.cache.source === "ai" ? "fresh" : "rules" };
  if (!env.anthropicConfigured()) return { status: "rules", message: "AI recommendations are not available right now." };
  const rl = await takeShared(`growth:${user.id}`, LIMITS.growthPerUser);
  if (!rl.ok) return { status: "rules", message: waitMessage("recommendation updates", rl.retryAfterSec) };
  let recs = null;
  let message: string | undefined;
  try {
    recs = await aiGrowthRecommendations(b, view);
    if (!recs) message = "Claude's answer could not be used, so the standard recommendations are shown.";
  } catch (e) {
    message = e instanceof Error ? e.message : "Claude could not be reached.";
  }
  // Saved either way, so a failed attempt is not repeated on every visit until the data changes again.
  growth.cache = { fingerprint: view.fingerprint, at: new Date().toISOString(), source: recs ? "ai" : "rules", recs: recs ?? view.rules };
  await db.saveGrowth(scope, growth);
  revalidatePath("/app");
  return recs ? { status: "updated" } : { status: "error", message };
}

const actionIdSchema = z.string().regex(/^[a-z_]{2,40}$/);

/** Marks an action done (or not). For owner-only checklist items it also ticks the checklist, as the owner asked. */
export async function setActionDoneAction(fd: FormData) {
  const { user, scope } = await requireScope();
  const b = await db.getBusiness(scope);
  const id = actionIdSchema.safeParse(fd.get("id"));
  if (!b || !id.success) return;
  const done = fd.get("done") === "true";
  const { view, growth } = await loadGrowth(scope, b);
  const c = view.candidates.find((x) => x.id === id.data);
  growth.completed = growth.completed.filter((x) => x.id !== id.data);
  if (done) {
    // The title the owner saw (Claude's wording if it was shown), else the standard one.
    const title = String(fd.get("title") ?? "").trim().slice(0, 120) || c?.title || id.data;
    growth.completed = [{ id: id.data, title, at: new Date().toISOString() }, ...growth.completed].slice(0, 50);
    if (c?.checklistKey) {
      b.audit = { ...b.audit, [c.checklistKey]: true };
      await db.saveBusiness(scope, b);
    }
  }
  await db.saveGrowth(scope, growth);
  revalidatePath("/app", "layout");
}

export type DraftState = { error?: string; text?: string; warnings?: string[] };

/** Drafts content for an action plan with Claude. The owner reviews and copies it; nothing is published. */
export async function draftActionContentAction(_: DraftState, fd: FormData): Promise<DraftState> {
  const { user, scope } = await requireScope();
  const b = await db.getBusiness(scope);
  const id = actionIdSchema.safeParse(fd.get("id"));
  if (!b || !id.success) return { error: "That action could not be found." };
  const { view, growth } = await loadGrowth(scope, b);
  const c = view.candidates.find((x) => x.id === id.data) ?? growth.cache?.recs.find((x) => x.id === id.data);
  if (!c?.contentKind) return { error: "There is no content to draft for this action." };
  const rl = await takeShared(`draft:${user.id}`, LIMITS.draftPerUser);
  if (!rl.ok) return { error: waitMessage("drafts", rl.retryAfterSec) };
  try {
    const text = await draftActionContent(b, c.contentKind);
    const warnings = b.type === "healthcare" ? medicalWarnings(text) : [];
    growth.drafts = { ...growth.drafts, [id.data]: { text, at: new Date().toISOString(), warnings } };
    await db.saveGrowth(scope, growth);
    revalidatePath(`/app/actions/${id.data}`);
    return { text, warnings };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not draft the content." };
  }
}


/* ---------------- Email ---------------- */

/** The owner's email choices (Settings > Email notifications). Security notices are always sent. */
export async function saveNotificationPrefsAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  const on = (k: string) => fd.get(k) === "on";
  await savePrefs(user.id, { reportEmails: on("reportEmails"), jobAlerts: on("jobAlerts"), postPublished: on("postPublished") });
  revalidatePath("/app/settings");
  return { ok: "Email choices saved." };
}

/** Emails one of the current location's reports, as a PDF, to the account's own address. */
export async function emailReportAction(_: FormState, fd: FormData): Promise<FormState> {
  const { user, scope } = await requireScope();
  if (!emailConfigured()) return { error: "Email is not set up on this server yet, so nothing was sent. Download the PDF instead." };
  const r = (await db.getLocal<MonthlyReport[]>(scope, "reports", [])).find((x) => x.id === String(fd.get("id") ?? ""));
  if (!r) return { error: "Report not found." };
  const budget = await takeShared(`report-email:${user.id}`, LIMITS.reportEmailPerUser);
  if (!budget.ok) return { error: waitMessage("report emails", budget.retryAfterSec) };
  const out = await notifyReport(scope, r, true);
  if (out.status === "accepted") return { ok: `Sent to ${user.email}. Resend accepted it for delivery; check your inbox and spam folder in a few minutes.` };
  if (out.status === "failed") return { error: `The email could not be sent: ${out.error}` };
  return { error: out.status === "skipped" ? `Not sent: ${out.reason}` : "Email is not set up on this server yet, so nothing was sent." };
}

const contactSchema = z.object({
  name: z.string().trim().min(1, "Enter your name.").max(100),
  email: emailSchema,
  topic: z.enum(["Question", "Problem or bug", "Billing", "Privacy or data", "Other"], { message: "Choose a topic." }),
  message: z.string().trim().min(10, "Write at least a sentence.").max(5000, "Keep it under 5,000 characters."),
});

/** The public contact form. Sent to the support address only when email is set up; never claims otherwise. */
export async function contactAction(_: FormState, fd: FormData): Promise<FormState> {
  // A field people never see: automated form fillers complete it, and get the normal answer with nothing sent.
  if (String(fd.get("website") ?? "").trim()) return { ok: "Thank you. Your message was sent." };
  const parsed = contactSchema.safeParse({ name: fd.get("name"), email: fd.get("email"), topic: fd.get("topic"), message: fd.get("message") });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error), values: vals(fd) };
  if (!emailConfigured()) return { error: `The contact form is not connected to email yet. Please write to ${BRAND_EMAIL} directly.`, values: vals(fd) };
  const ip = await takeShared(`contact:ip:${await clientIp()}`, LIMITS.contactPerIp);
  if (!ip.ok) return { error: waitMessage("messages", ip.retryAfterSec), values: vals(fd) };
  const user = await getUser();
  const out = await sendSupportMessage({ ...parsed.data, userId: user?.id });
  if (out.status === "accepted") return { ok: "Thank you. Your message was sent. We answer by email, usually within two working days." };
  return { error: `Your message could not be sent right now. Please write to ${BRAND_EMAIL} directly.`, values: vals(fd) };
}
