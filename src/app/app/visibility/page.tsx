import type { Metadata } from "next";
import { requireBusiness } from "@/lib/ctx";
import { db } from "@/lib/store";
import { providers, questionsFor } from "@/lib/ai";
import { checkScore, resultMatch, scoreTrend, trendText } from "@/lib/visibility";
import { VisibilityForm } from "@/components/forms";
import { fmtDate, Ring, Source } from "@/components/bits";
import { CheckCircle, Question, WarningCircle, XCircle } from "@phosphor-icons/react/dist/ssr";

export const metadata: Metadata = { title: "AI visibility" };

export default async function Visibility() {
  const { user, scope, business: b } = await requireBusiness(["checks", "places"]);
  const checks = await db.getChecks(scope);
  const latest = checks[0];
  const ps = providers();
  const hasProvider = ps.some((p) => p.ready);
  const score = latest ? checkScore(latest) : 0;
  const delta = scoreTrend(checks);
  const count = (m: string) => (latest ? latest.results.filter((r) => resultMatch(r) === m).length : 0);

  return (
    <div className="flex flex-col gap-8">
      <header>
        <h1 className="heading-4">AI visibility</h1>
        <p className="body-3 mt-1 max-w-[680px] text-muted">
          We ask AI models what a customer would ask, and check whether {b.name} is named. Results are dated snapshots and an estimate of how
          AI assistants answer, not a Google ranking. AI answers vary from one day to the next.
        </p>
      </header>

      <section className="card" aria-labelledby="run">
        <h2 id="run" className="heading-6">Run a check</h2>
        <p className="body-6 mt-1 text-muted">
          Checking: {b.name}{b.aliases?.length ? ` (also: ${b.aliases.join(", ")})` : ""}, {b.category.toLowerCase()} in {b.location}.
        </p>
        <details className="mb-4 mt-2">
          <summary className="caption-1 cursor-pointer text-brand">Questions that will be asked ({questionsFor(b).length})</summary>
          <ul className="body-6 mt-2 list-disc pl-6 text-muted">{questionsFor(b).map((q) => <li key={q}>{q}</li>)}</ul>
          <p className="hint">Add other names and your own questions in Settings.</p>
        </details>
        <ul className="mb-4 flex flex-wrap gap-2" aria-label="AI models used">
          {ps.map((p) => (
            <li key={p.id} className={`badge ${p.ready ? "badge-ok" : ""}`}>{p.label}: {p.ready ? "on" : "not set up"}</li>
          ))}
        </ul>
        <VisibilityForm hasProvider={hasProvider} />
      </section>

      {latest ? (
        <section aria-labelledby="latest">
          <h2 id="latest" className="heading-6">Latest result, {fmtDate(latest.checkedAt)}</h2>
          <div className="card mt-4 flex flex-wrap items-center gap-6">
            <div className="flex items-center gap-3">
              <Ring value={score} total={100} />
              <div>
                <p className="caption-1 text-muted">Visibility score</p>
                <p className="heading-5 kpi">{score}<span className="title-3 text-muted"> / 100</span></p>
                <p className={`caption-2 ${delta && delta > 0 ? "text-ok" : delta && delta < 0 ? "text-bad" : "text-muted"}`}>{trendText(delta)}</p>
              </div>
            </div>
            <p className="body-6 text-muted">
              Named in {count("named")} of {latest.results.length} answers{count("possible") ? `, plus ${count("possible")} possible ${count("possible") === 1 ? "match" : "matches"} not counted` : ""}.
            </p>
          </div>
          {latest.failedProviders?.length ? (
            <div role="alert" className="card mt-4">
              <p className="title-4 flex items-center gap-2 text-warn"><WarningCircle size={18} weight="fill" aria-hidden /> Partial results</p>
              <ul className="body-6 mt-2 list-disc pl-6 text-muted">
                {latest.failedProviders.map((f) => <li key={f.label}>{f.label} could not be checked: {f.error}</li>)}
              </ul>
              <p className="hint">The score uses only the providers that answered.</p>
            </div>
          ) : null}
          <ul className="mt-4 flex flex-col gap-4">
            {latest.results.map((r, i) => (
              <li key={i} className="card">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="badge">{r.providerLabel}</span>
                  {resultMatch(r) === "named" ? (
                    <span className="badge badge-ok"><CheckCircle size={16} weight="fill" aria-hidden /> Named</span>
                  ) : resultMatch(r) === "possible" ? (
                    <span className="badge badge-warn"><Question size={16} weight="fill" aria-hidden /> Possible match</span>
                  ) : (
                    <span className="badge badge-bad"><XCircle size={16} weight="fill" aria-hidden /> Not named</span>
                  )}
                </div>
                <p className="title-4 mt-3 text-muted">Question asked</p>
                <p className="body-5">{r.question}</p>
                {resultMatch(r) === "possible" && r.possibleName ? (
                  <p className="body-6 mt-3 text-muted">The answer mentions &ldquo;{r.possibleName}&rdquo;, which looks close to your name. If it is you, add it under Other names in Settings.</p>
                ) : null}
                {resultMatch(r) !== "none" && r.excerpt ? <p className="body-6 mt-3 text-muted">Answer excerpt: {r.excerpt}</p> : null}
                {resultMatch(r) !== "named" && r.mentionedBusinesses.length ? (
                  <p className="body-6 mt-3 text-muted">Businesses named instead: {r.mentionedBusinesses.join(", ")}</p>
                ) : null}
                {r.extractionFailed ? <p className="hint mt-3">We could not list the other businesses named in this answer.</p> : null}
              </li>
            ))}
          </ul>
          <div className="card mt-4">
            <p className="title-4">How this was measured</p>
            <p className="body-6 mt-2 text-muted">{latest.methodology}</p>
            <Source>AI visibility check performed by this product</Source>
          </div>
          <div className="card mt-4">
            <p className="title-4">What to do next</p>
            {latest.fixes?.length ? (
              <>
                <ol className="body-6 mt-2 list-decimal pl-6 text-muted">{latest.fixes.map((f) => <li key={f} className="mt-1">{f}</li>)}</ol>
                <Source>AI suggestions based on this check, your profile checklist and the businesses named instead. Check them before acting.</Source>
              </>
            ) : (
              <ul className="body-6 mt-2 list-disc pl-6 text-muted">
                <li>Put your business name, city, services and phone number in plain text on your website home page.</li>
                <li>Keep the name, address and phone identical on Google, your website and directories.</li>
                {b.type === "healthcare" ? <li>List each doctor with qualifications and speciality on a page of its own.</li> : <li>Publish your menu, services or prices as text, not only as images.</li>}
                <li>Run the check again in a few weeks and compare. Small changes are normal between runs.</li>
              </ul>
            )}
          </div>
        </section>
      ) : (
        <div className="card"><p className="title-3">No checks yet</p><p className="body-6 mt-1 text-muted">Run your first check above. It takes under a minute.</p></div>
      )}

      {checks.length > 1 ? (
        <section aria-labelledby="hist">
          <h2 id="hist" className="heading-6 mb-4">Earlier checks</h2>
          <div className="card mb-4">
            <p className="caption-1 text-muted">Visibility score, oldest to newest</p>
            <div className="mt-4 flex h-24 items-end gap-2" role="img" aria-label="Bar chart of the visibility score in each saved check">
              {checks.slice(0, 16).reverse().map((c) => {
                const s = checkScore(c);
                return (
                  <div key={c.id} className="flex h-full max-w-10 flex-1 items-end rounded-md bg-surface-3" title={`${fmtDate(c.checkedAt)}: ${s} / 100`}>
                    <div className="w-full rounded-md bg-accent" style={{ height: `${Math.max(s, 4)}%` }} />
                  </div>
                );
              })}
            </div>
            <Source>AI visibility checks performed by this product</Source>
          </div>
          <ul className="flex flex-col gap-2">
            {checks.slice(1).map((c) => (
              <li key={c.id} className="card p-4 body-5">
                {fmtDate(c.checkedAt)}: score {checkScore(c)} / 100, named in {c.results.filter((r) => resultMatch(r) === "named").length} of {c.results.length} answers
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
