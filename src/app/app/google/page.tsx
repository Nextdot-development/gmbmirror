import type { Metadata } from "next";
import QRCode from "qrcode";
import { requireBusiness } from "@/lib/ctx";
import { db } from "@/lib/store";
import { env } from "@/lib/env";
import { currentProfile, fetchLocations, gbpStatus, INSIGHTS_MAX_AGE_MS, live, refreshInsights } from "@/lib/gbp";
import { checklistRows, STALE_DAYS, type ChecklistStatus } from "@/lib/checklist";
import { historyFor, otherListings } from "@/lib/listing-history";
import { categoryQuery } from "@/lib/places";
import { gridPointsPerDay } from "@/lib/grid";
import { gridPointsUsed } from "@/lib/grid-server";
import { ExplainCompetitors, ExplainInsights, InsightsRefresh } from "@/components/forms";
import { ConnectionNotices, GoogleConnectionPanel, type ConnectParams } from "@/components/GoogleConnection";
import { toggleAuditAction } from "@/app/actions";
import { fmtDate, fmtDateTime, Source, TrendBars } from "@/components/bits";
import { BusinessProfileOverview, InsightsPanel } from "@/components/BusinessProfile";
import { CheckCircle, Circle } from "@phosphor-icons/react/dist/ssr";
import { ReviewShare } from "@/components/ReviewShare";
import { Competitors, ProfileAudit, RankGrid } from "@/components/Places";
import type { Business } from "@/lib/types";

/** Short, neutral review request. The same message goes to every customer, whatever their experience. */
function reviewMessage(b: Business, link: string): { message: string; caption: string } {
  const caption = b.language === "hi" ? "Google पर अपना अनुभव साझा करने के लिए स्कैन करें" : b.language === "hinglish" ? "Google par review dene ke liye scan karein" : "Scan to share your experience on Google";
  // The owner's own message (Settings), with the placeholders filled in.
  if (b.reviewMessage) return { message: b.reviewMessage.replaceAll("{name}", b.name).replaceAll("{link}", link), caption };
  switch (b.language) {
    case "hi":
      return { message: `${b.name} आने के लिए धन्यवाद। अगर आपके पास एक मिनट हो, तो कृपया Google पर अपना अनुभव साझा करें: ${link}`, caption };
    case "hinglish":
      return { message: `${b.name} aane ke liye dhanyavaad. Agar aapke paas ek minute ho, toh please Google par apna experience share karein: ${link}`, caption };
    default:
      return { message: `Thank you for visiting ${b.name}. If you have a minute, please share your experience on Google: ${link}`, caption };
  }
}

export const metadata: Metadata = { title: "Google profile" };

/** The profile audit items, for comparing two audits (our own points; no Google values are stored). */
const AUDIT_POINTS = [
  { key: "status", label: "Business status", max: 10 }, { key: "rating", label: "Rating", max: 15 }, { key: "reviews", label: "Number of reviews", max: 20 },
  { key: "photos", label: "Photos", max: 15 }, { key: "hours", label: "Opening hours", max: 15 }, { key: "website", label: "Website", max: 10 },
  { key: "phone", label: "Phone", max: 10 }, { key: "category", label: "Primary category", max: 5 },
];

const STATUS: Record<ChecklistStatus, { t: string; c: string }> = {
  verified: { t: "Verified on Google", c: "badge-ok" },
  missing: { t: "Missing on Google", c: "badge-bad" },
  attention: { t: "Needs a look", c: "badge-warn" },
  confirmed: { t: "Confirmed by you", c: "badge-ok" },
  unknown: { t: "Not confirmed", c: "" },
};

