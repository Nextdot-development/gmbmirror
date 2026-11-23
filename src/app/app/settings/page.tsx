import type { Metadata } from "next";
import { requireBusiness } from "@/lib/ctx";
import { AiPreferencesForm, AutomationForm, BusinessInfoForm, DeleteAccountForm, NotificationPrefsForm, RefreshFromGoogle } from "@/components/forms";
import { getPrefs } from "@/lib/notify";
import { emailConfigured, type EmailLogEntry } from "@/lib/email";
import { defaultAutomation } from "@/lib/review-safety";
import { BusinessFinder } from "@/components/BusinessFinder";
import { ConnectionNotices, GoogleConnectionPanel, type ConnectParams } from "@/components/GoogleConnection";
import { deleteAllDataAction, useGoogleValueAction } from "@/app/actions";
import { env } from "@/lib/env";
import { db } from "@/lib/store";
import { currentProfile, fetchLocations, gbpStatus, live } from "@/lib/gbp";
import { profileGaps } from "@/lib/business-sync";
import { fmtDateTime } from "@/components/bits";
import { BRAND } from "@/lib/brand";
import type { GbpProfileSnapshot } from "@/lib/types";

export const metadata: Metadata = { title: "Settings" };

const EMAIL_STATUS: Record<EmailLogEntry["status"], string> = { accepted: "Accepted", failed: "Not sent", not_configured: "Not sent (email not set up)", skipped: "Not sent" };

const OPEN: Record<string, string> = { OPEN: "Open", CLOSED_TEMPORARILY: "Temporarily closed", CLOSED_PERMANENTLY: "Permanently closed" };

