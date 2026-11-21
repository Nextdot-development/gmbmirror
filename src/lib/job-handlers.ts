import "server-only";
import { createHash } from "node:crypto";
import { db, type Scope } from "./store";
import { enqueue, listJobs, runDueJobs, type Handler, type JobOutcome } from "./jobs";
import { live, refreshInsights, syncBusinessFromGoogle, withGoogle } from "./gbp";
import { GbpError, listReviews, updateReply } from "./gbp-api";
import { publishPost } from "./post-publish";
import { draftReply } from "./ai";
import { autoBlockers, classifyReview, defaultAutomation, replyIssues } from "./review-safety";
import { LIMITS, takeShared } from "./ratelimit";
import { buildMonthlyReport, previousMonth } from "./reports";
import type { AutomationLogEntry, Job, PostDraft, ReplyDraft } from "./types";

/** Background work, one handler per job kind. Handlers never publish anything the rules below do not allow. */

const HOUR = 60 * 60_000;
const SWEEP_EVERY_MS = 30 * 60_000;
const SWEEP_MAX_REVIEWS = 5;

export async function logAutomation(scope: Scope, entry: Omit<AutomationLogEntry, "at">) {
  await db.updateLocal<AutomationLogEntry[]>(scope, "automation_log", [], (log) => [{ at: new Date().toISOString(), ...entry }, ...log].slice(0, 200));
}

const googleProblem = (e: unknown, what: string): JobOutcome => {
  const err = e instanceof GbpError ? e : undefined;
  const message = `${what}: ${e instanceof Error ? e.message : "Google could not be reached."}`;
  if (err && ["reconnect", "scope"].includes(err.kind)) return { status: "waiting", message, until: new Date(Date.now() + HOUR) };
  if (!err || ["quota", "unavailable", "network"].includes(err.kind)) return { status: "retry", message };
  return { status: "failed", message };
};

/** Publishes a scheduled post at its time; waits while Google is not connected; never publishes a changed post. */
async function publishFor(scope: Scope, job: Job): Promise<JobOutcome> {
  const posts = await db.getPosts(scope);
  const p = posts.find((x) => x.id === job.payload.postId);
  if (!p) return { status: "cancelled", message: "The post was deleted." };
  if (p.status === "posted" && p.publishedAt && Date.parse(p.publishedAt) >= Date.parse(job.createdAt)) return { status: "succeeded", message: "Already published." };
  if (p.status !== "approved" || p.scheduledAt !== job.payload.scheduledAt) return { status: "cancelled", message: "The post changed after it was scheduled." };
  // From the second attempt on, an earlier attempt may have reached Google without its answer arriving: check first.
  const r = await publishPost(scope, p, job.attempts > 1 ? { recoverSince: job.createdAt } : {});
  // Saved as one atomic step on the latest list, so an edit the owner made to another post meanwhile is kept.
  const setPost = (change: (cur: PostDraft) => PostDraft) =>
    db.updateLocal<PostDraft[]>(scope, "posts", [], (list) => (list.some((x) => x.id === p.id) ? list.map((x) => (x.id === p.id ? change(x) : x)) : undefined));
  if (r.ok) {
    await setPost(() => r.post);
    await logAutomation(scope, { action: "Scheduled post published", result: "done", detail: r.post.searchUrl ? `Google: ${r.post.googleState ?? "accepted"}` : "Google accepted it.", postId: p.id });
    return { status: "succeeded", message: `Published to Google${r.post.googleState ? ` (${r.post.googleState})` : ""}.` };
  }
  await setPost((cur) => ({ ...cur, publishError: r.reason }));
  if (r.kind === "wait") return { status: "waiting", message: r.reason, until: new Date(Date.now() + HOUR), giveUpAt: new Date(Date.parse(p.scheduledAt!) + 7 * 86_400_000) };
  if (r.kind === "retry") return { status: "retry", message: r.reason };
  return { status: "failed", message: r.reason };
}

/**
 * Review automation for one location: drafts replies for new reviews, and (only in "auto" mode, with the owner's
 * opt-in) publishes the ones every safety rule allows. Everything else waits for the owner. Each action is logged.
 */
