import { GooglePermissions } from "@/components/GooglePermissions";
import type { Metadata } from "next";
import Link from "next/link";
import { requireBusiness } from "@/lib/ctx";
import { db } from "@/lib/store";
import { env } from "@/lib/env";
import { currentProfile, fetchLocations, gbpStatus } from "@/lib/gbp";
import { profileGaps } from "@/lib/business-sync";
import { LocationForm } from "@/components/forms";
import { OnboardingSteps } from "@/components/OnboardingSteps";
import { BusinessFinder } from "@/components/BusinessFinder";
import { CONNECT_ERRORS } from "@/components/GoogleConnection";

export const metadata: Metadata = { title: "Connect Google" };

const START = "/api/google/start?from=onboarding";

/**
 * Onboarding step 2: connect the Google Business Profile (the existing OAuth flow), choose the location, and import
 * its details. A public-listing search is offered as a fallback; it reads public data only and is never presented
 * as a connection.
 */
export default async function ConnectGoogle({ searchParams }: { searchParams: Promise<{ error?: string; connected?: string }> }) {
  const sp = await searchParams;
  const { user, scope } = await requireBusiness();
  let google = await db.getGoogle(scope);
  const status = gbpStatus(google);
  const { locations, error: locError } = status === "choose_location" ? await fetchLocations(scope) : { locations: [], error: undefined };
  const sync = status === "connected" ? await currentProfile(scope) : { error: undefined };
  google = await db.getGoogle(scope);
  const b = (await db.getBusiness(scope))!;
  const now = gbpStatus(google);
  const snap = google?.profile && google.profile.location === google.locationName ? google.profile : undefined;
  const linked = now === "connected";

  return (
    <div className="mx-auto w-full max-w-[560px]">
      <header className="panel-glow p-6 sm:p-8">
        <OnboardingSteps current={2} />
        <h1 className="heading-4 mt-6">Connect your Google Business Profile</h1>
        <p className="body-3 mt-2 text-muted">
          Sign in with the Google account that manages {b.name}. We bring in your details, reviews and posts, so you do not have to type them.
        </p>
      </header>

      {sp.error ? <p role="alert" className="field-error mt-6">{CONNECT_ERRORS[sp.error] ?? "Something went wrong."}</p> : null}

      <section className="mt-8 flex flex-col gap-4" aria-labelledby="gc-h" data-testid="onboarding-connect" data-status={now}>
        <h2 id="gc-h" className="sr-only">Google connection</h2>

        {now === "not_configured" ? (
          <div className="inset">
            <p className="title-4">Google connection needs setting up</p>
            <p className="body-6 mt-1 text-muted">
              Connecting Google Business Profile is not available on this app yet, so nothing is connected. You can start now and connect later from Settings.
            </p>
          </div>
        ) : null}

        {now === "not_connected" || now === "reconnect" ? (
          <div className="flex flex-col items-start gap-3">
            {now === "reconnect" ? <p role="alert" className="body-6 text-warn">Your Google sign-in has expired or was removed. Sign in again to continue.</p> : null}
            <GooglePermissions startHref={START} label={now === "reconnect" ? "Reconnect Google" : "Connect Google Business Profile"} />
          </div>
        ) : null}

        {now === "not_enabled" ? (
          <div className="inset">
            <p className="title-4">Google account connected</p>
            <p className="body-6 mt-1 text-muted">
              Signed in as {google?.email || "your Google account"}. Your business locations will appear once live Google Business Profile features are switched on for this app.
            </p>
          </div>
        ) : null}

        {now === "choose_location" ? (
          <div className="flex flex-col gap-3">
            <p className="body-5">Signed in as <strong>{google?.email || "your Google account"}</strong>. Which business is yours?</p>
            {locError ? <p role="alert" className="field-error">{locError}</p> : null}
            {!locError && !locations.length ? (
              <div className="inset">
                <p className="title-4">No business locations on this Google account</p>
                <p className="body-6 mt-1 text-muted">Sign in with the Google account that owns or manages your Business Profile, or skip for now.</p>
                <a href={START} className="btn btn-secondary btn-sm mt-3">Use a different Google account</a>
              </div>
            ) : null}
            {locations.length ? (
              <LocationForm next="dashboard" submitLabel="Use this location and continue" current={google?.locationName}
                options={locations.map((l) => ({ location: l.location, title: l.title, address: l.address, matchesListing: Boolean(b.placeId && l.placeId === b.placeId) }))} />
            ) : null}
            {locations.length ? <p className="caption-2 text-muted">Not listed? <a href={START} className="underline">Use a different Google account</a>, or skip and connect later.</p> : null}
          </div>
        ) : null}

        {linked ? (
          <div className="inset" data-testid="imported">
            <p className="title-4">Connected: {google?.locationTitle}</p>
            {sync.error ? <p role="alert" className="field-error">{sync.error}</p> : null}
            {snap ? (
              <ul className="body-6 mt-2 flex flex-col gap-1">
                {snap.address ? <li>Address: {snap.address}</li> : null}
                {snap.phone ? <li>Phone: {snap.phone}</li> : null}
                {snap.website ? <li>Website: {snap.website}</li> : null}
                {snap.category ? <li>Category on Google: {snap.category}</li> : null}
                <li>Opening hours: {snap.hours.length ? "listed" : "not listed"}</li>
              </ul>
            ) : null}
            {snap ? profileGaps(b, snap).map((g) => <p key={g.key} className="caption-2 mt-1 text-warn">{g.text}</p>) : null}
            <p className="caption-2 mt-2 text-muted">Brought in from Google. You can change any of it in Settings.</p>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          {linked || now === "not_configured" || now === "not_enabled" || b.placeId ? (
            <Link href="/app" className="btn btn-primary">Continue to your dashboard</Link>
          ) : (
            <Link href="/app" className="btn btn-ghost">Skip for now</Link>
          )}
          <Link href="/app/onboarding" className="btn btn-ghost btn-sm">Back</Link>
        </div>
      </section>

      {!linked ? (
        <details className="mt-10 border-t border-line pt-6" data-testid="public-listing">
          <summary className="body-5 cursor-pointer font-medium">Can&apos;t connect now? Find your public Google listing instead</summary>
          <p className="caption-2 mb-4 mt-2 text-muted">
            This only lets the app read your public listing (profile audit, competitor comparison, review link). It does not connect, verify or prove
            ownership of your Business Profile. You can connect Google later in Settings.
          </p>
          <section aria-labelledby="listing-h">
            <h2 id="listing-h" className="sr-only">Your public Google listing</h2>
            <BusinessFinder initialId={b.placeId} placesOn={env.placesConfigured()} defaultName={b.name} defaultCity={b.location} />
          </section>
        </details>
      ) : null}
    </div>
  );
}