export default async function Settings({ searchParams }: { searchParams: Promise<ConnectParams> }) {
  const sp = await searchParams;
  const { user, scope, business: initial } = await requireBusiness(["google", "places"]);
  const before = gbpStatus(await db.getGoogle(scope));
  const changing = sp.change === "1";
  const wantLocations = before === "choose_location" || (before === "connected" && changing);
  const { locations, truncated, error: locError } = wantLocations ? await fetchLocations(scope) : { locations: [], truncated: false, error: undefined };
  // Reads the Business Profile again when the stored copy is missing or old, and fills empty details from it.
  const { conn: google, error: syncError } = await currentProfile(scope);
  const status = gbpStatus(google);
  const b = (await db.getBusiness(scope)) ?? initial;
  const [prefs, emailLog] = await Promise.all([getPrefs(user.id), db.getUserKey<EmailLogEntry[]>(user.id, "email_log", [])]);
  const mailOn = emailConfigured();
  const snap: GbpProfileSnapshot | undefined = live(google) && google.profile?.location === google.locationName ? google.profile : undefined;
  const gaps = profileGaps(b, snap);
  const gapFor = (k: string) => gaps.find((g) => g.key === k)?.text;
  // The public listing follows the Business Profile location once one is chosen.
  const listingFromProfile = Boolean(snap?.placeId && snap.placeId === b.placeId);

  return (
    <div className="flex max-w-[680px] flex-col gap-10">
      <header>
        <h1 className="heading-4">Settings</h1>
        <nav aria-label="Settings sections" className="mt-3 flex flex-wrap gap-2">
          {[["#business", "Business"], ["#google", "Google connection"], ["#ai", "AI preferences"], ["#automation", "Automation"], ["#account", "Account"]].map(([href, label]) => (
            <a key={href} href={href} className="btn btn-ghost btn-sm">{label}</a>
          ))}
        </nav>
      </header>

      <ConnectionNotices sp={sp} />

      <section id="business" className="scroll-mt-8" aria-labelledby="biz">
        <h2 id="biz" className="heading-6">Business information</h2>
        <p className="body-6 mb-5 mt-1 text-muted">Used on every page, in AI drafts and in AI visibility checks.</p>
        <BusinessInfoForm initial={b} hints={{ phone: snap ? undefined : gapFor("phone"), website: snap ? undefined : gapFor("website") }} />

        <div className="mt-8 border-t border-line pt-6" aria-labelledby="from-google" data-testid="from-google">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 id="from-google" className="title-3">From your Google Business Profile</h3>
            {snap ? <RefreshFromGoogle /> : null}
          </div>
          {syncError ? <p role="alert" className="field-error">{syncError}</p> : null}
          {!snap ? (
            <p className="body-6 mt-2 text-muted">
              {status === "connected" ? "Your profile details have not been read yet." : "Connect Google below to bring in your address, opening hours, rating and more automatically."}
            </p>
          ) : (
            <>
              <dl className="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-2">
                <Fact label="Name on Google" value={snap.title} />
                <Fact label="Address" value={snap.address} missing="Not on Google" />
                <Fact label="Phone on Google" value={snap.phone} missing="Not on Google" />
                <Fact label="Website on Google" value={snap.website} missing="Not on Google" />
                <Fact label="Primary category on Google" value={snap.category} missing="Not on Google" />
                <Fact label="Status" value={snap.openStatus ? OPEN[snap.openStatus] : undefined} missing="Not reported by Google" />
                <Fact label="Verification" value={snap.verified === undefined ? undefined : snap.verified ? "Verified" : "Not verified"} missing="Not reported by Google" />
                <Fact label="Rating" value={snap.rating ? `${snap.rating.toFixed(1)} from ${snap.reviewCount ?? 0} reviews` : snap.reviewCount === 0 ? "No reviews yet" : undefined} missing="Not reported by Google" />
                <div className="sm:col-span-2">
                  <dt className="caption-2 text-muted">Opening hours</dt>
                  {snap.hours.length ? (
                    <dd><ul className="body-6">{snap.hours.map((h) => <li key={h}>{h}</li>)}</ul></dd>
                  ) : <dd className="body-6 text-warn">Not on Google</dd>}
                </div>
              </dl>
              <p className="caption-2 mt-3 text-muted">Read {fmtDateTime(snap.fetchedAt)}. Address and hours are changed in Google Business Profile itself.</p>
              {(["name", "website", "phone"] as const).map((f) => {
                const g = f === "name" ? snap.title : snap[f];
                const mine = b[f] ?? "";
                if (!g || g.trim().toLowerCase() === mine.trim().toLowerCase()) return null;
                return (
                  <form key={f} action={useGoogleValueAction} className="mt-2 flex flex-wrap items-center gap-2" data-testid={`differs-${f}`}>
                    <input type="hidden" name="field" value={f} />
                    <span className="caption-1">Google&apos;s {f} differs from yours: <strong className="break-all">{g}</strong></span>
                    <button type="submit" className="btn btn-secondary btn-sm">Use Google&apos;s {f}</button>
                  </form>
                );
              })}
              {gaps.length ? (
                <ul className="mt-4 flex flex-col gap-1" aria-label="Worth improving">
                  {gaps.map((g) => <li key={g.key} className="caption-1 text-warn">{g.text}</li>)}
                </ul>
              ) : null}
            </>
          )}
        </div>
      </section>

      <GoogleConnectionPanel page="settings" status={status} google={google} business={b} locations={locations} locError={locError} truncated={truncated} changing={changing} />

      <section className="scroll-mt-8" aria-labelledby="listing-h" id="listing">
        <h2 id="listing-h" className="heading-6">Public Google listing</h2>
        <p className="body-6 mb-4 mt-1 text-muted">
          The public listing the profile audit, competitor comparison, rank grid and review link use. Reading it does not connect your Business Profile.
        </p>
        {listingFromProfile ? (
          <p className="inset body-6" data-testid="listing-from-profile">
            Linked to your Business Profile location, <strong>{google?.locationTitle}</strong>. To use a different listing, change the location above.
          </p>
        ) : (
          <BusinessFinder initialId={b.placeId} placesOn={env.placesConfigured()} defaultName={b.name} defaultCity={b.location} />
        )}
      </section>

      <section id="ai" className="scroll-mt-8" aria-labelledby="ai-h">
        <h2 id="ai-h" className="heading-6">AI preferences</h2>
        <p className="body-6 mb-5 mt-1 text-muted">How Claude writes for you, and what AI visibility checks look for.</p>
        <AiPreferencesForm initial={b} />
      </section>

      <section id="automation" className="scroll-mt-8" aria-labelledby="auto-h">
        <h2 id="auto-h" className="heading-6">Automation</h2>
        <p className="body-6 mb-5 mt-1 text-muted">For this location only. Every automatic action is logged on the Reviews page.</p>
        <AutomationForm initial={b.automation ?? defaultAutomation()} canAuto={live(google)} />
      </section>

      <section id="email" className="scroll-mt-8" aria-labelledby="email-h">
        <h2 id="email-h" className="heading-6">Email notifications</h2>
        <p className="body-6 mb-5 mt-1 text-muted" data-testid="email-status">
          {mailOn
            ? <>Sent to <span className="break-all">{user.email}</span>, for every location of this account.</>
            : <>Email is not set up on this server yet, so nothing is sent. Your choices are kept for when it is.</>}
        </p>
        <NotificationPrefsForm initial={prefs} configured={mailOn} />
        {emailLog.length ? (
          <div className="mt-6" data-testid="email-log">
            <h3 className="title-4">Recent emails</h3>
            <ul className="mt-2 flex flex-col gap-1">
              {emailLog.slice(0, 8).map((m, i) => (
                <li key={i} className="caption-1 flex flex-wrap gap-x-2">
                  <span className="text-muted">{fmtDateTime(m.at)}</span>
                  <span>{m.subject}</span>
                  <span className={m.status === "accepted" ? "text-ok" : "text-muted"}>{EMAIL_STATUS[m.status]}{m.detail ? `: ${m.detail}` : ""}</span>
                </li>
              ))}
            </ul>
            <p className="caption-2 mt-2 text-muted">&ldquo;Accepted&rdquo; means Resend took the message for delivery; it cannot confirm it reached the inbox.</p>
          </div>
        ) : null}
      </section>

      <section id="account" className="scroll-mt-8" aria-labelledby="del">
        <h2 id="del" className="heading-6">Account</h2>
        <p className="body-6 mt-1 text-muted">Signed in as <span className="break-all">{user.email}</span>.</p>
        <p className="body-6 mt-1 text-muted" data-testid="support-email">Need help? Email <a className="text-brand underline underline-offset-2" href={`mailto:${BRAND.email}`}>{BRAND.email}</a></p>
        <div className="mt-5">
          <h3 className="title-4">Delete my business data</h3>
          <p className="body-6 mb-4 mt-1 text-muted">Cancels Google access and deletes the business data of every location: details, drafts, replies, posts, schedules, reports, logs, settings, email preferences and stored Google tokens. Your sign-in account stays, so you can start again. This cannot be undone.</p>
          <form action={deleteAllDataAction} className="flex flex-col items-start gap-3">
            <label className="flex items-center gap-2 body-5">
              <input type="checkbox" required className="accent-accent" /> I understand this cannot be undone
            </label>
            <button type="submit" className="btn btn-secondary">Delete all my data</button>
          </form>
        </div>
        <div className="mt-8 border-t border-line pt-6" id="delete-account">
          <h3 className="title-4">Delete my account</h3>
          <div className="body-6 mb-4 mt-1 flex flex-col gap-2 text-muted">
            <p>Deletes everything above and also the sign-in account itself, then signs you out everywhere. Google is asked to cancel {BRAND.name}&apos;s access for every connected location.</p>
            <p>Not deleted: replies and posts already published on Google (remove them there), and copies in our providers&apos; backups and logs until they expire. <a className="text-brand underline underline-offset-2" href="/data-deletion">Details</a>.</p>
          </div>
          <DeleteAccountForm email={user.email} />
        </div>
        {process.env.NODE_ENV === "development" ? (
          <ul className="caption-2 mt-6 flex flex-col gap-1 text-muted" aria-label="Setup status (development only)">
            <li>Developer setup status (shown only in development):</li>
            <li>App mode: {env.mode() === "supabase" ? "Supabase database" : "Local demo store"}</li>
            <li>Google sign in configured: {env.googleConfigured() ? "yes" : "no"}; live Business Profile calls: {env.gbpApproved() ? "on" : "off"}</li>
            <li>Claude: {env.anthropicConfigured() ? "on" : "off"}; OpenAI: {env.openaiConfigured() ? "on" : "off"}; Gemini: {env.geminiConfigured() ? "on" : "off"}; Places: {env.placesConfigured() ? "on" : "off"}</li>
          </ul>
        ) : null}
      </section>
    </div>
  );
}

function Fact({ label, value, missing }: { label: string; value?: string; missing?: string }) {
  return (
    <div className="min-w-0">
      <dt className="caption-2 text-muted">{label}</dt>
      <dd className={`body-6 break-words ${value ? "" : "text-warn"}`}>{value || missing}</dd>
    </div>
  );
}
