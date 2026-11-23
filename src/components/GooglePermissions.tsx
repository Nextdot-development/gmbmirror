import Link from "next/link";
import { BRAND } from "@/lib/brand";

/**
 * What connecting Google means, shown before the owner leaves for Google's consent screen. Lists only the scopes the
 * app actually requests (src/lib/google.ts SCOPES) and only the actions the code can perform (gbp-api.ts: create or
 * update a review reply, create or update a post). No Google logo: Google's marks are not used on this button.
 */
export function GooglePermissions({ startHref, label = "Connect Google Business Profile" }: { startHref: string; label?: string }) {
  return (
    <div className="flex flex-col gap-5" data-testid="google-permissions">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="inset">
          <h3 className="title-4">What {BRAND.name} reads</h3>
          <ul className="caption-1 mt-2 ml-4 flex list-disc flex-col gap-1 text-muted">
            <li>The business accounts and locations you manage, so you can choose one</li>
            <li>That location&apos;s profile: name, address, phone, website, category, description, hours, status</li>
            <li>Its reviews and your existing replies</li>
            <li>Its posts and performance figures (views, searches, calls, website clicks, directions)</li>
            <li>Your Google account&apos;s email address, to show which account is connected</li>
          </ul>
        </div>
        <div className="inset">
          <h3 className="title-4">What {BRAND.name} can do</h3>
          <ul className="caption-1 mt-2 ml-4 flex list-disc flex-col gap-1 text-muted">
            <li>Publish or update a review reply, when you approve it</li>
            <li>Publish or update a post, when you approve it (at the time you schedule)</li>
            <li>Automatic replies only if you turn them on, and only for safe positive reviews</li>
          </ul>
          <p className="caption-2 mt-3 text-muted">It never deletes reviews, posts or your profile, and never changes your business information on Google.</p>
        </div>
      </div>
      <div className="inset">
        <h3 className="title-4">Permissions Google will ask you to approve</h3>
        <ul className="caption-1 mt-2 flex flex-col gap-2 text-muted" data-testid="google-scopes">
          <li><strong className="text-ink">Manage your Business Profile</strong> <code className="caption-2 break-all">business.manage</code>: read the data above and publish what you approve.</li>
          <li><strong className="text-ink">Your email address and basic sign-in identity</strong> <code className="caption-2">email</code>, <code className="caption-2">openid</code>: show which Google account is connected.</li>
        </ul>
        <p className="caption-2 mt-3 text-muted">
          AI drafts: when you ask for a reply draft, the review text (phone numbers and emails removed), the reviewer&apos;s first name and the rating are sent to Anthropic&apos;s Claude. Google data is never sold, never used for advertising and never used to train AI models.
        </p>
      </div>
      <div className="flex flex-col items-start gap-3">
        <a href={startHref} className="btn btn-primary" aria-disabled="false" aria-describedby="google-consent-note">{label}</a>
        <p id="google-consent-note" className="caption-2 text-muted">
          You will continue on Google&apos;s own page; {BRAND.name} never sees your Google password. By connecting you agree to the{" "}
          <Link href="/terms" className="text-brand underline underline-offset-2">terms</Link> and{" "}
          <Link href="/privacy#google" className="text-brand underline underline-offset-2">privacy policy</Link>. Disconnect any time here or in{" "}
          <a href="https://myaccount.google.com/connections" rel="noopener noreferrer" target="_blank" className="text-brand underline underline-offset-2">your Google account</a>.
          {" "}{BRAND.name} is independent and not endorsed by Google.
        </p>
      </div>
    </div>
  );
}
