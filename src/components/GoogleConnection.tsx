import { disconnectGoogleAction } from "@/app/actions";
import { LocationForm } from "@/components/forms";
import { fmtDate, fmtDateTime, Source } from "@/components/bits";
import type { GbpStatus } from "@/lib/gbp-state";
import type { GbpLocation } from "@/lib/gbp-api";
import type { Business, GoogleConnection } from "@/lib/types";
import { GooglePermissions } from "./GooglePermissions";
import { BRAND } from "@/lib/brand";

/** Shared by the Google page and Settings: messages after sign-in or disconnect, and the connection panel. */

export const CONN_BADGE: Record<GbpStatus, { t: string; c: string }> = {
  not_configured: { t: "Coming soon", c: "" },
  not_connected: { t: "Not connected", c: "badge-warn" },
  reconnect: { t: "Reconnect needed", c: "badge-bad" },
  not_enabled: { t: "Connected, not switched on yet", c: "badge-warn" },
  choose_location: { t: "Choose a location", c: "badge-warn" },
  connected: { t: "Connected", c: "badge-ok" },
};

const AREA: Record<string, string> = { locations: "locations", profile: "profile", reviews: "reviews", reply: "replies", posts: "posts", insights: "insights" };

export const CONNECT_ERRORS: Record<string, string> = {
  denied: "You cancelled the Google sign in. Nothing was connected.",
  state: "The sign in could not be verified. Start the connection again.",
  exchange: "Google did not accept the sign in. Try again.",
  scope: "Google did not give permission to manage your Business Profile, so nothing was connected. Connect again and allow access when Google asks.",
  not_configured: "Connecting Google Business Profile is not available yet. Please try again later.",
};

export type ConnectParams = { error?: string; connected?: string; disconnected?: string; change?: string; location?: string };

export function ConnectionNotices({ sp }: { sp: ConnectParams }) {
  return (
    <>
      {sp.error ? <p role="alert" className="card field-error">{CONNECT_ERRORS[sp.error] ?? "Something went wrong."}</p> : null}
      {sp.connected ? <p role="status" className="card body-5 text-ok">Google account connected.</p> : null}
      {sp.location === "saved" ? <p role="status" className="card body-5 text-ok">Location saved. Your details were updated from Google.</p> : null}
      {sp.location === "unsynced" ? <p role="status" className="card body-5">Location saved. Its details could not be read from Google yet; they will be read again later.</p> : null}
      {sp.disconnected === "1" ? <p role="status" className="card body-5 text-ok">Disconnected. Google confirmed this app no longer has access, and the stored tokens were deleted.</p> : null}
      {sp.disconnected === "shared" ? (
        <p role="status" className="card body-5">Disconnected for this location and its stored tokens were deleted. Your other locations still use this Google account, so access was not cancelled at Google.</p>
      ) : null}
      {sp.disconnected === "local" ? (
        <p role="status" className="card body-5">
          Disconnected here and the stored tokens were deleted, but Google did not confirm it cancelled access. To be sure, remove this app at{" "}
          <a className="underline" href="https://myaccount.google.com/permissions" target="_blank" rel="noopener noreferrer">myaccount.google.com/permissions</a>.
        </p>
      ) : null}
    </>
  );
}

