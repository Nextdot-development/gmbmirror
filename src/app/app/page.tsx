import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, TrendDown, TrendUp, CheckCircle } from "@phosphor-icons/react/dist/ssr";
import { requireBusiness } from "@/lib/ctx";
import { db } from "@/lib/store";
import { gbpStatus } from "@/lib/gbp";
import { env } from "@/lib/env";
import { categoryInfo } from "@/lib/business";
import { currentRecommendations } from "@/lib/growth";
import { loadGrowth } from "@/lib/growth-server";
import { checkScore } from "@/lib/visibility";
import { fmtDate, Ring, Source, TrendBars } from "@/components/bits";
import { GrowthRefresh } from "@/components/GrowthRefresh";
import type { Priority } from "@/lib/types";

export const metadata: Metadata = { title: "Dashboard" };

const PRIORITY: Record<Priority, string> = { Critical: "badge-bad", High: "badge-warn", Medium: "" };

export default async function Dashboard() {
  const { user, scope, business: b } = await requireBusiness();
  const [{ view, growth, places, checks }, google] = await Promise.all([loadGrowth(scope, b), db.getGoogle(scope)]);
  const { recs, source, stale } = currentRecommendations(view, growth);
  const gStatus = ({
    not_configured: { t: "Google not connected", c: "badge-warn" },
    not_connected: { t: "Google not connected", c: "badge-warn" },
    reconnect: { t: "Google: reconnect needed", c: "badge-bad" },
    not_enabled: { t: "Google connected, not switched on yet", c: "badge-warn" },
    choose_location: { t: "Google connected: choose a location", c: "badge-warn" },
    connected: { t: "Google connected", c: "badge-ok" },
  } as const)[gbpStatus(google)];
  const gs = gbpStatus(google);
  // A next step, only when connecting is possible and something is missing.
  const connectCta = gs === "not_connected" ? { text: "Connect your Google Business Profile to bring in your reviews, posts and profile details.", href: "/app/onboarding/connect", label: "Connect Google" }
    : gs === "reconnect" ? { text: "Your Google sign-in has expired. Reconnect to keep your reviews and profile up to date.", href: "/app/settings#google", label: "Reconnect Google" }
    : gs === "choose_location" ? { text: "Choose which business location to manage.", href: "/app/onboarding/connect", label: "Choose location" }
    : null;

  return (
    <div className="flex flex-col gap-8">
      <header className="panel-glow p-6 sm:p-8">
        <p className="eyebrow">Dashboard</p>
        <h1 className="heading-3 mt-3">{b.name}</h1>
        <p className="body-3 mt-1 text-muted">{b.location} · {categoryInfo(b.category, b.type).label}</p>
        <p className="mt-4"><span className={`badge ${gStatus.c}`}>{gStatus.t}</span></p>
      </header>

      {connectCta ? (
        <div className="panel-soft flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between" data-testid="connect-cta">
          <p className="body-5">{connectCta.text}</p>
          <Link href={connectCta.href} className="btn btn-primary btn-sm shrink-0">{connectCta.label}</Link>
        </div>
      ) : null}

      {/* 1. Overall business health */}
      <section aria-labelledby="health-h" className="card">
        <h2 id="health-h" className="heading-6">Business health</h2>
        <div className="mt-4 grid gap-6 md:grid-cols-[auto_1fr] md:items-center">
          {view.health ? (
            <div className="flex items-center gap-4">
              <Ring value={view.health.score} total={100} size={88} />
              <div>
                <p className="heading-3 kpi">{view.health.score}<span className="title-3 text-muted"> / 100</span></p>
                <p className="caption-2 text-muted">Based on {view.health.measured} of {view.health.total} measures</p>
              </div>
            </div>
          ) : (
            <div className="max-w-[260px]">
              <p className="title-3">Not measured yet</p>
              <p className="caption-2 mt-1 text-muted">The score appears after your first profile audit, visibility check, competitor comparison or rank scan.</p>
            </div>
          )}
          <ul className="grid gap-2 sm:grid-cols-2" aria-label="Measures">
            {view.measures.map((m) => (
              <li key={m.key}>
                <Link href={m.href} className="inset flex items-center justify-between gap-3 transition-colors hover:border-brand-soft hover:bg-surface">
                  <span className="min-w-0">
                    <span className="title-4 block">{m.label}</span>
                    <span className="caption-2 block text-muted">{m.detail}{m.at ? ` · ${fmtDate(m.at)}` : ""}</span>
                  </span>
                  <span className={`title-2 shrink-0 ${m.value === undefined ? "text-muted" : "kpi"}`}>{m.value === undefined ? "–" : m.value}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
        <Source>measurements made by this product from Google Places and AI assistants, and your own checklist. Missing measures are not estimated.</Source>
      </section>

      {/* 2. Top 3 recommended actions */}
      <section aria-labelledby="recs-h">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 id="recs-h" className="heading-6">Your top {recs.length === 1 ? "action" : `${recs.length} actions`}</h2>
          <GrowthRefresh stale={stale} source={source} canAsk={view.hasSignals && env.anthropicConfigured()} />
        </div>
        {recs.length ? (
          <ol className="flex flex-col gap-3" aria-label="Recommended actions">
            {recs.map((r, i) => (
              <li key={r.id} className="card p-4" data-action={r.id}>
                <div className="flex items-start gap-4">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-pale caption-3 text-brand-strong" aria-hidden>{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`badge ${PRIORITY[r.priority]}`}>{r.priority}</span>
                      <span className="badge">{r.difficulty}</span>
                    </div>
                    <h3 className="title-3 mt-2"><span className="sr-only">{i + 1}. </span>{r.title}</h3>
                    <p className="body-6 mt-1 text-muted">{r.why}</p>
                    <ul className="caption-2 mt-2 flex flex-col gap-1" aria-label="Evidence from your data">
                      {r.evidence.map((e) => <li key={e} className="text-ink">• {e}</li>)}
                    </ul>
                    <p className="caption-2 mt-2 text-muted"><strong className="text-ink">Expected benefit:</strong> {r.benefit}</p>
                    <Link href={`/app/actions/${r.id}`} className="btn btn-secondary btn-sm mt-3">Open action plan <ArrowRight size={14} aria-hidden /></Link>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <p className="card body-5 text-muted">Nothing urgent in your data right now. Run the checks again from time to time to keep this current.</p>
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* 3. Competitor insights */}
        <section aria-labelledby="cmp-h" className="card">
          <h2 id="cmp-h" className="heading-6">Competitor insights</h2>
          {view.competitor ? (
            <>
              <ul className="body-6 mt-3 flex flex-col gap-2">{view.competitor.lines.map((l) => <li key={l}>{l}</li>)}</ul>
              <Source>competitor comparison, {fmtDate(view.competitor.snapshot.at)}. Counts only; open the Google profile page for the full table.</Source>
            </>
          ) : (
            <p className="body-6 mt-3 text-muted">
              No comparison yet. {b.placeId ? <Link href="/app/google" className="underline">Compare with competitors</Link> : <Link href="/app/settings" className="underline">Add your Google Place ID</Link>} to see where nearby businesses are ahead.
            </p>
          )}
        </section>

        {/* 6. Recent improvements */}
        <section aria-labelledby="chg-h" className="card">
          <h2 id="chg-h" className="heading-6">Recent changes</h2>
          {view.changes.length ? (
            <ul className="mt-3 flex flex-col gap-2" aria-label="Recent changes">
              {view.changes.map((c) => (
                <li key={`${c.text}-${c.at}`} className="body-6 flex items-start gap-2">
                  {c.direction === "up" ? <TrendUp size={18} className="mt-0.5 shrink-0 text-ok" aria-label="Improved" /> : c.direction === "down" ? <TrendDown size={18} className="mt-0.5 shrink-0 text-bad" aria-label="Declined" /> : <CheckCircle size={18} className="mt-0.5 shrink-0 text-accent" aria-label="Done" />}
                  <span>{c.text} <span className="caption-2 text-muted">· {fmtDate(c.at)}</span></span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="body-6 mt-3 text-muted">Changes appear once a check has been run twice, or when you mark an action done.</p>
          )}
        </section>

        {/* 4. Profile performance trend */}
        <section aria-labelledby="ptrend-h" className="card">
          <h2 id="ptrend-h" className="heading-6">Google profile score</h2>
          <TrendBars label="Profile audit score over time" points={places.profileScores.map((a) => ({ at: a.at, value: a.score }))}
            empty="No profile audits yet. Run one on the Google profile page; each audit is added here." />
          <Source>profile audits run by this product</Source>
        </section>

        {/* 5. AI visibility trend */}
        <section aria-labelledby="vtrend-h" className="card">
          <h2 id="vtrend-h" className="heading-6">AI visibility score</h2>
          <TrendBars label="AI visibility score over time" points={checks.map((c) => ({ at: c.checkedAt, value: checkScore(c) }))}
            empty="No visibility checks yet. Run one on the AI visibility page." />
          <p className="mt-3"><Link href="/app/visibility" className="btn btn-ghost btn-sm">{checks.length ? "Run a new visibility check" : "Run your first visibility check"}</Link></p>
          <Source>AI visibility checks performed by this product</Source>
        </section>
      </div>
    </div>
  );
}
