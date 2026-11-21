import Link from "next/link";
import type { Business, GbpInsights, GbpMetricGroup, GbpProfileSnapshot } from "@/lib/types";
import { fmtDate, fmtDateTime, Source, TrendBars } from "./bits";
import { profileScore } from "@/lib/profile-score";

const OPEN: Record<string, { t: string; c: string }> = {
  OPEN: { t: "Open", c: "badge-ok" },
  CLOSED_TEMPORARILY: { t: "Temporarily closed", c: "badge-warn" },
  CLOSED_PERMANENTLY: { t: "Permanently closed", c: "badge-bad" },
};

/** The selected location's profile as Google has it now, with gaps called out in plain words. */
export function BusinessProfileOverview({ profile, error, business, history = [] }: { profile?: GbpProfileSnapshot; error?: string; business: Business; history?: { at: string; value: number }[] }) {
  const rows: { label: string; value?: string; missing: string }[] = profile
    ? [
        { label: "Address", value: profile.address, missing: "No address on the profile." },
        { label: "Phone", value: profile.phone, missing: "No phone number. Customers cannot call from Google." },
        { label: "Website", value: profile.website, missing: "No website link." },
        { label: "Primary category", value: profile.category, missing: "No category set." },
        { label: "Opening hours", value: profile.hours.length ? profile.hours.join(" · ") : undefined, missing: "No opening hours. Google may show you as hours unknown." },
        { label: "Google rating", value: profile.rating ? `${profile.rating.toFixed(1)} from ${profile.reviewCount ?? 0} reviews` : profile.reviewCount === 0 ? "No reviews yet" : undefined, missing: "Not available." },
        { label: "Description", value: profile.description ? `${profile.description.slice(0, 160)}${profile.description.length > 160 ? "…" : ""}` : undefined, missing: "No business description." },
      ]
    : [];
  return (
    <section className="card" aria-labelledby="bp-h">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="bp-h" className="heading-6">Your Business Profile</h2>
        <div className="flex flex-wrap gap-2">
          {profile?.openStatus && OPEN[profile.openStatus] ? <span className={`badge ${OPEN[profile.openStatus].c}`}>{OPEN[profile.openStatus].t}</span> : null}
          {profile?.verified === true ? <span className="badge badge-ok">Verified on Google</span> : profile?.verified === false ? <span className="badge badge-warn">Not verified on Google</span> : null}
        </div>
      </div>
      {error ? <p role="alert" className="field-error">{error}</p> : null}
      {profile ? (
        <>
          <p className="title-3 mt-3 break-words">{profile.title}</p>
          <dl className="mt-3 grid gap-3 sm:grid-cols-2">
            {rows.map((r) => (
              <div key={r.label} className="min-w-0">
                <dt className="caption-2 text-muted">{r.label}</dt>
                <dd className={`body-6 break-words ${r.value ? "" : "text-warn"}`}>{r.value || r.missing}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href="/app/reviews" className="btn btn-secondary btn-sm">Reviews</Link>
            <Link href="/app/posts" className="btn btn-secondary btn-sm">Posts</Link>
            {profile.mapsUri ? <a href={profile.mapsUri} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-sm">Open on Google Maps</a> : null}
          </div>
        </>
      ) : null}
      {profile ? <ScoreCard profile={profile} history={history} /> : null}
      <Source>Google Business Profile{profile ? `, read ${fmtDateTime(profile.fetchedAt)}` : ""}, for {business.name}</Source>
    </section>
  );
}

const METRICS: { key: GbpMetricGroup; label: string }[] = [
  { key: "searchViews", label: "Views on Google Search" },
  { key: "mapsViews", label: "Views on Google Maps" },
  { key: "calls", label: "Calls" },
  { key: "website", label: "Website clicks" },
  { key: "directions", label: "Direction requests" },
  { key: "messages", label: "Message clicks" },
  { key: "bookings", label: "Bookings" },
];

/** Change between two periods, in words. No percentage when the earlier period was 0. */
export function change(now: number, before: number): { text: string; c: string } {
  if (now === before) return { text: "No change", c: "text-muted" };
  if (before === 0) return { text: `▲ up from 0`, c: "text-ok" };
  const pct = Math.round(((now - before) / before) * 100);
  return pct > 0 ? { text: `▲ ${pct}%`, c: "text-ok" } : pct < 0 ? { text: `▼ ${Math.abs(pct)}%`, c: "text-bad" } : { text: "About the same", c: "text-muted" };
}

const day = (d: string) => fmtDate(`${d}T00:00:00Z`);

export function InsightsPanel({ insights, error, refresh, explain }: { insights?: GbpInsights; error?: string; refresh: React.ReactNode; explain?: React.ReactNode }) {
  const max = insights ? Math.max(1, ...insights.dailyViews.map((d) => d.value)) : 1;
  return (
    <section className="card" aria-labelledby="ins-h">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="ins-h" className="heading-6">Performance insights</h2>
          <p className="body-6 mt-1 text-muted">
            {insights ? `${day(insights.current.start)} to ${day(insights.current.end)}, compared with the 28 days before.` : "How people find and contact you on Google, over the last 28 days."}
          </p>
        </div>
        {refresh}
      </div>
      {error ? <p role="alert" className="field-error">{error}</p> : null}
      {insights ? (
        <>
          <dl className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4" aria-label="Performance totals">
            {METRICS.map((m) => {
              const now = insights.current.totals[m.key], before = insights.previous.totals[m.key];
              const ch = change(now, before);
              // Google returned no series for this metric: unknown, which is different from zero.
              if (insights.reported && !insights.reported.includes(m.key)) {
                return (
                  <div key={m.key} className="inset min-w-0" data-metric={m.key} data-reported="no">
                    <dt className="caption-2 text-muted">{m.label}</dt>
                    <dd className="body-6 text-muted">Not reported by Google</dd>
                  </div>
                );
              }
              return (
                <div key={m.key} className="inset min-w-0" data-metric={m.key}>
                  <dt className="caption-2 text-muted">{m.label}</dt>
                  <dd className="title-1 kpi">{now.toLocaleString("en-IN")}</dd>
                  <dd className={`caption-2 ${ch.c}`}>{ch.text}</dd>
                </div>
              );
            })}
          </dl>
          <div className="mt-5">
            <p className="caption-2 text-muted">Profile views per day</p>
            <div className="mt-2 flex h-20 items-end gap-[2px]" role="img"
              aria-label={`Profile views per day, ${day(insights.current.start)} to ${day(insights.current.end)}: ${insights.dailyViews.map((d) => d.value).join(", ")}`}>
              {insights.dailyViews.map((d) => (
                <div key={d.date} className="flex h-full flex-1 items-end rounded-sm bg-surface-3" title={`${day(d.date)}: ${d.value}`}>
                  <div className="w-full rounded-sm bg-accent" style={{ height: `${Math.max((d.value / max) * 100, d.value ? 4 : 0)}%` }} />
                </div>
              ))}
            </div>
          </div>
          <p className="caption-2 mt-3 text-muted">Google can take a few days to report the most recent days, so the last bars may still grow.</p>
          {insights.monthly?.length ? (
            <div className="mt-5 overflow-x-auto">
              <table className="caption-1 w-full min-w-[420px] text-left" aria-label="Monthly totals">
                <thead><tr className="text-muted"><th className="py-1 pr-3 font-medium">Month</th><th className="pr-3 font-medium">Views</th><th className="pr-3 font-medium">Calls</th><th className="pr-3 font-medium">Website</th><th className="font-medium">Directions</th></tr></thead>
                <tbody>
                  {insights.monthly.map((m) => (
                    <tr key={m.month} className="border-t border-line"><td className="py-1 pr-3">{new Date(`${m.month}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "short", year: "numeric", timeZone: "UTC" })}</td>
                      <td className="pr-3">{m.totals.searchViews + m.totals.mapsViews}</td><td className="pr-3">{m.totals.calls}</td><td className="pr-3">{m.totals.website}</td><td>{m.totals.directions}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          <div className="mt-5" data-testid="insights-explanation">
            {insights.explanation ? (
              <div className="panel-soft p-4">
                <p className="body-6">{insights.explanation.text}</p>
                <p className="caption-5 mt-1 text-muted">Written by Claude from the numbers above. It is an interpretation, not data from Google.</p>
              </div>
            ) : explain}
          </div>
          <Source>Google Business Profile Performance API, updated {fmtDateTime(insights.at)}</Source>
        </>
      ) : !error ? (
        <p className="body-6 mt-4 text-muted">No insights loaded yet. Press “Update from Google”.</p>
      ) : null}
    </section>
  );
}

function ScoreCard({ profile, history }: { profile: GbpProfileSnapshot; history: { at: string; value: number }[] }) {
  const r = profileScore(profile);
  const lost = r.items.filter((i) => i.points !== null && i.points < i.max).sort((x, y) => (y.max - (y.points ?? 0)) - (x.max - (x.points ?? 0)));
  return (
    <div className="mt-6 border-t border-line pt-5" data-testid="profile-score">
      <div className="flex flex-wrap items-baseline gap-3">
        <h3 className="title-3">Business Profile score</h3>
        <p className="title-1 kpi">{r.score} <span className="caption-2 text-muted">/ 100</span></p>
        <p className="caption-2 text-muted">from {r.checked} items Google reports</p>
      </div>
      {history.length > 1 ? <TrendBars label="Business Profile score over time" points={history} empty="" /> : null}
      <ul className="mt-3 grid gap-2 sm:grid-cols-2" aria-label="Score items">
        {r.items.map((i) => (
          <li key={i.key} className="caption-1 flex justify-between gap-2" data-item={i.key}>
            <span>{i.label}</span>
            <span className={i.points === null ? "text-muted" : i.points === i.max ? "text-ok" : "text-warn"}>{i.points === null ? "not reported" : `${i.points} / ${i.max}`}</span>
          </li>
        ))}
      </ul>
      {lost.length ? (
        <ol className="mt-4 flex flex-col gap-3" aria-label="How to raise the score">
          {lost.map((i) => (
            <li key={i.key} className="inset">
              <p className="title-4">{i.label}: {i.max - (i.points ?? 0)} points to gain</p>
              <p className="caption-1 mt-1 text-muted">{i.detail}</p>
              <ul className="caption-1 mt-1 list-disc pl-5">{i.steps.map((st) => <li key={st}>{st}</li>)}</ul>
            </li>
          ))}
        </ol>
      ) : <p className="caption-1 mt-3 text-ok">Every item Google reports is complete.</p>}
    </div>
  );
}
