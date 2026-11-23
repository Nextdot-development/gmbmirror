import type { Metadata } from "next";
import Link from "next/link";
import { requireBusiness } from "@/lib/ctx";
import { db } from "@/lib/store";
import { listJobs } from "@/lib/jobs";
import { CreateReportForm, EmailReportForm } from "@/components/forms";
import { ShowMore, shownCount } from "@/components/ShowMore";
import { emailConfigured } from "@/lib/email";
import { fmtDateTime } from "@/components/bits";
import type { MonthlyReport } from "@/lib/types";

export const metadata: Metadata = { title: "Reports" };

const monthName = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });

const REPORTS_STEP = 6;

export default async function Reports({ searchParams }: { searchParams: Promise<{ view?: string; show?: string }> }) {
  const sp = await searchParams;
  const { user, scope, business: b } = await requireBusiness(["reports", "google"]);
  const reports = await db.getLocal<MonthlyReport[]>(scope, "reports", []);
  const jobs = (await listJobs(user.id, scope.loc)).filter((j) => j.kind === "monthly_report");
  const nextJob = jobs.filter((j) => ["queued", "waiting", "running"].includes(j.status)).sort((x, y) => x.runAt.localeCompare(y.runAt))[0];
  const failed = jobs.find((j) => j.status === "failed");
  const thisMonth = new Date().toISOString().slice(0, 7);
  const idx = await db.getLocations(user.id);
  const account = sp.view === "account" ? await Promise.all(idx.ids.map(async (loc) => {
    const s = { userId: user.id, loc };
    const [biz, list] = await Promise.all([db.getBusiness(s), db.getLocal<MonthlyReport[]>(s, "reports", [])]);
    return { loc, name: biz?.name ?? "New location", latest: list[0] };
  })) : null;

  return (
    <div className="flex flex-col gap-8">
      <header>
        <h1 className="heading-4">Monthly reports</h1>
        <p className="body-3 mt-1 max-w-[680px] text-muted">A report for {b.name} is made on the 1st of every month from what was measured that month. Missing data is marked, never shown as zero.</p>
        {idx.ids.length > 1 ? (
          <nav className="mt-3 flex gap-2" aria-label="Report view">
            <Link href="/app/reports" className={`btn btn-sm ${account ? "btn-secondary" : "btn-primary"}`}>This location</Link>
            <Link href="/app/reports?view=account" className={`btn btn-sm ${account ? "btn-primary" : "btn-secondary"}`}>All locations</Link>
          </nav>
        ) : null}
      </header>

      {account ? (
        <section aria-labelledby="acc-h" className="flex flex-col gap-3">
          <h2 id="acc-h" className="heading-6">All locations: latest reports</h2>
          <ul className="flex flex-col gap-3">
            {account.map((a) => (
              <li key={a.loc} className="card">
                <p className="title-3">{a.name}</p>
                {a.latest ? (
                  <>
                    <p className="caption-2 text-muted">{monthName(a.latest.month)}{a.latest.partial ? " (month to date)" : ""}</p>
                    {a.latest.summary ? <p className="body-6 mt-2">{a.latest.summary}</p> : null}
                    <ul className="caption-2 mt-2 text-muted">{a.latest.sections.filter((x) => !x.available).map((x) => <li key={x.title}>Not available: {x.title}</li>)}</ul>
                  </>
                ) : <p className="body-6 mt-1 text-muted">No report yet.</p>}
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <>
          <section className="card flex flex-col gap-3" aria-labelledby="gen-h">
            <h2 id="gen-h" className="heading-6">Report status</h2>
            <p className="body-6" data-testid="report-schedule">
              {nextJob ? `Next report: ${monthName(nextJob.payload.month)}, scheduled for ${fmtDateTime(nextJob.runAt)}${nextJob.status === "waiting" ? " (waiting)" : ""}.` : "The next report is scheduled when the background runner next starts."}
            </p>
            {failed ? <p role="alert" className="field-error">The report for {monthName(failed.payload.month)} could not be made: {failed.lastError}</p> : null}
            <p className="caption-2 text-muted">Reports are shown here and can be downloaded as PDF. Email delivery is not set up, so nothing is emailed.</p>
            <CreateReportForm month={thisMonth} />
          </section>

          {reports.length === 0 ? <p className="body-6 text-muted">No reports yet.</p> : null}
          <ul className="flex flex-col gap-4" aria-label="Report history" id="history">
            {reports.slice(0, shownCount(sp.show, REPORTS_STEP, reports.length)).map((r) => (
              <li key={r.id} className="card" data-month={r.month}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="heading-6">{monthName(r.month)}{r.partial ? " (month to date)" : ""}</h2>
                    <p className="caption-2 text-muted">Made {fmtDateTime(r.generatedAt)} {r.trigger === "schedule" ? "automatically" : "on request"}</p>
                  </div>
                  <div className="flex flex-wrap items-start gap-2">
                    <a href={`/app/reports/${r.id}/pdf`} className="btn btn-secondary btn-sm" download>Download PDF</a>
                    {emailConfigured() ? <EmailReportForm id={r.id} /> : null}
                  </div>
                </div>
                {r.summary ? (
                  <div className="panel-soft mt-4 p-4">
                    <p className="body-5">{r.summary}</p>
                    <p className="caption-5 mt-1 text-muted">Summary written by Claude from the facts below.</p>
                  </div>
                ) : <p className="caption-1 mt-4 text-warn">AI summary not available{r.summaryError ? `: ${r.summaryError}` : "."}</p>}
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  {r.sections.map((sec) => (
                    <section key={sec.title} className="inset" aria-label={sec.title}>
                      <h3 className="title-4">{sec.title}</h3>
                      {sec.available ? <ul className="body-6 mt-1 flex flex-col gap-1">{sec.lines.map((l) => <li key={l}>{l}</li>)}</ul> : null}
                      {sec.reason ? <p className={`caption-2 mt-1 ${sec.available ? "text-muted" : "text-warn"}`}>{sec.available ? sec.reason : `Not available: ${sec.reason}`}</p> : null}
                    </section>
                  ))}
                </div>
              </li>
            ))}
          </ul>
          <ShowMore shown={shownCount(sp.show, REPORTS_STEP, reports.length)} total={reports.length} step={REPORTS_STEP} params={{ view: sp.view }} anchor="history" />
        </>
      )}
    </div>
  );
}