export function GoogleConnectionPanel({
  page, status, google, business: b, locations, locError, truncated, changing,
}: {
  page: "google" | "settings"; status: GbpStatus; google: GoogleConnection | null; business: Business;
  locations: GbpLocation[]; locError?: string; truncated?: boolean; changing: boolean;
}) {
  const startHref = page === "settings" ? "/api/google/start?from=settings" : "/api/google/start";
  const changeHref = page === "settings" ? "/app/settings?change=1#google" : "/app/google?change=1#conn";
  const changingOrChoosing = changing || status === "choose_location";
  const devNote = process.env.NODE_ENV === "development";
  return (
    <section className={page === "settings" ? "scroll-mt-8" : "card scroll-mt-8"} aria-labelledby="conn" id={page === "settings" ? "google" : undefined}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="conn" className="heading-6">{page === "settings" ? "Google connection" : "Connection"}</h2>
        <span className={`badge ${CONN_BADGE[status].c}`} data-testid="gbp-status">{CONN_BADGE[status].t}</span>
      </div>
      {status === "not_configured" ? (
        <div className="mt-4 flex flex-col items-start gap-3">
          <p className="body-6 text-muted">
            Connecting your Google Business Profile will be available here soon. You will then see your real reviews, publish replies and posts,
            and follow your profile&apos;s performance. Until then you can draft replies and posts; nothing is published to Google.
          </p>
          <a href={startHref} className="btn btn-primary" aria-disabled="true">Connect Google Business Profile</a>
          {devNote ? <p className="hint">Developer note (shown only in development): set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REDIRECT_URI. See docs/MASTER_PROJECT_STATUS.md.</p> : null}
        </div>
      ) : !google ? (
        <div className="mt-4 flex flex-col gap-4">
          <p className="body-6 text-muted">
            Sign in with the Google account that manages your profile. Connecting lets {BRAND.name} show your real reviews, profile and performance,
            and publish the replies and posts you approve. Nothing is published without your approval.
          </p>
          <GooglePermissions startHref={startHref} />
        </div>
      ) : (
        <div className="mt-4 flex flex-col gap-4">
          <p className="body-5 break-words">
            Connected as {google.email || "your Google account"} on {fmtDate(google.connectedAt)}.
            {google.locationTitle ? <> Managing: <strong>{google.locationTitle}</strong>{google.locationAddress ? `, ${google.locationAddress}` : ""}.</> : null}
          </p>
          {status === "reconnect" ? (
            <div className="inset flex flex-col items-start gap-3" role="alert">
              <p className="body-6">Your Google sign-in has expired or was removed, so nothing can be loaded from Google. Reconnect with the same Google account to continue. Your drafts are kept.</p>
              <a href={startHref} className="btn btn-primary btn-sm">Reconnect Google</a>
            </div>
          ) : null}
          {status === "not_enabled" ? (
            <p className="body-6 text-muted">Your Google account is connected. Live reviews, replies, posts and insights will be switched on for this app soon. Until then the Reviews page shows labelled samples and nothing is published.</p>
          ) : null}
          {google.locationPlaceId && b.placeId && google.locationPlaceId !== b.placeId ? (
            <p className="caption-1 text-warn" data-testid="listing-mismatch">This Business Profile location is a different Google listing from the one in Settings. The profile audit, competitors and rank grid use the Settings listing.</p>
          ) : null}
          {google.locationName && google.locationPlaceId && google.locationPlaceId === b.placeId ? (
            <p className="caption-2 text-ok">This location is the same Google listing as in Settings.</p>
          ) : null}
          {locError ? <p role="alert" className="field-error">{locError}</p> : null}
          {changingOrChoosing && !locError && !locations.length ? (
            <p className="body-6 text-muted">No business locations were found on this Google account. Sign in with the account that owns or manages your Business Profile.</p>
          ) : null}
          {locations.length ? (
            <LocationForm current={google.locationName} next={page === "settings" ? "settings" : undefined}
              options={locations.map((l) => ({ location: l.location, title: l.title, address: l.address, matchesListing: Boolean(b.placeId && l.placeId === b.placeId) }))} />
          ) : null}
          {truncated ? <p className="hint">Only the first 1000 locations of each account are listed.</p> : null}
          <div className="flex flex-wrap gap-2">
            {status === "connected" && !changing ? <a href={changeHref} className="btn btn-secondary btn-sm">Change location</a> : null}
            <form action={disconnectGoogleAction}>{page === "settings" ? <input type="hidden" name="back" value="settings" /> : null}<button className="btn btn-secondary btn-sm" type="submit">Disconnect and delete stored tokens</button></form>
          </div>
          {google.lastError && status !== "reconnect" ? (
            <p role="alert" className="caption-1 text-bad" data-testid="gbp-last-error">Last problem ({AREA[google.lastError.area]}, {fmtDateTime(google.lastError.at)}): {google.lastError.message}</p>
          ) : null}
          {google.lastSync && Object.keys(google.lastSync).length ? (
            <p className="caption-2 text-muted" data-testid="gbp-last-sync">
              Last successful sync with Google: {(Object.entries(google.lastSync) as [keyof typeof AREA, string][]).map(([k, at]) => `${AREA[k]} ${fmtDateTime(at)}`).join(" · ")}
            </p>
          ) : null}
        </div>
      )}
      <Source>Google sign in, shown only for connection status</Source>
    </section>
  );
}