async function sweepFor(scope: Scope, job: Job): Promise<JobOutcome> {
  const b = await db.getBusiness(scope);
  const settings = b?.automation ?? defaultAutomation();
  if (!b || settings.paused || settings.replies === "manual") return { status: "cancelled", message: "Review automation is off or paused for this location." };
  const conn = await db.getGoogle(scope);
  if (!live(conn)) return { status: "waiting", message: "Google is not connected for this location.", until: new Date(Date.now() + HOUR) };
  let reviews;
  try {
    reviews = (await withGoogle(scope, conn, "reviews", (t) => listReviews(t, conn.accountName, conn.locationName))).reviews;
  } catch (e) {
    return googleProblem(e, "Could not read reviews");
  }
  const replies = await db.getReplies(scope);
  const todo = reviews.filter((r) => !r.replied && !replies[r.id]).slice(0, SWEEP_MAX_REVIEWS);
  const counts = { drafted: 0, published: 0, held: 0 };
  for (const r of todo) {
    const cls = classifyReview(r, b.type);
    let text: string;
    try {
      text = await draftReply(b, { stars: r.stars, comment: r.comment, firstName: r.reviewer.split(" ")[0] });
    } catch (e) {
      await logAutomation(scope, { action: "Reply draft", result: "failed", detail: e instanceof Error ? e.message : "Claude could not draft a reply.", reviewId: r.id });
      continue;
    }
    const issues = replyIssues(text, r, b);
    const now = new Date().toISOString();
    const blockers = settings.replies === "auto" ? autoBlockers(settings, r.stars, cls, issues, true) : ["Approval mode: you approve every reply."];
    let draft: ReplyDraft = { text, status: "draft", updatedAt: now, byAutomation: true, holdReasons: [...cls.reasons, ...issues], history: [{ at: now, action: "drafted", by: "automation", text }] };
    if (settings.replies === "auto" && !blockers.length && (await takeShared(`gbp-edit:${conn.locationName}`, LIMITS.gbpEditsPerLocation)).ok) {
      try {
        const res = await withGoogle(scope, conn, "reply", (t) => updateReply(t, r.id, text));
        draft = { ...draft, status: "posted", postedAt: new Date().toISOString(), googleState: res.state, history: [{ at: new Date().toISOString(), action: "auto_published", by: "automation", text, note: res.state }, ...draft.history!] };
        counts.published++;
        await logAutomation(scope, { action: "Reply published automatically", result: "done", detail: `${r.stars}-star review; Google ${res.state ?? "accepted it"}.`, reviewId: r.id });
      } catch (e) {
        draft.history = [{ at: new Date().toISOString(), action: "failed", by: "automation", note: e instanceof Error ? e.message : "Google did not accept the reply." }, ...draft.history!];
        await logAutomation(scope, { action: "Automatic reply", result: "failed", detail: e instanceof Error ? e.message : "Google did not accept the reply.", reviewId: r.id });
      }
    } else {
      draft.history = [{ at: now, action: "held", by: "automation", note: blockers.join(" ") }, ...draft.history!];
      // Why it waits for the owner, shown on the review.
      draft.holdReasons = [...new Set([...blockers, ...(draft.holdReasons ?? [])])];
      counts[settings.replies === "auto" ? "held" : "drafted"]++;
      await logAutomation(scope, { action: settings.replies === "auto" ? "Reply held for approval" : "Reply drafted for approval", result: "held", detail: blockers.join(" "), reviewId: r.id });
    }
    // Saved after each review, so a later failure does not lose earlier work. One atomic step that never replaces a
    // reply the owner started meanwhile.
    await db.updateLocal<Record<string, ReplyDraft>>(scope, "replies", {}, (latest) => (latest[r.id] ? undefined : { ...latest, [r.id]: draft }));
  }
  return { status: "succeeded", message: `Checked ${reviews.length} recent reviews: ${counts.drafted} drafted, ${counts.held} held for approval, ${counts.published} published.` };
}

async function refreshFor(scope: Scope): Promise<JobOutcome> {
  if (!live(await db.getGoogle(scope))) return { status: "cancelled", message: "Google is not connected for this location." };
  const sync = await syncBusinessFromGoogle(scope);
  const ins = await refreshInsights(scope);
  const err = sync.error ?? ins.error;
  return err ? { status: "retry", message: err } : { status: "succeeded", message: "Profile and insights updated from Google." };
}

