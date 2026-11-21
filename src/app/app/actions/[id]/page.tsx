import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "@phosphor-icons/react/dist/ssr";
import { requireBusiness } from "@/lib/ctx";
import { loadGrowth } from "@/lib/growth-server";
import { currentRecommendations } from "@/lib/growth";
import { setActionDoneAction } from "@/app/actions";
import { fmtDate, Source } from "@/components/bits";
import { ActionDraft } from "@/components/ActionDraft";
import type { Recommendation } from "@/lib/types";

export const metadata: Metadata = { title: "Action plan" };

const CONTENT_LABEL: Record<NonNullable<Recommendation["contentKind"]>, string> = {
  description: "a business description",
  photos: "a photo shot list",
  review_request: "a review request message",
  website_text: "website text",
  faq: "website questions and answers",
};

export default async function ActionPlan({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, scope, business: b } = await requireBusiness();
  const { view, growth } = await loadGrowth(scope, b);
  const { recs, source } = currentRecommendations(view, growth);
  const fromAi = recs.find((r) => r.id === id);
  const candidate = view.candidates.find((c) => c.id === id);
  const rec: Recommendation | undefined = fromAi ?? candidate;
  const done = growth.completed.find((c) => c.id === id);
  const back = <Link href="/app" className="btn btn-ghost btn-sm w-fit"><ArrowLeft size={14} aria-hidden /> Back to dashboard</Link>;

  if (!rec) {
    return (
      <div className="flex max-w-[720px] flex-col gap-6">
        {back}
        <h1 className="heading-4">{done ? done.title : "Action plan"}</h1>
        <p className="card body-5">
          {done ? `You marked this done on ${fmtDate(done.at)}, and your latest data no longer shows the problem.` : "This issue does not show in your latest data. It may already be fixed, or a check needs to be run again."}
        </p>
        {done ? (
          <form action={setActionDoneAction}>
            <input type="hidden" name="id" value={id} /><input type="hidden" name="done" value="false" />
            <button type="submit" className="btn btn-ghost btn-sm">Mark as not done</button>
          </form>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex max-w-[760px] flex-col gap-6">
      {back}
      <header>
        <p className="eyebrow">Action plan</p>
        <h1 className="heading-4 mt-3">{rec.title}</h1>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="badge">{rec.priority} priority</span>
          <span className="badge">{rec.difficulty}</span>
          <span className={`badge ${done ? "badge-ok" : ""}`}>{done ? `Done ${fmtDate(done.at)}` : "Not done yet"}</span>
        </div>
      </header>

      <section className="card" aria-labelledby="ap-problem">
        <h2 id="ap-problem" className="heading-6">Problem identified</h2>
        <p className="body-5 mt-2">{rec.why}</p>
        <h3 className="title-4 mt-4">Evidence from your data</h3>
        <ul className="body-6 mt-2 list-disc pl-5">{rec.evidence.map((e) => <li key={e}>{e}</li>)}</ul>
        {candidate?.reopened ? <p className="caption-2 mt-2 text-warn">Reopened: a newer check still shows this after you marked it done.</p> : null}
      </section>

      <section className="card" aria-labelledby="ap-steps">
        <h2 id="ap-steps" className="heading-6">Recommended solution</h2>
        <p className="body-6 mt-2 text-muted">{rec.benefit}</p>
        <ol className="body-5 mt-3 flex list-decimal flex-col gap-2 pl-5" aria-label="Steps">{rec.steps.map((s) => <li key={s}>{s}</li>)}</ol>
        <p className="mt-4"><Link href={rec.href} className="btn btn-ghost btn-sm">Go to the right page</Link></p>
      </section>

      {rec.contentKind ? (
        <section className="card" aria-labelledby="ap-content">
          <h2 id="ap-content" className="heading-6">Suggested content</h2>
          <p className="body-6 mt-1 text-muted">Claude can draft {CONTENT_LABEL[rec.contentKind]} from your business details. You review, edit and copy it yourself.</p>
          <div className="mt-3"><ActionDraft id={rec.id} label={CONTENT_LABEL[rec.contentKind]} saved={growth.drafts[rec.id]} /></div>
        </section>
      ) : null}

      <section className="card" aria-labelledby="ap-status">
        <h2 id="ap-status" className="heading-6">Completion</h2>
        <p className="body-6 mt-1 text-muted">
          {done ? `Marked done on ${fmtDate(done.at)}. If a later check still shows the problem, it comes back to your dashboard.` : "Mark it done when you have finished. If a later check still shows the problem, it comes back."}
        </p>
        <form action={setActionDoneAction} className="mt-3">
          <input type="hidden" name="id" value={rec.id} />
          <input type="hidden" name="title" value={rec.title} />
          <input type="hidden" name="done" value={done ? "false" : "true"} />
          <button type="submit" className={`btn ${done ? "btn-ghost" : "btn-primary"} btn-sm`}>{done ? "Mark as not done" : "Mark as done"}</button>
        </form>
        <Source>{source === "ai" && fromAi ? "steps written by Claude from your data; evidence from your data" : "standard steps; evidence from your data"}</Source>
      </section>
    </div>
  );
}
