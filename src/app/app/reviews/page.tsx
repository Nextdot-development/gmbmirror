import type { Metadata } from "next";
import Link from "next/link";
import { requireBusiness } from "@/lib/ctx";
import { db } from "@/lib/store";
import { gbpStatus, loadReviews, live } from "@/lib/gbp";
import { copyFor } from "@/lib/business";
import { ReplyEditor } from "@/components/forms";
import { fmtDate, fmtDateTime, Source, Stars, statusLabel } from "@/components/bits";
import type { AutomationLogEntry, Business, ReplyDraft, ReplyHistoryEntry, Review } from "@/lib/types";
import { defaultAutomation } from "@/lib/review-safety";
import { toggleAutomationPauseAction } from "@/app/actions";
import { classifyReview } from "@/lib/review-safety";

export const metadata: Metadata = { title: "Reviews" };

type Show = "waiting" | "replied" | "all";
const MODE = { manual: "manual", approval: "drafts for approval", auto: "automatic for eligible reviews" } as const;
const MODE_HELP = {
  manual: "Claude drafts a reply when you press Draft with Claude.",
  approval: "New reviews get a draft reply automatically. You approve each one.",
  auto: "Replies that pass every safety check are published automatically. Negative and sensitive reviews always wait for you.",
} as const;

const REPLY_STATE: Record<string, { t: string; c: string }> = {
  PENDING: { t: "Google is checking the reply", c: "badge-warn" },
  REJECTED: { t: "Google rejected the reply", c: "badge-bad" },
};

/** A Google page token is passed back to Google only; anything that does not look like one is ignored. */
const pageToken = (v?: string) => (v && /^[\w.~=+/-]{1,512}$/.test(v) ? v : undefined);

