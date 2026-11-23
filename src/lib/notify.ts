import "server-only";
import { BRAND } from "./brand";
import { env } from "./env";
import { db, type Scope } from "./store";
import { emailOf } from "./session";
import { layout, sendEmail, type EmailOutcome } from "./email";
import { monthlyReportPdf, reportFileName } from "./report-pdf";
import type { Job, MonthlyReport } from "./types";

/**
 * The emails GMBmirror sends, and the owner's choices about them. Security notices (password changed, Google
 * connected or disconnected) are always sent; the rest can be turned off in Settings.
 */

export type NotificationPrefs = {
  /** The monthly report as a PDF on the 1st of each month. */
  reportEmails: boolean;
  /** A scheduled post, review automation or report that failed for good. */
  jobAlerts: boolean;
  /** Each scheduled post Google accepted. */
  postPublished: boolean;
  /** When the welcome email was accepted (it is sent once). */
  welcomeSentAt?: string;
};

export const DEFAULT_PREFS: NotificationPrefs = { reportEmails: true, jobAlerts: true, postPublished: false };

export async function getPrefs(userId: string): Promise<NotificationPrefs> {
  return { ...DEFAULT_PREFS, ...(await db.getUserKey<Partial<NotificationPrefs>>(userId, "notifications", {})) };
}

export async function savePrefs(userId: string, change: Partial<Omit<NotificationPrefs, "welcomeSentAt">>) {
  await db.updateUserKey<Partial<NotificationPrefs>>(userId, "notifications", {}, (cur) => ({ ...cur, ...change }));
}

const app = (p: string) => `${env.appUrl()}${p}`;
const placeName = async (scope: Scope) => (await db.getBusiness(scope))?.name ?? "your business";

/** Once per account, after the email address is confirmed. */
export async function notifyWelcome(user: { id: string; email: string }): Promise<EmailOutcome | undefined> {
  if ((await getPrefs(user.id)).welcomeSentAt) return undefined;
  const { text, html } = layout({
    title: `Welcome to ${BRAND.name}`,
    paragraphs: [
      "Your email address is confirmed and your account is ready.",
      "Next: add your business, then connect its Google Business Profile so GMBmirror can read your reviews, publish replies and posts you approve, and track your local visibility.",
      "Nothing is ever published to Google without your approval, unless you turn on automatic replies yourself.",
    ],
    link: { href: app("/app/onboarding"), label: "Set up your business" },
  });
  const out = await sendEmail({ to: user.email, subject: `Welcome to ${BRAND.name}`, text, html, kind: "welcome", userId: user.id, idempotencyKey: `welcome:${user.id}` });
  if (out.status === "accepted") await db.updateUserKey<Partial<NotificationPrefs>>(user.id, "notifications", {}, (cur) => ({ ...cur, welcomeSentAt: new Date().toISOString() }));
  return out;
}

const SECURITY: Record<"password_changed" | "google_connected" | "google_disconnected", { subject: string; body: string }> = {
  password_changed: { subject: "Your password was changed", body: "The password of your GMBmirror account was just changed." },
  google_connected: { subject: "Google Business Profile connected", body: "A Google account was just connected to your GMBmirror account." },
  google_disconnected: { subject: "Google Business Profile disconnected", body: "A Google account was just disconnected from your GMBmirror account." },
};

/** Always sent: the owner should hear about every change to how their account or Google access works. */
export async function notifySecurity(user: { id: string; email: string }, event: keyof typeof SECURITY, detail?: string): Promise<EmailOutcome> {
  const s = SECURITY[event];
  const { text, html } = layout({
    title: s.subject,
    paragraphs: [
      s.body,
      ...(detail ? [detail] : []),
      `When: ${new Date().toUTCString()}`,
      `If this was you, there is nothing to do. If it was not, reset your password now and write to ${BRAND.email}.`,
    ],
    link: { href: app(event === "password_changed" ? "/forgot-password" : "/app/google"), label: event === "password_changed" ? "Reset my password" : "Review Google access" },
  });
  return sendEmail({ to: user.email, subject: `${BRAND.name}: ${s.subject}`, text, html, kind: "security", userId: user.id });
}

/**
 * A monthly report with its PDF. Scheduled reports respect the owner's choice; a report the owner asks for is always
 * sent (to the account's own address only).
 */
export async function notifyReport(scope: Scope, r: MonthlyReport, requested = false): Promise<EmailOutcome> {
  if (!requested && !(await getPrefs(scope.userId)).reportEmails) return { status: "skipped", reason: "Report emails are turned off." };
  const to = await emailOf(scope.userId);
  if (!to) return { status: "skipped", reason: "The account has no email address." };
  const { text, html } = layout({
    title: `Monthly report: ${r.business}, ${r.month}`,
    paragraphs: [
      `Your ${r.partial ? "month-to-date " : ""}report for ${r.business} (${r.location}) is attached as a PDF.`,
      ...(r.summary ? [r.summary] : []),
      "The figures come from your stored GMBmirror data. Sections without data say so instead of showing zero.",
    ],
    link: { href: app("/app/reports"), label: "Open reports" },
  });
  return sendEmail({
    to, subject: `${BRAND.name} monthly report: ${r.business}, ${r.month}`, text, html, kind: requested ? "report_request" : "report", userId: scope.userId,
    idempotencyKey: requested ? undefined : `report:${scope.userId}:${scope.loc}:${r.id}`,
    attachments: [{ filename: reportFileName(r), content: await monthlyReportPdf(r) }],
  });
}

