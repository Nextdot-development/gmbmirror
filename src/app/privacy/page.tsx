import type { Metadata } from "next";
import Link from "next/link";
import { PublicPage, Sec, Bullets, Table, Contents } from "@/components/PublicPage";
import { BRAND } from "@/lib/brand";
import { LEGAL } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Privacy policy",
  description: `What ${BRAND.name} collects, including Google Business Profile data, why, where it is stored, who processes it, how long it is kept and how to delete it.`,
  alternates: { canonical: "/privacy" },
};

const SECTIONS = [
  { id: "who", title: "Who we are" },
  { id: "collect", title: "What we collect" },
  { id: "google", title: "Google user data" },
  { id: "use", title: "How we use information" },
  { id: "ai", title: "AI processing (Anthropic Claude)" },
  { id: "sharing", title: "Service providers and sharing" },
  { id: "international", title: "Where data is processed" },
  { id: "retention", title: "How long we keep data" },
  { id: "security", title: "Security" },
  { id: "rights", title: "Your choices and rights" },
  { id: "children", title: "Children" },
  { id: "changes", title: "Changes to this policy" },
  { id: "contact", title: "Contact" },
];

const mail = <a href={`mailto:${BRAND.email}`}>{BRAND.email}</a>;

export default function Privacy() {
  return (
    <PublicPage current="/privacy" title="Privacy policy" lead={<p>This policy explains what {BRAND.name} collects, why, where it is stored, who processes it on our behalf, how long it is kept and how you can delete it. It describes how the service actually works today.</p>}>
      <Contents items={SECTIONS} />

      <Sec id="who" title="1. Who we are">
        <p>
          {BRAND.name} is an online service that helps businesses manage their Google Business Profile: read and answer reviews, write and publish posts, follow profile performance and track local search visibility, with AI-assisted drafts.
          {LEGAL.operator ? <> It is operated by {LEGAL.operator}{LEGAL.address ? `, ${LEGAL.address}` : ""}, which is responsible for your personal information.</> : <> The operator of {BRAND.name} is responsible for your personal information and can be reached at {mail}.</>}
        </p>
        <p>{BRAND.name} is independent. It is not affiliated with, endorsed by or certified by Google, Anthropic or OpenAI.</p>
      </Sec>

      <Sec id="collect" title="2. What we collect">
        <Table label="Information we collect" head={["Category", "What", "Source"]} rows={[
          ["Account", "Email address and password. Passwords are handled by our authentication provider (Supabase Auth), stored only in hashed form; we never see them. Whether your email address is confirmed.", "You, at sign-up"],
          ["Business details", "Business name, website, city, category, phone, services, other names, search phrases to track, language, review request message, automation settings.", "You (and, if you choose, filled in from your Google Business Profile)"],
          ["Google data", "Only if you connect Google. See section 3 for every category.", "Google, with your permission"],
          ["Your content", "Reply drafts and their history, posts (text, button, event or offer details, photo links, schedules), notes, checklist progress, reports, ChatGPT guide notes.", "You, or AI drafts you request"],
          ["Activity records", "Automation log (what automation did and why), background job history, monthly count of AI requests per feature, log of emails sent to you, review-request share counts (WhatsApp shares started, QR downloads, copies).", "Created by the service"],
          ["Public listing data", "Results from Google Maps Platform (Places API) for the business finder, the public listing audit, competitor comparisons and the local rank grid: names, ratings, review counts, categories and positions of businesses in search results.", "Google Places API"],
          ["Technical data", "Your IP address, used briefly for rate limits and to protect logins; request records kept by our hosting provider.", "Your browser"],
          ["Messages to us", "Name, email address and message when you use the contact form or email us.", "You"],
        ]} />
        <p>We use only strictly necessary cookies (sign-in, login protection and the Google connection step). There are no analytics, advertising or tracking cookies. See the <Link href="/cookies">cookie policy</Link>.</p>
      </Sec>

      <Sec id="google" title="3. Google user data">
        <p>
          When you connect a Google account, Google asks you to grant {BRAND.name} these permissions (the exact scopes requested):
        </p>
        <Bullets items={[
          <><strong>Manage your Business Profile</strong> (<code>https://www.googleapis.com/auth/business.manage</code>): to list the business accounts and locations you manage, read the location&apos;s profile, reviews, posts and performance, and publish the replies and posts you approve.</>,
          <><strong>Your Google account email address and basic sign-in identity</strong> (<code>email</code>, <code>openid</code>): to show which Google account is connected and to make sure the same Google account is used when you reconnect or add locations.</>,
        ]} />
        <Table label="Google data we access" head={["Data", "Why we need it", "Stored?"]} rows={[
          ["Google account email", "Show which account is connected; avoid mixing two Google accounts.", "Yes, while connected."],
          ["Access and refresh tokens", "Call the Business Profile APIs for you, including scheduled posts and review automation you turn on.", "Yes, encrypted (see section 9), while connected. Deleted on disconnect or deletion."],
          ["Business accounts and locations", "Let you choose which location to manage.", "Only the chosen location: its Google resource name, title, address and Place ID."],
          ["Business profile (name, address, phone, website, category, description, opening hours, open and verification status)", "Show your profile, fill in your business details, calculate your profile score, write posts and reports.", "Yes: the latest copy, refreshed from Google while connected."],
          ["Reviews (text, star rating, reviewer display name, date, existing reply)", "Show your reviews, draft replies, run the review automation you choose, count reviews and ratings over time.", "Review text is read from Google each time and not stored. We store your replies and their history (linked to Google's review ID) and review counts and average rating over time."],
          ["Posts", "Publish and update the posts you approve and show their status on Google.", "Your posts, with Google's post ID, state and link."],
          ["Performance metrics (views, searches, calls, website clicks, direction requests, bookings and similar)", "Show performance, compare periods, include them in reports, explain them on request.", "Yes: recent totals, daily views and up to six months of monthly totals."],
        ]} />
        <p><strong>How it is used.</strong> Google user data is used only to provide the features you use in {BRAND.name}. We publish to Google only when you approve a reply or post, when a post you approved and scheduled is due, or when you have turned on automatic review replies yourself (only for replies that pass every safety check).</p>
        <p><strong>Limited Use.</strong> {BRAND.name}&apos;s use and transfer to any other app of information received from Google APIs will adhere to the <a href="https://developers.google.com/terms/api-services-user-data-policy" rel="noopener noreferrer" target="_blank">Google API Services User Data Policy</a>, including the Limited Use requirements. In particular:</p>
        <Bullets items={[
          "We do not sell Google user data.",
          "We do not use or transfer Google user data for advertising, including retargeting, personalised or interest-based ads.",
          "We do not use Google user data to determine creditworthiness or for lending purposes.",
          "We do not use Google user data to develop, improve or train generalised or non-personalised AI or machine-learning models.",
          "We transfer Google user data only to the service providers in section 6, only as needed to provide or improve the features you use, for security, or to comply with the law.",
          "People do not read your Google user data unless you ask us to (for example in a support request), it is needed for security or to investigate abuse, it is required by law, or the data has been aggregated and anonymised for internal operations.",
        ]} />
        <p><strong>AI processing of Google data.</strong> To write a reply draft, the review text (with phone numbers and email addresses removed first), the reviewer&apos;s first name and the star rating are sent to Anthropic. When you ask for an explanation of your performance, the metric totals are sent. Section 5 lists everything that goes to Anthropic.</p>
        <p><strong>Disconnecting.</strong> Use <strong>Disconnect</strong> on the Google profile page or in Settings. {BRAND.name} asks Google to cancel its access and deletes the stored tokens, the chosen location, the profile copy and the performance data for that location. (If several of your locations use the same Google account, access is cancelled when the last of them disconnects.) You can also remove {BRAND.name} at any time from <a href="https://myaccount.google.com/connections" rel="noopener noreferrer" target="_blank">your Google account&apos;s connections</a>.</p>
        <p><strong>Deleting Google-derived data.</strong> Your reply history, review counts and profile score history, and business details you chose to fill in from Google, remain after disconnecting so your records stay complete. Delete them with <strong>Delete my business data</strong> or <strong>Delete my account</strong> in Settings, or ask us at {mail}. See <Link href="/data-deletion">data deletion</Link>. Replies and posts already published stay on Google; remove them on Google if you wish.</p>
      </Sec>

      <Sec id="use" title="4. How we use information">
        <Bullets items={[
          "To provide the service: your dashboard, reviews, replies, posts, schedules, reports, rank grid, visibility estimates and recommendations.",
          "To run what you scheduled or turned on, in the background (scheduled posts, review automation, profile refreshes, monthly reports).",
          "To send the emails described in section 6 (sign-up confirmation, password reset, security notices, and the notifications you choose).",
          "To keep the service secure: rate limits, login protection, preventing abuse.",
          "To answer your messages.",
        ]} />
        <p>We do not sell personal information, do not show advertising, and do not build advertising or cross-service profiles.</p>
      </Sec>

      <Sec id="ai" title="5. AI processing (Anthropic Claude)">
        <p>{BRAND.name} uses one AI provider: Anthropic&apos;s Claude, through Anthropic&apos;s commercial API. Requests are sent only when you ask for a draft or explanation, or when automation you turned on drafts a reply. What is sent:</p>
        <Table label="What is sent to Anthropic" head={["Feature", "Sent to Anthropic"]} rows={[
          ["Review reply drafts and rewrites", "Review text with phone numbers and emails removed, reviewer first name, star rating, your business name, category, city and services, your current draft, a few of your earlier published replies (for style)."],
          ["Post drafts", "Your topic, business details and services, the chosen button, the text of your last few posts."],
          ["Performance explanation", "Your performance totals and their change (no review text)."],
          ["Competitor explanation", "Counts and averages from the comparison (no competitor names)."],
          ["Monthly report summary", "The report's figures and statements."],
          ["Growth recommendations and action drafts", "Your business details and summary figures from your checks."],
          ["AI visibility estimates", "Your business name, category, city, other names and the questions being estimated."],
        ]} />
        <p>Anthropic processes this data to return the response, under its commercial terms, which state that customer API data is not used to train its models. AI output can be wrong: you review every draft before it is published (unless you turn on automatic replies, which are limited to safe positive reviews). Visibility checks are estimates written by Claude, not real answers from other AI assistants.</p>
      </Sec>

      <Sec id="sharing" title="6. Service providers and sharing">
        <p>We share personal information only with these providers, only so they can run the service for us, and with authorities when the law requires it.</p>
        <Table label="Service providers" head={["Provider", "What it does", "Data involved"]} rows={[
          ["Supabase", "Database and sign-in (accounts, sessions, sign-up and password emails).", "Everything stored by the service."],
          ["Vercel", "Hosting: runs the website and server code, scheduled background jobs.", "All data passes through its servers while being processed; request logs."],
          ["Anthropic", "Claude AI drafts and explanations (section 5).", "The text listed in section 5."],
          ["Google", "Google sign-in, Business Profile APIs, Places API.", "Your Google authorisation, what you publish, the searches the rank grid and finder make."],
          ["Resend", "Delivers app emails (security notices, reports, alerts, contact form), when email is enabled.", "Your email address and the email's content (a report email includes the report PDF)."],
        ]} />
        <p>If {BRAND.name} or its assets are ever transferred to another operator, your information would move only under this policy or with your consent where the law requires it, and you would be told first.</p>
      </Sec>

      <Sec id="international" title="7. Where data is processed">
        <p>The database is hosted by Supabase in Sydney, Australia. Server code runs on Vercel, currently in the United States, and Vercel&apos;s network delivers pages worldwide. Anthropic, Google and Resend process data in the United States and other countries where they operate. Your information may therefore be processed outside your country, under the protections these providers apply to their customers&apos; data.</p>
      </Sec>

      <Sec id="retention" title="8. How long we keep data">
        <Table label="Retention" head={["Data", "Kept"]} rows={[
          ["Account and business data, your content", "Until you delete it, delete your business data, or delete your account."],
          ["Google tokens, chosen location, profile copy, performance data", "While Google is connected. Deleted when you disconnect or delete your data or account."],
          ["Monthly reports", "The last 24 months per location."],
          ["Histories", "Reply history: last 20 changes per review. Automation log: last 200 entries. Job log: last 30 entries per job. Listing scans: last 30 per listing. Email log: last 50 emails."],
          ["Rate-limit records (may include your IP or email)", "Deleted within a day after their time window ends."],
          ["Backups and provider logs", "For the periods set by Supabase (backups) and Vercel and Resend (logs) for the plans we use; deleted data disappears from them when they expire."],
        ]} />
        <p>{BRAND.name} does not take payments, so it keeps no financial records.</p>
      </Sec>

      <Sec id="security" title="9. Security">
        <Bullets items={[
          "Connections are encrypted with HTTPS. The connection between our servers and the database uses TLS with a verified certificate.",
          "Google access and refresh tokens are encrypted by our application (AES-256-GCM) before they are stored, are decrypted only on our servers, and are never sent to your browser.",
          "The database uses row level security: browsers can never read tokens, jobs or other customers' data; all changes go through our server, which checks who you are on every request.",
          "Sign-in cookies are httpOnly and Secure. Logins, sign-ups, password resets, AI requests and Google requests are rate limited.",
          "Scheduled jobs can be started only by our scheduler, with a secret.",
        ]} />
        <p>No system is perfectly secure. If we learn of a breach affecting your information, we will tell you without undue delay. More on the <Link href="/security">security page</Link>.</p>
      </Sec>

      <Sec id="rights" title="10. Your choices and rights">
        <Bullets items={[
          <>See and correct your business details in Settings at any time.</>,
          <>Disconnect Google, or remove {BRAND.name} from your Google account, at any time (section 3).</>,
          <>Turn notification emails on or off in Settings. Security notices are always sent.</>,
          <>Delete your business data, or your whole account, yourself in Settings. See <Link href="/data-deletion">data deletion</Link>.</>,
          <>Ask for a copy of your data, a correction, a deletion, or ask a question about how it is used, at {mail}. We may ask you to write from your account&apos;s email address so we know the request is yours.</>,
        ]} />
        <p>Depending on where you live, you may have further rights under data protection law, including the right to complain to your data protection authority.</p>
      </Sec>

      <Sec id="children" title="11. Children">
        <p>{BRAND.name} is a tool for businesses. It is not directed at children, and we do not knowingly collect information from children.</p>
      </Sec>

      <Sec id="changes" title="12. Changes to this policy">
        <p>We will post any change here with a new date. If a change materially affects how we use your information, we will tell you in the app or by email before it applies.</p>
      </Sec>

      <Sec id="contact" title="13. Contact">
        <p>Privacy questions and requests: {mail}{LEGAL.address ? <>, or by post to {LEGAL.operator ?? BRAND.name}, {LEGAL.address}</> : null}. You can also use the <Link href="/contact">contact page</Link>.</p>
      </Sec>
    </PublicPage>
  );
}