export default async function GooglePage({ searchParams }: { searchParams: Promise<ConnectParams> }) {
  const sp = await searchParams;
  const { user, scope, business: initial } = await requireBusiness();
  let google = await db.getGoogle(scope);
  const before = gbpStatus(google);
  // Locations are listed only when one must be chosen, or the owner asked to change it (saves Google requests).
  const wantLocations = before === "choose_location" || (before === "connected" && sp.change === "1");
  const { locations, truncated, error: locError } = wantLocations ? await fetchLocations(scope) : { locations: [], truncated: false, error: undefined };
  const isLive = live(google);
  // Insights are fetched again at most every 12 hours on page view; the owner can also update them by hand.
  if (isLive && (!google!.insights || Date.now() - Date.parse(google!.insights.at) > INSIGHTS_MAX_AGE_MS) && !(google!.lastError?.area === "insights" && Date.now() - Date.parse(google!.lastError.at) < 10 * 60_000)) {
    await refreshInsights(scope);
  }
  const profileResult = isLive ? await currentProfile(scope) : { error: undefined };
  // The calls above may have found an expired sign-in or saved a refreshed token: show what is stored now.
  if (isLive || wantLocations) google = await db.getGoogle(scope);
  const status = gbpStatus(google);
  // A sync above may have filled details or changed the listing: show the business as stored now.
  const b = isLive ? ((await db.getBusiness(scope)) ?? initial) : initial;
  const reviewLink = b.placeId ? `https://search.google.com/local/writereview?placeid=${encodeURIComponent(b.placeId)}` : null;
  const qr = reviewLink ? await QRCode.toDataURL(reviewLink, { margin: 2, width: 192 }) : null;
  // A larger copy for printing; the browser adds the business name and saves it as a PNG.
  const printQr = reviewLink ? await QRCode.toDataURL(reviewLink, { margin: 1, width: 800 }) : null;
  const share = reviewLink ? reviewMessage(b, reviewLink) : null;
  const gbpScores = await db.getLocal<{ at: string; score: number; location: string }[]>(scope, "gbp_scores", []);
  const shares = await db.getLocal<Record<string, Record<string, number>>>(scope, "share_events", {});
  const placesOn = env.placesConfigured();
  const allPlaces = await db.getPlaces(scope);
  // History shown here is only what was measured for the current listing; other listings' history is kept.
  const places = historyFor(allPlaces, b.placeId, categoryQuery(b));
  const earlier = otherListings(allPlaces, b.placeId);
  const lastAudit = places.profileScores[0] ?? null;
  const rows = checklistRows(b, lastAudit);
  const [a1, a2] = places.profileScores;
  const auditChanges = a1?.items && a2?.items
    ? AUDIT_POINTS.map((i) => ({ ...i, before: a2.items![i.key] ?? 0, after: a1.items![i.key] ?? 0 })).map((i) => ({ ...i, diff: i.after - i.before })).filter((i) => i.diff !== 0)
    : [];
  // The daily allowance is about cost, so it counts every scan of every location and listing.
  const pointsLeft = Math.max(0, gridPointsPerDay() - (await gridPointsUsed(user.id)));
  const placesNote = !placesOn
    ? "Live Google data needs GOOGLE_PLACES_API_KEY on the server. Ask whoever runs this app to add it."
    : !b.placeId
      ? "Add your Google Place ID in Settings (use Find on Google) to turn this on."
      : null;

  return (
    <div className="flex flex-col gap-8">
      <header>
        <h1 className="heading-4">Google profile</h1>
        <p className="body-3 mt-1 text-muted">Connect your Business Profile, then work through the checklist.</p>
      </header>

      <ConnectionNotices sp={sp} />

      <GoogleConnectionPanel page="google" status={status} google={google} business={b} locations={locations} locError={locError} truncated={truncated} changing={sp.change === "1"} />

      {isLive && status === "connected" ? <BusinessProfileOverview profile={google?.profile?.location === google?.locationName ? google?.profile : undefined} error={profileResult.error} business={b}
        history={gbpScores.filter((x) => x.location === google?.locationName).map((x) => ({ at: x.at, value: x.score }))} /> : null}
      {isLive && status === "connected" ? <InsightsPanel insights={google!.insights} error={google!.lastError?.area === "insights" ? google!.lastError.message : undefined} refresh={<InsightsRefresh />} explain={<ExplainInsights />} /> : null}

      <section className="card" aria-labelledby="pa-h">
        <h2 id="pa-h" className="heading-6">Profile audit from Google</h2>
        <p className="body-6 mb-4 mt-1 text-muted">Reads your public Google listing now and scores rating, reviews, photos, hours, website, phone, category and status.</p>
        {placesNote ? <p className="hint">{placesNote}</p> : <ProfileAudit />}
        <div className="mt-6 border-t border-line pt-4">
          <h3 className="title-4">Audit history</h3>
          <TrendBars label="Profile audit score over time" points={places.profileScores.map((a) => ({ at: a.at, value: a.score }))}
            empty="No audits saved yet. Each audit you run is added here, so you can see progress over time." />
          {auditChanges.length ? (
            <ul className="caption-2 mt-3 flex flex-col gap-1" aria-label="Changes since the previous audit">
              {auditChanges.map((c) => <li key={c.key} className={c.diff > 0 ? "text-ok" : "text-bad"}>{c.diff > 0 ? "▲" : "▼"} {c.label}: {c.before} → {c.after} of {c.max} points</li>)}
            </ul>
          ) : places.profileScores.length > 1 && places.profileScores[1].items ? <p className="caption-2 mt-3 text-muted">No item changed since the previous audit.</p> : null}
          {earlier.audits + earlier.scans + earlier.competitors > 0 ? (
            <p className="caption-2 mt-3 text-muted" data-testid="earlier-listing-history">
              History from a previous Google listing is kept but not shown here ({earlier.audits} audit{earlier.audits === 1 ? "" : "s"}, {earlier.scans} rank scan{earlier.scans === 1 ? "" : "s"}, {earlier.competitors} comparison{earlier.competitors === 1 ? "" : "s"}), because it was measured for a different business listing.
            </p>
          ) : null}
        </div>
      </section>

      <section className="card" aria-labelledby="cmp-h">
        <h2 id="cmp-h" className="heading-6">Competitor comparison</h2>
        <p className="body-6 mb-4 mt-1 text-muted">The top 10 Google results for your category in {b.location}, side by side with you.</p>
        {placesNote ? <p className="hint">{placesNote}</p> : <Competitors placeId={b.placeId!} />}
        {!placesNote && places.competitors?.[0] ? (
          <div className="mt-5 border-t border-line pt-4" data-testid="competitor-explanation">
            {places.competitors[0].explanation ? (
              <div className="panel-soft p-4">
                <p className="body-6">{places.competitors[0].explanation}</p>
                <p className="caption-5 mt-1 text-muted">Written by Claude from the comparison counts of {fmtDate(places.competitors[0].at)}. An interpretation, not data from Google.</p>
              </div>
            ) : <ExplainCompetitors />}
          </div>
        ) : null}
      </section>

      <section className="card" aria-labelledby="grid-h">
        <h2 id="grid-h" className="heading-6">Local rank grid</h2>
        <p className="body-6 mb-4 mt-1 text-muted">Where you appear for a search phrase from 9 or 25 points around your business, and who ranks around you. Results are approximate.</p>
        {placesNote ? <p className="hint">{placesNote}</p> : <RankGrid scans={places.scans} pointsLeft={pointsLeft} allowance={gridPointsPerDay()} keywords={b.keywords ?? []} />}
      </section>

      <section id="audit" className="card scroll-mt-8" aria-labelledby="audit-h">
        <h2 id="audit-h" className="heading-6">Profile checklist</h2>
        <p className="body-6 mt-1 text-muted">
          Your own ticks, plus what the latest profile audit could check on Google. Google&apos;s answer never replaces yours;
          when they differ you choose. Items Google cannot report stay as you set them.
        </p>
        {!lastAudit ? <p className="hint">Run the profile audit above to check the items Google can verify.</p> : null}
        <ul className="mt-4 flex flex-col gap-2" aria-label="Profile checklist items">
          {rows.map((r) => (
            <li key={r.key} className="inset" data-status={r.status}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <form action={toggleAuditAction} className="min-w-0 flex-1">
                  <input type="hidden" name="key" value={r.key} />
                  <button type="submit" className="btn btn-ghost w-full !justify-start !whitespace-normal !px-0 text-left" aria-pressed={r.owner}>
                    {r.owner ? <CheckCircle size={24} weight="fill" color="var(--color-accent)" className="shrink-0" aria-hidden /> : <Circle size={24} className="shrink-0 text-muted" aria-hidden />}
                    <span><span className="body-5 block">{r.label}</span><span className="caption-2 block text-muted">{r.why}</span></span>
                  </button>
                </form>
                <span className={`badge ${STATUS[r.status].c}`}>{STATUS[r.status].t}</span>
              </div>
              {r.google ? (
                <p className="caption-2 mt-2 text-muted">
                  Google: {r.google.text} <span className="whitespace-nowrap">Checked {fmtDate(r.google.at)}.</span>
                  {r.google.stale ? <span className="text-warn"> This check is over {STALE_DAYS} days old; run the audit again.</span> : null}
                </p>
              ) : (
                <p className="caption-2 mt-2 text-muted">{r.owner ? "Confirmed by you." : "Not confirmed yet."} Google does not report this item.</p>
              )}
              {r.conflict ? (
                <form action={toggleAuditAction} className="mt-2 flex flex-wrap items-center gap-2">
                  <input type="hidden" name="key" value={r.key} />
                  <input type="hidden" name="value" value={String(r.google?.verdict === "yes")} />
                  <span className="caption-2 text-warn">Your answer and Google&apos;s differ.</span>
                  <button type="submit" className="btn btn-secondary btn-sm">Use Google&apos;s answer</button>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
        <Source>your ticks, and the profile audit of {lastAudit ? fmtDate(lastAudit.at) : "—"} for the items Google reports</Source>
      </section>

      <section className="card" aria-labelledby="rl">
        <h2 id="rl" className="heading-6">Review link and QR code</h2>
        {reviewLink && qr ? (
          <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-start">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qr} alt="QR code that opens your Google review page" width={192} height={192} className="rounded-xl border border-line" />
            <div className="min-w-0">
              <p className="body-6 break-all text-muted">{reviewLink}</p>
              <p className="hint mt-3">Everyone who scans goes to the same Google review page. We do not filter by rating, and Google does not allow it.</p>
              {printQr && share ? <ReviewShare message={share.message} caption={share.caption} businessName={b.name} printQr={printQr} link={reviewLink} /> : null}
              <ShareCounts counts={shares[new Date().toISOString().slice(0, 7)]} />
            </div>
          </div>
        ) : (
          <p className="body-6 mt-2 text-muted">Add your Google Place ID in Settings to generate your review link and QR code.</p>
        )}
      </section>
    </div>
  );
}

/** What was done with the review link this month, counted in this app only. */
function ShareCounts({ counts }: { counts?: Record<string, number> }) {
  const c = counts ?? {};
  return (
    <p className="caption-2 mt-3 text-muted" data-testid="share-counts">
      This month: {c.whatsapp_opened ?? 0} WhatsApp shares started, {c.qr_downloaded ?? 0} QR downloads, {c.link_copied ?? 0} link copies, {c.message_copied ?? 0} message copies.
      These count actions in this app; whether a customer then wrote a review is not known.
    </p>
  );
}