const JOB_WHAT: Record<Job["kind"], string> = {
  publish_post: "A scheduled Google post",
  review_sweep: "Review automation",
  refresh_profile: "The daily Google profile refresh",
  monthly_report: "The monthly report",
};

/** A background job that failed for good (attempts used up, or waiting given up). */
export async function notifyJobFailed(userId: string, job: Job): Promise<EmailOutcome> {
  if (!(await getPrefs(userId)).jobAlerts) return { status: "skipped", reason: "Failure alerts are turned off." };
  const to = await emailOf(userId);
  if (!to) return { status: "skipped", reason: "The account has no email address." };
  const name = await placeName({ userId, loc: job.loc });
  const { text, html } = layout({
    title: `${JOB_WHAT[job.kind]} failed`,
    paragraphs: [
      `${JOB_WHAT[job.kind]} for ${name} could not be completed after ${job.attempts} attempt${job.attempts === 1 ? "" : "s"}.`,
      `Reason: ${job.lastError ?? "not recorded"}`,
      job.kind === "publish_post" ? "Nothing was published. Open Posts to check the post and schedule it again." : "Open GMBmirror to see the job history and try again.",
    ],
    link: { href: app(job.kind === "publish_post" ? "/app/posts" : "/app/settings"), label: job.kind === "publish_post" ? "Open posts" : "Open GMBmirror" },
  });
  return sendEmail({ to, subject: `${BRAND.name}: ${JOB_WHAT[job.kind]} failed`, text, html, kind: "job_failed", userId, idempotencyKey: `job-failed:${job.id}` });
}

/** A scheduled post that Google accepted (only when the owner asked for these). */
export async function notifyPostPublished(scope: Scope, job: Job, postText: string): Promise<EmailOutcome> {
  if (!(await getPrefs(scope.userId)).postPublished) return { status: "skipped", reason: "Post notifications are turned off." };
  const to = await emailOf(scope.userId);
  if (!to) return { status: "skipped", reason: "The account has no email address." };
  const name = await placeName(scope);
  const { text, html } = layout({
    title: "Scheduled post published",
    paragraphs: [`Google accepted your scheduled post for ${name}:`, postText.length > 300 ? `${postText.slice(0, 300)}…` : postText, "Google may take a short while to show it on your profile."],
    link: { href: app("/app/posts"), label: "Open posts" },
  });
  return sendEmail({ to, subject: `${BRAND.name}: scheduled post published`, text, html, kind: "post_published", userId: scope.userId, idempotencyKey: `post-published:${job.id}` });
}

/** A message from the public contact form, to the support address. The visitor's address is the reply-to. */
export async function sendSupportMessage(m: { name: string; email: string; topic: string; message: string; userId?: string }): Promise<EmailOutcome> {
  const { text, html } = layout({
    title: `Contact form: ${m.topic}`,
    paragraphs: [`From: ${m.name} <${m.email}>${m.userId ? ` (signed in, account ${m.userId})` : " (not signed in)"}`, m.message],
    footer: `Sent from the ${BRAND.name} contact form. Reply to answer the sender directly.`,
  });
  return sendEmail({ to: BRAND.email, subject: `[${BRAND.name} contact] ${m.topic}: ${m.name}`, text, html, kind: "support", replyTo: m.email });
}

/**
 * Sent after an account was deleted, to the address it used. Nothing is logged for the account (it no longer
 * exists). Says only what was actually done.
 */
export async function notifyAccountDeleted(email: string, done: { googleRevoked: number; googleFailed: number }): Promise<EmailOutcome> {
  const { text, html } = layout({
    title: `Your ${BRAND.name} account was deleted`,
    paragraphs: [
      `Your ${BRAND.name} account (${email}) and everything stored in it were deleted on ${new Date().toUTCString()}: business details, every location, drafts, posts, reports, schedules, settings, email preferences and stored Google tokens.`,
      done.googleRevoked + done.googleFailed === 0
        ? "No Google account was connected."
        : done.googleFailed
          ? `Google was asked to cancel ${BRAND.name}'s access, but did not confirm it for ${done.googleFailed} connection${done.googleFailed === 1 ? "" : "s"}. Our copy of the tokens is deleted either way; to be sure, remove ${BRAND.name} at https://myaccount.google.com/connections.`
          : `${BRAND.name}'s access to your Google account was cancelled.`,
      "Replies and posts you already published stay on your Google Business Profile; you can remove them there.",
      `If you did not ask for this, write to ${BRAND.email}.`,
    ],
    footer: `This is the last email ${BRAND.name} sends to this address about this account.`,
  });
  return sendEmail({ to: email, subject: `${BRAND.name}: your account was deleted`, text, html, kind: "security" });
}