export default async function Reviews({ searchParams }: { searchParams: Promise<{ show?: string; page?: string }> }) {
  const sp = await searchParams;
  const show: Show = sp.show === "replied" || sp.show === "all" ? sp.show : "waiting";
  const token = pageToken(sp.page);
  const { user, scope, business: b } = await requireBusiness();
  const [result, replies, google, autoLog] = await Promise.all([loadReviews(scope, token), db.getReplies(scope), db.getGoogle(scope), db.getLocal<AutomationLogEntry[]>(scope, "automation_log", [])]);
  const automation = b.automation ?? defaultAutomation();
  const { reviews, source, error } = result;
  const canPostLive = live(google) && source === "google_api";
  const status = gbpStatus(google);
  const c = copyFor(b.type);
  const waiting = reviews.filter((r) => !r.replied);
  const replied = reviews.filter((r) => r.replied);
  const shown = show === "waiting" ? waiting : show === "replied" ? replied : reviews;
  const href = (q: { show?: Show; page?: string }) => {
    const p = new URLSearchParams();
    if ((q.show ?? show) !== "waiting") p.set("show", q.show ?? show);
    if (q.page) p.set("page", q.page);
    const s = p.toString();
    return `/app/reviews${s ? `?${s}` : ""}`;
  };

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="heading-4">Reviews</h1>
        <p className="body-3 mt-1 max-w-[680px] text-muted">Claude drafts a reply. You edit it, approve it, then publish it. {c.replyRule}</p>
      </header>

      {source === "sample" ? (
        <div className="card">
          <span className="badge badge-warn">Sample data</span>
          <p className="body-6 mt-3 text-muted">
            These reviews are examples so you can try the flow. Nothing here is published.{" "}
            {status === "reconnect" ? "Reconnect Google on the Google profile page to see your real reviews." :
              status === "choose_location" ? "Choose your business location on the Google profile page to see your real reviews." :
              status === "not_connected" ? "Connect Google on the Google profile page to see your real reviews." :
              "Your real Google reviews will appear here once the Google Business Profile connection is switched on."}
          </p>
          {status === "reconnect" || status === "choose_location" || status === "not_connected" ? (
            <Link href="/app/google" className="btn btn-secondary btn-sm mt-3">Open Google profile</Link>
          ) : null}
        </div>
      ) : (
        <section className="card" aria-labelledby="rv-sum">
          <h2 id="rv-sum" className="heading-6">{google?.locationTitle ?? "Your Google reviews"}</h2>
          {error ? (
            <p role="alert" className="field-error">{error}</p>
          ) : (
            <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div><dt className="caption-2 text-muted">Google rating</dt><dd className="title-2">{result.averageRating ? result.averageRating.toFixed(1) : "—"}</dd></div>
              <div><dt className="caption-2 text-muted">Total reviews</dt><dd className="title-2">{result.totalReviewCount ?? reviews.length}</dd></div>
              <div><dt className="caption-2 text-muted">Waiting for reply</dt><dd className="title-2" data-testid="waiting-count">{waiting.length}</dd></div>
              <div><dt className="caption-2 text-muted">Replied</dt><dd className="title-2" data-testid="replied-count">{replied.length}</dd></div>
            </dl>
          )}
          {!error ? <p className="caption-2 mt-3 text-muted">Waiting and replied counts are for the {reviews.length} reviews on this page.</p> : null}
          {google?.lastSync?.reviews ? <Source>Google Business Profile, last synced {fmtDateTime(google.lastSync.reviews)}</Source> : null}
        </section>
      )}

      <section className="flex flex-col gap-3 rounded-2xl bg-surface-3 p-4" aria-labelledby="auto-h" data-testid="automation-panel">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 id="auto-h" className="title-4">Reply automation: {automation.paused ? "paused" : MODE[automation.replies]}</h2>
            <p className="caption-2 text-muted">{automation.paused ? "Nothing automatic runs until you resume." : MODE_HELP[automation.replies]}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {automation.replies !== "manual" ? (
              <form action={toggleAutomationPauseAction}>
                <input type="hidden" name="paused" value={automation.paused ? "no" : "yes"} />
                <button type="submit" className="btn btn-secondary btn-sm">{automation.paused ? "Resume automation" : "Pause automation"}</button>
              </form>
            ) : null}
            <Link href="/app/settings#automation" className="btn btn-ghost btn-sm">Change</Link>
          </div>
        </div>
        {autoLog.length ? (
          <details>
            <summary className="caption-1 cursor-pointer text-brand">Automation log ({autoLog.length})</summary>
            <ol className="caption-2 mt-2 flex flex-col gap-1" aria-label="Automation log">
              {autoLog.slice(0, 30).map((e, i) => <li key={`${e.at}-${i}`}><span className="text-muted">{fmtDateTime(e.at)}</span> {e.action}: {e.detail}</li>)}
            </ol>
          </details>
        ) : null}
      </section>

      <nav aria-label="Filter reviews" className="flex flex-wrap gap-2">
        {([["waiting", `Waiting for reply (${waiting.length})`], ["replied", `Replied (${replied.length})`], ["all", `All (${reviews.length})`]] as const).map(([k, label]) => (
          <Link key={k} href={href({ show: k, page: token })} className={`btn btn-sm ${show === k ? "btn-primary" : "btn-secondary"}`} aria-current={show === k ? "page" : undefined}>{label}</Link>
        ))}
      </nav>

      {shown.length === 0 && !error ? (
        <div className="card">
          <p className="title-3">{show === "waiting" ? "No reviews waiting for a reply" : show === "replied" ? "No replied reviews here" : "No reviews yet"}</p>
          <p className="body-6 mt-1 text-muted">{show === "waiting" && reviews.length ? "Every review on this page has a reply." : "When someone reviews your profile, it will show up here."}</p>
        </div>
      ) : null}

      <ul className="flex flex-col gap-4" aria-label="Reviews">
        {shown.map((r) => <ReviewCard key={r.id} r={r} saved={replies[r.id]} canPostLive={canPostLive} type={b.type} />)}
      </ul>

      {token || result.nextPageToken ? (
        <nav aria-label="More reviews" className="flex flex-wrap gap-2">
          {token ? <Link href={href({})} className="btn btn-secondary btn-sm">Back to newest</Link> : null}
          {result.nextPageToken ? <Link href={href({ page: result.nextPageToken })} className="btn btn-secondary btn-sm">Older reviews</Link> : null}
        </nav>
      ) : null}
    </div>
  );
}

