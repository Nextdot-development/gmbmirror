import "server-only";
import { BRAND } from "./brand";
import { db } from "./store";
import { LIMITS, takeShared } from "./ratelimit";

/**
 * Email through Resend (https://resend.com/docs/api-reference/emails/send-email), server side only.
 *
 * Honest outcomes: "accepted" means Resend accepted the message for delivery (it returns an id). It does not mean
 * the message reached the inbox, and nothing in the app says "delivered". When RESEND_API_KEY or EMAIL_FROM is not
 * set, nothing is sent and the outcome is "not_configured".
 *
 * Sign-up confirmation and password-reset emails are sent by Supabase Auth, not here. Point Supabase at Resend's
 * SMTP server to send those through the same verified domain (docs/DEPLOYMENT.md, section 11).
 */

export type EmailKind = "welcome" | "security" | "report" | "job_failed" | "post_published" | "support" | "report_request";
export type EmailOutcome = { status: "accepted"; id: string } | { status: "not_configured" } | { status: "failed"; error: string } | { status: "skipped"; reason: string };
export type EmailLogEntry = { at: string; kind: EmailKind; subject: string; status: EmailOutcome["status"]; detail?: string };
export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  html: string;
  kind: EmailKind;
  /** Resend keeps this for 24 hours: the same key never sends twice (a retried job, a double click). */
  idempotencyKey?: string;
  replyTo?: string;
  attachments?: { filename: string; content: Uint8Array }[];
  /** Whose log the outcome goes into (support messages from visitors have none). */
  userId?: string;
};

const API = "https://api.resend.com";

/** RESEND_API_BASE_URL exists only for the isolated test servers; it is honoured only for a loopback address. */
function apiBase(): string {
  const o = process.env.RESEND_API_BASE_URL?.trim();
  if (o) {
    try {
      const u = new URL(o);
      if (u.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(u.hostname)) return o.replace(/\/+$/, "");
    } catch {
      /* ignored: falls back to Resend */
    }
  }
  return API;
}

export const emailConfigured = () => Boolean(process.env.RESEND_API_KEY?.trim() && process.env.EMAIL_FROM?.trim());

/** A plain address check: one @, no spaces or angle brackets, a dot in the domain. */
export const looksLikeEmail = (s: string) => /^[^\s@<>()",;]+@[^\s@<>()",;]+\.[^\s@<>()",;]+$/.test(s) && s.length <= 254;

async function logEmail(userId: string, m: EmailMessage, o: EmailOutcome) {
  const entry: EmailLogEntry = {
    at: new Date().toISOString(),
    kind: m.kind,
    subject: m.subject.slice(0, 140),
    status: o.status,
    ...(o.status === "failed" ? { detail: o.error.slice(0, 200) } : o.status === "skipped" ? { detail: o.reason } : {}),
  };
  await db.updateUserKey<EmailLogEntry[]>(userId, "email_log", [], (log) => [entry, ...log].slice(0, 50)).catch(() => undefined);
}

/**
 * Sends one email. Never throws: the outcome says what happened, and it is written to the owner's email log.
 * Limited per user (and in total for support messages) so a fault or an abuser cannot send floods of mail.
 */
export async function sendEmail(m: EmailMessage): Promise<EmailOutcome> {
  const out = await send(m);
  if (m.userId) await logEmail(m.userId, m, out);
  if (out.status === "failed") console.error(`[email] ${m.kind} not sent: ${out.error}`);
  return out;
}

async function send(m: EmailMessage): Promise<EmailOutcome> {
  if (!emailConfigured()) return { status: "not_configured" };
  if (!looksLikeEmail(m.to)) return { status: "skipped", reason: "No valid recipient address." };
  const budget = await takeShared(`email:${m.userId ?? "support"}`, m.userId ? LIMITS.emailPerUser : LIMITS.emailSupport);
  if (!budget.ok) return { status: "skipped", reason: "Hourly email limit reached." };
  const body = {
    from: process.env.EMAIL_FROM!.trim(),
    to: [m.to],
    subject: m.subject,
    text: m.text,
    html: m.html,
    reply_to: m.replyTo ?? (process.env.EMAIL_REPLY_TO?.trim() || BRAND.email),
    ...(m.attachments?.length ? { attachments: m.attachments.map((a) => ({ filename: a.filename, content: Buffer.from(a.content).toString("base64") })) } : {}),
    tags: [{ name: "kind", value: m.kind }],
  };
  try {
    const res = await fetch(`${apiBase()}/emails`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${process.env.RESEND_API_KEY!.trim()}`,
        "content-type": "application/json",
        ...(m.idempotencyKey ? { "idempotency-key": m.idempotencyKey.slice(0, 256) } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    const data = (await res.json().catch(() => ({}))) as { id?: string; message?: string; name?: string };
    if (res.ok && data.id) return { status: "accepted", id: data.id };
    // Resend's own message (for example "The domain is not verified"), never the key.
    return { status: "failed", error: `Resend ${res.status}: ${data.message ?? data.name ?? "rejected the message"}` };
  } catch (e) {
    return { status: "failed", error: e instanceof Error && e.name === "TimeoutError" ? "Resend did not answer in time." : "Resend could not be reached." };
  }
}

/** Escapes text for the HTML part. */
export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/**
 * A simple branded layout (blue and white, like the app), built from plain paragraphs so the text and HTML parts
 * always say the same thing. `link` adds one button.
 */
export function layout(o: { title: string; paragraphs: string[]; link?: { href: string; label: string }; footer?: string }): { text: string; html: string } {
  const footer = o.footer ?? `You are receiving this because you have a ${BRAND.name} account. Questions: ${BRAND.email}`;
  const text = [o.title, "", ...o.paragraphs.flatMap((p) => [p, ""]), ...(o.link ? [`${o.link.label}: ${o.link.href}`, ""] : []), "--", footer].join("\n");
  const html = `<!doctype html><html><body style="margin:0;background:#f4f7ff;font-family:Arial,Helvetica,sans-serif;color:#0f172a">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f7ff;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border-radius:12px;border:1px solid #dbe4ff">
<tr><td style="padding:20px 24px;border-bottom:1px solid #e5ecff;font-size:18px;font-weight:bold"><span style="color:#0f172a">GMB</span><span style="color:#2463FF">mirror</span></td></tr>
<tr><td style="padding:24px">
<h1 style="margin:0 0 16px;font-size:20px;line-height:1.3">${esc(o.title)}</h1>
${o.paragraphs.map((p) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.55">${esc(p).replace(/\n/g, "<br>")}</p>`).join("\n")}
${o.link ? `<p style="margin:20px 0 4px"><a href="${esc(o.link.href)}" style="display:inline-block;background:#2463FF;color:#ffffff;text-decoration:none;padding:11px 18px;border-radius:8px;font-weight:bold;font-size:15px">${esc(o.link.label)}</a></p>` : ""}
</td></tr>
<tr><td style="padding:16px 24px;border-top:1px solid #e5ecff;font-size:12px;line-height:1.5;color:#64748b">${esc(footer)}</td></tr>
</table></td></tr></table></body></html>`;
  return { text, html };
}
