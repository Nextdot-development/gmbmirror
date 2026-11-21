import type { Metadata } from "next";
import { requireBusiness } from "@/lib/ctx";
import { db } from "@/lib/store";
import { CHATGPT_PREPARE, CHATGPT_STEPS } from "@/lib/business";
import { toggleGuideAction } from "@/app/actions";
import { InsightForm, InsightItem, NotesForm } from "@/components/forms";
import { Source } from "@/components/bits";
import { CheckCircle, Circle } from "@phosphor-icons/react/dist/ssr";

export const metadata: Metadata = { title: "ChatGPT Business Hub guide" };

export default async function ChatGPT() {
  const { user, scope } = await requireBusiness();
  const g = await db.getProgress(scope);
  const doneCount = CHATGPT_PREPARE.filter((i) => g.done[i.key]).length;

  return (
    <div className="flex flex-col gap-8">
      <header>
        <h1 className="heading-4">ChatGPT Business Hub guide</h1>
        <p className="body-3 mt-1 max-w-[680px] text-muted">
          A checklist and a place to track progress. This product has no connection to ChatGPT Business Hub and cannot edit or manage your profile there.
        </p>
      </header>

      <div className="card">
        <p className="title-3">Check the official source first</p>
        <p className="body-6 mt-2 text-muted">
          OpenAI decides whether and how a business can claim or manage its information. Those steps can change. Use only OpenAI&apos;s own help pages and sign in
          links, and ignore anyone who offers to do it through a shortcut or asks for your password.
        </p>
      </div>

      <section aria-labelledby="steps">
        <h2 id="steps" className="heading-6 mb-4">The general path</h2>
        <ol className="flex flex-col gap-3">
          {CHATGPT_STEPS.map((s, i) => (
            <li key={s} className="card flex gap-4 p-4">
              <span className="badge badge-ok shrink-0 self-start">{i + 1}</span>
              <p className="body-5">{s}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="card" aria-labelledby="prep">
        <h2 id="prep" className="heading-6">Prepare these first ({doneCount} of {CHATGPT_PREPARE.length} ready)</h2>
        <ul className="mt-4 flex flex-col gap-2">
          {CHATGPT_PREPARE.map((i) => (
            <li key={i.key}>
              <form action={toggleGuideAction}>
                <input type="hidden" name="key" value={i.key} />
                <button type="submit" className="btn btn-ghost w-full !justify-start !whitespace-normal text-left" aria-pressed={Boolean(g.done[i.key])}>
                  {g.done[i.key] ? <CheckCircle size={24} weight="fill" color="var(--color-accent)" className="shrink-0" aria-hidden /> : <Circle size={24} className="shrink-0 text-muted" aria-hidden />}
                  <span className="body-5">{i.label}</span>
                </button>
              </form>
            </li>
          ))}
        </ul>
        <Source>manually entered by you</Source>
      </section>

      <section className="card" aria-labelledby="notes">
        <h2 id="notes" className="heading-6 mb-4">Progress notes</h2>
        <NotesForm notes={g.notes} />
      </section>

      <section className="card" aria-labelledby="ins">
        <h2 id="ins" className="heading-6">Numbers OpenAI shows you</h2>
        <p className="body-6 mb-4 mt-1 text-muted">If OpenAI shows summary numbers for your business, record them here with the date so you can compare later.</p>
        <InsightForm />
        {g.insights.length ? (
          <ul className="mt-6 flex flex-col gap-3">
            {g.insights.map((i, n) => (
              <InsightItem key={`${n}-${i.date}-${i.label}-${i.value}`} index={n} insight={i} />
            ))}
          </ul>
        ) : (
          <p className="hint mt-4">No entries yet.</p>
        )}
        <Source>manually entered by you</Source>
      </section>
    </div>
  );
}
