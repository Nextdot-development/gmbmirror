import "server-only";
import { db, type Scope } from "./store";
import { live, withGoogle } from "./gbp";
import { createPost, GbpError, listPosts, updatePost, type GbpPost } from "./gbp-api";
import { LIMITS, take } from "./ratelimit";
import type { PostDraft } from "./types";

export type PublishResult =
  | { ok: true; post: PostDraft }
  /** retry: a temporary problem (Google busy or down). wait: needs the owner (connect or reconnect Google). */
  | { ok: false; reason: string; kind: "invalid" | "retry" | "wait" };

/**
 * Publishes one approved post to the location's Business Profile, or updates it if it was published before.
 * Shared by the Publish button and the scheduled publishing queue. A post is marked posted only after Google
 * accepted it. The caller saves the post list.
 */
export async function publishPost(scope: Scope, p: PostDraft, opts: { recoverSince?: string } = {}): Promise<PublishResult> {
  const conn = await db.getGoogle(scope);
  const target = live(conn) ? `${conn.accountName}/${conn.locationName}` : "";
  if (p.status !== "approved") return { ok: false, kind: "invalid", reason: "Approve the post before publishing it." };
  if (!live(conn)) return { ok: false, kind: "wait", reason: "Publishing turns on after you connect Google and choose your business location." };
  if (p.kind !== "STANDARD" && !p.event) return { ok: false, kind: "invalid", reason: "This post has no event details. Delete it and create it again with a title and dates." };
  if (p.googleName && p.publishedTo !== target) return { ok: false, kind: "invalid", reason: "This post was published to a different Google location. Switch back to that location to update it." };
  if (!take(`gbp-edit:${conn.locationName}`, LIMITS.gbpEditsPerLocation).ok) return { ok: false, kind: "retry", reason: "Google allows only a few changes a minute for one business. Trying again shortly." };
  const b = await db.getBusiness(scope);
  const lang = b?.language === "hi" ? "hi" : "en";
  try {
    // A retry after an attempt whose answer never arrived (timeout, crash): Google may already have the post. If a
    // post with exactly this text was created since `recoverSince`, record that one instead of creating a duplicate.
    let found: GbpPost | undefined;
    if (opts.recoverSince && !p.googleName) {
      const since = Date.parse(opts.recoverSince) - 60_000;
      const existing = await withGoogle(scope, conn, "posts", (t) => listPosts(t, conn.accountName, conn.locationName));
      found = existing.find((x) => (x.summary ?? "").trim() === p.text.trim() && x.createTime && Date.parse(x.createTime) >= since);
    }
    const g = found ?? (await withGoogle(scope, conn, "posts", (t) => (p.googleName ? updatePost(t, p.googleName, p, lang) : createPost(t, conn.accountName, conn.locationName, p, lang))));
    return { ok: true, post: { ...p, status: "posted", publishError: undefined, googleName: g.name || p.googleName, publishedTo: target, publishedAt: new Date().toISOString(),
      googleState: g.state, searchUrl: g.searchUrl || p.searchUrl } };
  } catch (e) {
    const err = e instanceof GbpError ? e : undefined;
    const reason = e instanceof Error ? e.message : "Google did not accept the post.";
    if (err && ["quota", "unavailable", "network"].includes(err.kind)) return { ok: false, kind: "retry", reason };
    if (err && ["reconnect", "scope"].includes(err.kind)) return { ok: false, kind: "wait", reason };
    return { ok: false, kind: "invalid", reason };
  }
}

/** The queue key of one scheduled publication. Editing or deleting the post cancels every key with its prefix. */
export const schedulePrefix = (loc: string, postId: string) => `publish_post:${loc}:${postId}:`;
export const scheduleKey = (loc: string, p: Pick<PostDraft, "id" | "scheduledAt">) => `${schedulePrefix(loc, p.id)}${p.scheduledAt ?? ""}`;
