import type { Metadata } from "next";
import { requireBusiness } from "@/lib/ctx";
import { ShowMore, shownCount } from "@/components/ShowMore";
import { db } from "@/lib/store";
import { live, loadGooglePosts } from "@/lib/gbp";
import { PostComposer, PostEditor } from "@/components/forms";
import { postItemAction } from "@/app/actions";
import { fmtDate, fmtDateTime, statusLabel } from "@/components/bits";
import { listJobs } from "@/lib/jobs";
import { ContentCalendar } from "@/components/ContentCalendar";
import type { Job } from "@/lib/types";
import { medicalWarnings } from "@/lib/medical";

export const metadata: Metadata = { title: "Posts" };

const POST_STATE: Record<string, { t: string; c: string }> = {
  LIVE: { t: "Live on Google", c: "badge-ok" },
  PROCESSING: { t: "Google is processing it", c: "badge-warn" },
  REJECTED: { t: "Rejected by Google", c: "badge-bad" },
};

const CTA_LABEL: Record<string, string> = { BOOK: "Book", ORDER: "Order online", SHOP: "Buy", LEARN_MORE: "Learn more", SIGN_UP: "Sign up", CALL: "Call now" };

const JOB_TEXT: Record<string, (j: Job) => string> = {
  queued: (j) => `Scheduled to publish ${fmtDateTime(j.runAt)}${j.attempts ? ` (attempt ${j.attempts + 1})` : ""}.`,
  running: () => "Publishing now.",
  waiting: (j) => `Waiting: ${j.lastError ?? "Google is not ready."} Checked again ${fmtDateTime(j.runAt)}.`,
  failed: (j) => `Scheduled publishing failed: ${j.lastError ?? "unknown reason"}.`,
  succeeded: () => "Published by the schedule.",
  cancelled: (j) => `Schedule cancelled: ${j.log[0]?.message ?? ""}`,
};

const POSTS_STEP = 15;

