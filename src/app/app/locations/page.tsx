import type { Metadata } from "next";
import { requireScope } from "@/lib/ctx";
import { db, type Scope } from "@/lib/store";
import { fetchLocations, gbpStatus, live } from "@/lib/gbp";
import { loadGrowth } from "@/lib/growth-server";
import { categoryInfo } from "@/lib/business";
import { addLocationAction, switchLocationAction } from "@/app/actions";
import { AddGoogleLocationForm, RemoveLocationForm } from "@/components/forms";
import { CONN_BADGE } from "@/components/GoogleConnection";
import { fmtDate } from "@/components/bits";

export const metadata: Metadata = { title: "Locations" };

type Row = {
  id: string; active: boolean; name: string; place: string; status: keyof typeof CONN_BADGE | "setup";
  health?: number; audit?: number; rating?: string; scheduled: number; drafts: number; waiting: number; lastCheck?: string;
};

/** One location's summary, from its own stored data only (no Google calls, nothing shared between locations). */
async function summary(scope: Scope, active: boolean, i: number): Promise<Row> {
  // Everything this summary reads, in one round trip per location.
  await db.preload(scope, ["business", "google", "posts", "replies", "places", "checks", "growth"]);
  const b = await db.getBusiness(scope);
  if (!b) return { id: scope.loc, active, name: `New location ${i + 1}`, place: "Setup not finished", status: "setup", scheduled: 0, drafts: 0, waiting: 0 };
  const [google, posts, replies, { view, places, checks }] = await Promise.all([db.getGoogle(scope), db.getPosts(scope), db.getReplies(scope), loadGrowth(scope, b)]);
  const snap = live(google) && google.profile?.location === google.locationName ? google.profile : undefined;
  return {
    id: scope.loc, active, name: b.name, place: `${b.location} · ${categoryInfo(b.category, b.type).label}`, status: gbpStatus(google),
    health: view.health?.score, audit: places.profileScores[0]?.score,
    rating: snap?.rating ? `${snap.rating.toFixed(1)} (${snap.reviewCount ?? 0})` : undefined,
    scheduled: posts.filter((p) => p.status === "approved" && p.scheduledAt).length,
    drafts: posts.filter((p) => p.status === "draft").length,
    waiting: Object.values(replies).filter((r) => r.status === "approved").length,
    lastCheck: checks[0]?.checkedAt,
  };
}

export default async function Locations({ searchParams }: { searchParams: Promise<{ error?: string; removed?: string }> }) {
  const sp = await searchParams;
  const { user, scope } = await requireScope();
  const idx = await db.getLocations(user.id);
  const rows = await Promise.all(idx.ids.map((id, i) => summary({ userId: user.id, loc: id }, id === idx.active, i)));
  const conn = await db.getGoogle(scope);
  // Other Business Profile locations on the active location's Google account, not yet added.
  let addable: { location: string; title: string; address: string }[] = [];
  let addError: string | undefined;
  if (live(conn)) {
    const { locations, error } = await fetchLocations(scope);
    addError = error;
    const taken = new Set((await Promise.all(idx.ids.map((id) => db.getGoogle({ userId: user.id, loc: id })))).map((c) => c?.locationName).filter(Boolean));
    addable = locations.filter((l) => !taken.has(l.location)).map((l) => ({ location: l.location, title: l.title, address: l.address }));
  }
  const ready = rows.filter((r) => r.status !== "setup");
  const healthRows = ready.filter((r) => r.health !== undefined);
  const avgHealth = healthRows.length ? Math.round(healthRows.reduce((n, r) => n + r.health!, 0) / healthRows.length) : undefined;

  return (
    <div className="flex flex-col gap-8">
      <header>
        <h1 className="heading-4">Locations</h1>
        <p className="body-3 mt-1 text-muted">Every business location in your account. Each one has its own reviews, posts, audits, rankings and settings.</p>
      </header>
      {sp.error === "limit" ? <p role="alert" className="field-error">You can manage up to 25 locations.</p> : null}
      {sp.removed ? <p role="status" className="body-6 font-medium text-ok" data-testid="location-removed">The location was removed. Your other locations were not changed.</p> : null}

      <section aria-labelledby="ov-h">
        <h2 id="ov-h" className="sr-only">Account overview</h2>
        <dl className="grid grid-cols-2 gap-3 md:grid-cols-4" data-testid="account-overview">
          <Stat label="Locations" value={String(rows.length)} />
          <Stat label="Connected to Google" value={String(rows.filter((r) => r.status === "connected").length)} />
          <Stat label="Average health score" value={avgHealth === undefined ? "Not measured" : `${avgHealth} / 100`} />
          <Stat label="Posts scheduled" value={String(rows.reduce((n, r) => n + r.scheduled, 0))} />
        </dl>
      </section>

      <ul className="flex flex-col gap-3" aria-label="Your locations">
        {rows.map((r) => (
          <li key={r.id} className={`card flex flex-col gap-3 ${r.active ? "border-brand" : ""}`} data-location={r.id}>
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="min-w-0">
              <p className="title-3 break-words">{r.name} {r.active ? <span className="badge ml-1">Showing now</span> : null}</p>
              <p className="caption-2 text-muted">{r.place}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {r.status === "setup" ? <span className="badge badge-warn">Finish setup</span> : <span className={`badge ${CONN_BADGE[r.status].c}`}>Google: {CONN_BADGE[r.status].t}</span>}
              </div>
              <p className="caption-2 mt-2 text-muted">
                {[r.health !== undefined ? `Health ${r.health}/100` : null, r.audit !== undefined ? `Profile audit ${r.audit}/100` : null, r.rating ? `Rating ${r.rating}` : null,
                  `${r.scheduled} scheduled · ${r.drafts} draft posts`, r.waiting ? `${r.waiting} approved replies to publish` : null, r.lastCheck ? `AI visibility checked ${fmtDate(r.lastCheck)}` : null].filter(Boolean).join(" · ")}
              </p>
            </div>
            <form action={switchLocationAction}>
              <input type="hidden" name="loc" value={r.id} />
              <button type="submit" className={`btn btn-sm ${r.active ? "btn-secondary" : "btn-primary"}`}>{r.active ? "Open dashboard" : "Switch to this location"}</button>
            </form>
            </div>
            {rows.length > 1 ? <RemoveLocationForm loc={r.id} name={r.name} connected={r.status !== "setup" && r.status !== "not_connected" && r.status !== "not_configured"} /> : null}
          </li>
        ))}
      </ul>

      <section className="card flex flex-col gap-4" aria-labelledby="add-h">
        <h2 id="add-h" className="heading-6">Add a location</h2>
        {addable.length ? <AddGoogleLocationForm options={addable} /> : null}
        {addError ? <p role="alert" className="field-error">{addError}</p> : null}
        {live(conn) && !addable.length && !addError ? <p className="body-6 text-muted">Every location on your connected Google account is already added.</p> : null}
        <form action={addLocationAction}>
          <button type="submit" className="btn btn-secondary">Add a location by hand</button>
          <p className="hint">You enter its basic details, then connect it to Google.</p>
        </form>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="inset">
      <dt className="caption-2 text-muted">{label}</dt>
      <dd className="title-2">{value}</dd>
    </div>
  );
}