const HISTORY: Record<ReplyHistoryEntry["action"], string> = {
  drafted: "Drafted by Claude", rewritten: "Rewritten by Claude", edited: "Edited", approved: "Approved", published: "Published to Google",
  auto_published: "Published automatically", held: "Held for your approval", failed: "Publishing failed",
};

function ReviewCard({ r, saved, canPostLive, type }: { r: Review; saved?: ReplyDraft; canPostLive: boolean; type: Business["type"] }) {
  const state = r.reply?.state ? REPLY_STATE[r.reply.state] : undefined;
  const cls = classifyReview(r, type);
  return (
    <li className="card" data-review={r.id}>
      <div className="flex flex-wrap items-center gap-2">
        <p className="title-3 break-words">{r.reviewer}</p>
        <Stars n={r.stars} />
        <span className="caption-2 text-muted">{fmtDate(r.createdAt)}</span>
        <span className="badge">{r.source === "sample" ? "Sample" : "Google"}</span>
        {r.replied ? <span className="badge badge-ok">Replied</span> : <span className="badge badge-warn">Waiting for reply</span>}
      </div>
      <p className="body-6 mt-3 whitespace-pre-wrap break-words text-muted">{r.comment || "The reviewer left a rating without text."}</p>
      {!r.replied && cls.reasons.length ? (
        <ul className="mt-2 flex flex-col gap-1" aria-label="Needs care">
          {cls.reasons.map((x) => <li key={x} className="caption-1 text-warn">{x}</li>)}
        </ul>
      ) : null}
      {saved?.byAutomation && saved.status !== "posted" ? <p className="caption-2 mt-2 text-muted">Drafted automatically. Nothing is published until you approve it.</p> : null}
      {r.reply ? (
        <div className="inset mt-3">
          <p className="caption-2 text-muted">Your reply on Google{r.reply.updatedAt ? `, ${fmtDate(r.reply.updatedAt)}` : ""}</p>
          <p className="body-6 mt-1 whitespace-pre-wrap break-words">{r.reply.text}</p>
          {state ? <span className={`badge mt-2 ${state.c}`}>{state.t}</span> : null}
        </div>
      ) : null}
      {!r.replied ? (
        <ReplyEditor reviewId={r.id} reviewer={r.reviewer} initialText={saved?.text ?? ""} status={saved?.status} canPostLive={canPostLive} care={cls.reasons} />
      ) : r.source === "google_api" ? (
        <details className="mt-3">
          <summary className="btn btn-secondary btn-sm list-none [&::-webkit-details-marker]:hidden">Edit reply{saved && saved.status !== "posted" ? ` (${statusLabel(saved.status)})` : ""}</summary>
          <ReplyEditor reviewId={r.id} reviewer={r.reviewer} label="New reply" initialText={saved && saved.status !== "posted" ? saved.text : r.reply?.text ?? ""}
            status={saved && saved.status !== "posted" ? saved.status : undefined} canPostLive={canPostLive} care={cls.reasons} />
        </details>
      ) : null}
      {saved?.history?.length ? (
        <details className="mt-3">
          <summary className="caption-1 cursor-pointer text-brand">Reply history ({saved.history.length})</summary>
          <ol className="caption-2 mt-2 flex flex-col gap-1 text-muted" aria-label="Reply history">
            {saved.history.map((h, i) => <li key={`${h.at}-${i}`}>{fmtDateTime(h.at)}: {HISTORY[h.action]}{h.note ? ` (${h.note})` : ""}</li>)}
          </ol>
        </details>
      ) : null}
    </li>
  );
}