export default async function Posts({ searchParams }: { searchParams: Promise<{ month?: string; show?: string }> }) {
  const sp = await searchParams;
  const { user, scope, business: b } = await requireBusiness(["google", "posts"]);
  // The latest publishing job of each post, for its schedule status and log.
  const jobs = (await listJobs(user.id, scope.loc)).filter((j) => j.kind === "publish_post");
  const jobFor = (id: string) => jobs.filter((j) => j.payload.postId === id).sort((x, y) => y.createdAt.localeCompare(x.createdAt))[0];
  const [posts, google] = await Promise.all([db.getPosts(scope), db.getGoogle(scope)]);
  const canPost = live(google);
  // Google's current state for posts this app published (live, processing, rejected). Read only; nothing is saved.
  const published = posts.some((p) => p.googleName);
  const { posts: onGoogle, error: syncError } = canPost && published ? await loadGooglePosts(scope) : {};
  const googleState = new Map((onGoogle ?? []).map((g) => [g.name, g]));
  const healthcare = b.type === "healthcare";
  // The editors are the heavy part of the page: show the newest POSTS_STEP and more on request. The calendar above
  // still uses every post.
  const shown = shownCount(sp.show, POSTS_STEP, posts.length);

  return (
    <div className="flex flex-col gap-8">
      <header>
        <h1 className="heading-4">Posts</h1>
        <p className="body-3 mt-1 max-w-[680px] text-muted">
          Write or draft a Google post, review it, approve it, then publish. {healthcare ? "Healthcare drafts are checked for risky wording. The check is a prompt to reread, not legal advice." : ""}
        </p>
      </header>

      <div className="card"><PostComposer healthcare={healthcare} /></div>

      <ContentCalendar posts={posts} month={sp.month} />

      <section aria-labelledby="drafts">
        <h2 id="drafts" className="heading-6 mb-4">Your posts</h2>
        {!canPost ? <p className="hint mb-4">Publishing to Google turns on after you connect Google and choose your business location. Until then you can draft and approve; nothing is published.</p> : null}
        {syncError ? <p role="alert" className="field-error mb-4">Could not check your posts on Google: {syncError}</p> : null}
        {canPost && google?.lastSync?.posts && published ? <p className="caption-2 mb-4 text-muted">Post status checked with Google {fmtDateTime(google.lastSync.posts)}.</p> : null}
        {posts.length === 0 ? (
          <div className="card"><p className="title-3">No posts yet</p><p className="body-6 mt-1 text-muted">Draft your first post above. A short, useful update works better than a long one.</p></div>
        ) : (
          <ul className="flex flex-col gap-4">
            {posts.slice(0, shown).map((p) => {
              // Same text as when the post is saved or edited: the post plus the event title.
              const warnings = healthcare ? medicalWarnings([p.text, p.event?.title ?? ""].join(" ")) : [];
              const g = p.googleName ? googleState.get(p.googleName) : undefined;
              const state = g?.state ?? p.googleState;
              const searchUrl = g?.searchUrl ?? p.searchUrl;
              const missing = Boolean(onGoogle && p.googleName && !g && p.publishedTo === `${google?.accountName}/${google?.locationName}`);
              const job = jobFor(p.id);
              return (
                <li key={p.id} className="card">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="badge">{p.kind === "STANDARD" ? "Update" : p.kind === "EVENT" ? "Event" : "Offer"}</span>
                    <span className={`badge ${p.status === "posted" ? "badge-ok" : ""}`}>{statusLabel(p.status)}</span>
                    {p.googleName && p.status !== "posted" ? <span className="badge badge-warn">Published; changes not published yet</span> : null}
                    {state && POST_STATE[state] ? <span className={`badge ${POST_STATE[state].c}`}>{POST_STATE[state].t}</span> : null}
                    {missing ? <span className="badge badge-warn">Not found on Google any more</span> : null}
                    <span className="caption-2 text-muted">{fmtDate(p.createdAt)}{p.scheduledFor ? ` · planned for ${new Date(p.scheduledFor).toLocaleString("en-IN")}` : ""}</span>
                  </div>
                  {p.event ? (
                    <p className="caption-1 mt-3">
                      {p.event.title} · {new Date(p.event.start).toLocaleString("en-IN")} to {new Date(p.event.end).toLocaleString("en-IN")}
                    </p>
                  ) : null}
                  <p className="body-5 mt-3 whitespace-pre-wrap">{p.text}</p>
                  {p.offer && (p.offer.couponCode || p.offer.redeemOnlineUrl || p.offer.termsConditions) ? (
                    <p className="caption-2 mt-2 text-muted">
                      {[p.offer.couponCode && `Coupon: ${p.offer.couponCode}`, p.offer.redeemOnlineUrl && `Redeem: ${p.offer.redeemOnlineUrl}`, p.offer.termsConditions && `Terms: ${p.offer.termsConditions}`].filter(Boolean).join(" · ")}
                    </p>
                  ) : null}
                  {p.publishError ? <p role="alert" className="field-error">Not published: {p.publishError}</p> : null}
                  {job && (p.status !== "posted" || job.status === "succeeded") ? (
                    <div className="mt-2" data-testid="schedule-status" data-job-status={job.status}>
                      <p className={`caption-1 ${job.status === "failed" ? "text-bad" : job.status === "waiting" ? "text-warn" : "text-muted"}`}>{JOB_TEXT[job.status](job)}</p>
                      <details>
                        <summary className="caption-2 cursor-pointer text-brand">Publishing log ({job.log.length})</summary>
                        <ol className="caption-2 mt-1 flex flex-col gap-0.5 text-muted">{job.log.map((l, i) => <li key={`${l.at}-${i}`}>{fmtDateTime(l.at)}: {l.message}</li>)}</ol>
                      </details>
                    </div>
                  ) : null}
                  {p.imageUrl ? <p className="caption-2 mt-1 break-all text-muted" data-testid="post-photo">Photo: <a className="underline underline-offset-2" href={p.imageUrl} target="_blank" rel="noopener noreferrer">{p.imageUrl}</a></p> : null}
                  {p.callToAction ? <p className="caption-2 mt-1 text-muted">Button: {CTA_LABEL[p.callToAction.actionType]}{p.callToAction.url ? ` → ${p.callToAction.url}` : " (your Google phone number)"}</p> : null}
                  {p.publishedAt ? (
                    <p className="caption-2 mt-2 text-muted">
                      Published to Google {fmtDateTime(p.publishedAt)}.{" "}
                      {searchUrl ? <a href={searchUrl} target="_blank" rel="noopener noreferrer" className="underline">View on Google</a> : null}
                    </p>
                  ) : null}
                  {warnings.length ? (
                    <ul className="mt-3 flex flex-col gap-1" aria-label="Notes to check">
                      {warnings.map((w) => <li key={w} className="caption-1 text-warn">{w}</li>)}
                    </ul>
                  ) : null}
                  <form action={postItemAction} className="mt-4 flex flex-wrap gap-2">
                    <input type="hidden" name="id" value={p.id} />
                    {p.status === "draft" ? <button className="btn btn-secondary btn-sm" name="intent" value="approve">Approve</button> : null}
                    {p.status === "approved" ? <button className="btn btn-primary btn-sm" name="intent" value="publish" disabled={!canPost}>{p.googleName ? "Publish changes to Google" : "Publish to Google"}</button> : null}
                    <button className="btn btn-ghost btn-sm" name="intent" value="delete">Delete</button>
                  </form>
                  {p.status !== "posted" || p.googleName ? (
                    <details className="mt-3">
                      <summary className="btn btn-secondary btn-sm list-none [&::-webkit-details-marker]:hidden">Edit</summary>
                      <PostEditor id={p.id} text={p.text} approved={p.status === "approved"} scheduledFor={p.scheduledFor} />
                    </details>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
        <ShowMore shown={shown} total={posts.length} step={POSTS_STEP} params={{ month: sp.month }} anchor="drafts" />
      </section>
    </div>
  );
}