async function reportFor(scope: Scope, job: Job): Promise<JobOutcome> {
  if (!(await db.getBusiness(scope))) return { status: "cancelled", message: "The location has no business details." };
  const r = await buildMonthlyReport(scope, job.payload.month, "schedule");
  return r.error ? { status: "retry", message: r.error } : { status: "succeeded", message: `Report for ${job.payload.month} created${r.summaryError ? ` (summary not written: ${r.summaryError})` : ""}.` };
}

/**
 * Every job runs inside its owner's own data: the runner passes the id of the user whose job list holds the job, and
 * the job names one of that user's locations. A job whose location was removed is cancelled without running.
 */
const ownLocation = (h: (scope: Scope, job: Job) => Promise<JobOutcome>): Handler => async (job, userId) => {
  const { ids } = await db.getLocations(userId);
  if (!ids.includes(job.loc)) return { status: "cancelled", message: "The location was removed." };
  return h({ userId, loc: job.loc }, job);
};

export const HANDLERS: Record<Job["kind"], Handler> = {
  publish_post: ownLocation(publishFor),
  review_sweep: ownLocation(sweepFor),
  refresh_profile: ownLocation((scope) => refreshFor(scope)),
  monthly_report: ownLocation(reportFor),
};

/**
 * Makes sure each location has its recurring jobs: a monthly report for the current month (run on the 1st of the
 * next), a daily Google refresh when connected, and a review sweep when review automation is on. Duplicate keys are
 * ignored by the queue, so this is safe to call on every run.
 */
export async function planRecurring(userId: string, at = new Date()) {
  const { ids } = await db.getLocations(userId);
  const live_ = await listJobs(userId);
  for (const loc of ids) {
    const scope = { userId, loc };
    const b = await db.getBusiness(scope);
    if (!b) continue;
    const ym = at.toISOString().slice(0, 7);
    const firstOfNext = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1, 3, 0));
    await enqueue(userId, { kind: "monthly_report", loc, key: `monthly_report:${loc}:${ym}`, runAt: firstOfNext, payload: { month: ym } });
    // Last month's report, if it was never made (for example the server was off on the 1st) and the business existed then.
    const prev = previousMonth(at);
    if (Date.parse(b.createdAt) < Date.parse(`${ym}-01T00:00:00Z`)) {
      await enqueue(userId, { kind: "monthly_report", loc, key: `monthly_report:${loc}:${prev}`, runAt: at, payload: { month: prev } });
    }
    const conn = await db.getGoogle(scope);
    if (live(conn)) {
      // Once a day, at a time spread over the day per location, so refreshes do not all hit Google at once.
      const day = at.toISOString().slice(0, 10);
      const spread = parseInt(createHash("sha256").update(`${userId}:${loc}`).digest("hex").slice(0, 8), 16) % (20 * HOUR);
      await enqueue(userId, { kind: "refresh_profile", loc, key: `refresh_profile:${loc}:${day}`, runAt: new Date(Date.parse(`${day}T01:00:00Z`) + spread), maxAttempts: 3 });
    }
    const s = b.automation ?? defaultAutomation();
    const sweepOn = !s.paused && s.replies !== "manual";
    const hasLiveSweep = live_.some((j) => j.kind === "review_sweep" && j.loc === loc && ["queued", "running", "waiting"].includes(j.status));
    if (sweepOn && !hasLiveSweep) {
      // One sweep per half hour slot.
      const slot = new Date(Math.ceil(at.getTime() / SWEEP_EVERY_MS) * SWEEP_EVERY_MS);
      await enqueue(userId, { kind: "review_sweep", loc, key: `review_sweep:${loc}:${slot.toISOString()}`, runAt: at, maxAttempts: 3 });
    }
  }
}

/** One pass of the background runner: plan recurring work, then run what is due. */
export async function runJobs(opts: { userIds?: string[]; at?: Date; budgetMs?: number } = {}) {
  const users = opts.userIds ?? (await db.listUserIds());
  for (const u of users) await planRecurring(u, opts.at);
  return runDueJobs(HANDLERS, { userIds: users, at: opts.at, budgetMs: opts.budgetMs });
}
