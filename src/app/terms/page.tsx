import type { Metadata } from "next";
import Link from "next/link";
import { PublicPage, Sec, Bullets, Contents } from "@/components/PublicPage";
import { BRAND } from "@/lib/brand";
import { LEGAL } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Terms of service",
  description: `The terms for using ${BRAND.name}: accounts, Google authorisation, acceptable use, AI-generated content, availability, fees, termination and liability.`,
  alternates: { canonical: "/terms" },
};

const SECTIONS = [
  { id: "agreement", title: "Agreement" },
  { id: "service", title: "The service" },
  { id: "accounts", title: "Eligibility and accounts" },
  { id: "google", title: "Google account authorisation" },
  { id: "use", title: "Acceptable use" },
  { id: "ai", title: "AI-generated content" },
  { id: "third", title: "Google and other third-party services" },
  { id: "availability", title: "Availability and changes" },
  { id: "fees", title: "Fees" },
  { id: "content", title: "Your content and our property" },
  { id: "termination", title: "Suspension and termination" },
  { id: "data", title: "Data retention and deletion" },
  { id: "disclaimers", title: "Disclaimers" },
  { id: "liability", title: "Limitation of liability" },
  { id: "changes", title: "Changes to these terms" },
  ...(LEGAL.governingLaw ? [{ id: "law", title: "Governing law" }] : []),
  { id: "contact", title: "Contact" },
];

const mail = <a href={`mailto:${BRAND.email}`}>{BRAND.email}</a>;

export default function Terms() {
  return (
    <PublicPage current="/terms" title="Terms of service" lead={<p>These terms apply when you create a {BRAND.name} account or use the service. Please read them with the <Link href="/privacy" className="text-brand underline underline-offset-2">privacy policy</Link>.</p>}>
      <Contents items={SECTIONS} />

      <Sec id="agreement" title="1. Agreement">
        <p>By creating an account or using {BRAND.name}, you agree to these terms{LEGAL.operator ? <> with {LEGAL.operator}, which operates {BRAND.name}</> : null}. If you use {BRAND.name} for a business, you confirm that you may accept these terms for it, and &quot;you&quot; includes that business.</p>
      </Sec>

      <Sec id="service" title="2. The service">
        <p>{BRAND.name} helps you manage Google Business Profile locations you are authorised to manage. With your permission it reads your profile, reviews, posts and performance from Google; drafts review replies and posts with AI; publishes the replies and posts you approve (or, if you turn it on, safe automatic replies to positive reviews); schedules posts; tracks local search positions using Google Places results; estimates how AI assistants may describe your business; and produces reports.</p>
        <p>{BRAND.name} is independent and is not affiliated with, endorsed by or certified by Google, Anthropic or OpenAI.</p>
      </Sec>

      <Sec id="accounts" title="3. Eligibility and accounts">
        <Bullets items={[
          "The service is for businesses and the people who manage them. You must be old enough to enter a binding contract where you live.",
          "Give accurate information and keep your sign-in details secure. You are responsible for what happens in your account.",
          "Tell us at once if you think someone else has used your account.",
          "One person or business may hold several accounts only where each is used legitimately; do not create accounts to get around limits.",
        ]} />
      </Sec>

      <Sec id="google" title="4. Google account authorisation">
        <Bullets items={[
          "Connect only Google accounts and Business Profile locations you own or are authorised to manage.",
          `When you connect, you allow ${BRAND.name} to act for you through Google's Business Profile APIs, within the permission you grant: to read the location's data and to publish what you approve or have set to publish automatically.`,
          "Google's own terms and policies, including the Google Business Profile policies and the review and content policies, apply to everything published to your profile. You remain responsible for your profile.",
          <>You can withdraw the authorisation at any time by disconnecting in {BRAND.name} or in <a href="https://myaccount.google.com/connections" rel="noopener noreferrer" target="_blank">your Google account</a>. Publishing to Google stops at once; scheduled posts wait and are not published.</>,
        ]} />
      </Sec>

      <Sec id="use" title="5. Acceptable use">
        <p>Do not use {BRAND.name} to:</p>
        <Bullets items={[
          "post fake, paid, incentivised or self-written reviews, or ask only happy customers for reviews (review gating);",
          "publish content that is false, misleading, defamatory, hateful, discriminatory, sexually explicit or illegal, or that breaks Google's policies or the advertising rules of your profession;",
          "reveal private or health information about reviewers or customers in replies;",
          "impersonate a business or person, or manage a profile you are not authorised to manage;",
          "send spam, or use the contact form or emails for anything other than their purpose;",
          "probe, overload or attack the service, get around its limits or security, or access other customers' data;",
          "copy, resell or provide the service to others without our written permission.",
        ]} />
      </Sec>

      <Sec id="ai" title="6. AI-generated content">
        <Bullets items={[
          "Drafts, explanations, recommendations and visibility estimates are written by Anthropic's Claude. They can be inaccurate, incomplete or inappropriate.",
          "You must read and, where needed, correct every draft before you approve it. What you publish is your content and your responsibility.",
          "If you turn on automatic review replies, you agree that replies passing every safety check may be published without you reading them first. You can pause or turn this off at any time, and you remain responsible for those replies.",
          "The healthcare wording checks flag common risky phrases. They are a prompt to reread, not legal or medical advice.",
          "Visibility checks are estimates written by Claude about how AI assistants may describe a business. They are not answers from ChatGPT, Gemini or other assistants, and results differ between people and over time.",
        ]} />
      </Sec>

      <Sec id="third" title="7. Google and other third-party services">
        <p>{BRAND.name} depends on Google&apos;s APIs and other providers (listed in the <Link href="/privacy#sharing">privacy policy</Link>). They can change, limit, suspend or withdraw their services, quotas or permissions. When that happens, features may stop working or change, and we cannot guarantee that a reply or post will be accepted or shown by Google. We report Google&apos;s answer as we receive it and never show something as published unless Google accepted it.</p>
      </Sec>

      <Sec id="availability" title="8. Availability and changes">
        <p>We work to keep {BRAND.name} available and correct, but it is provided as available: there may be interruptions for maintenance, faults or reasons beyond our control. We may add, change or remove features. If we remove a feature you rely on, or stop the service, we will give reasonable notice where we can, so you can download your reports and delete your data first.</p>
      </Sec>

      <Sec id="fees" title="9. Fees">
        <p>{BRAND.name} is currently free to use, and we do not ask for or store payment details. If we introduce paid plans, we will show the prices and terms before they apply to you, and you will not be charged unless you choose a paid plan.</p>
      </Sec>

      <Sec id="content" title="10. Your content and our property">
        <p>You keep all rights in the content you add or approve and in your business data. You allow us to store, process and transmit it only to provide the service to you (including sending it to the providers in the privacy policy). We keep all rights in the {BRAND.name} software, design and brand; these terms do not transfer them to you. If you send us feedback, we may use it without obligation to you.</p>
      </Sec>

      <Sec id="termination" title="11. Suspension and termination">
        <Bullets items={[
          <>You may stop using {BRAND.name} and delete your account at any time in Settings (see <Link href="/data-deletion">data deletion</Link>).</>,
          "We may suspend or close an account that breaks these terms, puts the service, other customers or Google's platform at risk, or where the law requires it. Where reasonable we will tell you first and give you a chance to fix the problem.",
          "When an account is closed, its stored data is deleted as described in the privacy policy.",
        ]} />
      </Sec>

      <Sec id="data" title="12. Data retention and deletion">
        <p>How long we keep data, and how to delete it, is explained in the <Link href="/privacy#retention">privacy policy</Link> and on the <Link href="/data-deletion">data deletion</Link> page. Deleting your account in {BRAND.name} does not remove replies or posts already published on Google.</p>
      </Sec>

      <Sec id="disclaimers" title="13. Disclaimers">
        <p>{BRAND.name} helps you manage your profile; it does not promise rankings, reviews, visibility in AI assistants, leads, traffic or revenue. Rank grid positions and visibility checks are estimates. To the extent the law allows, the service is provided without warranties of any kind beyond those set out in these terms. Nothing in these terms limits rights you have under consumer protection or other laws that cannot be excluded.</p>
      </Sec>

      <Sec id="liability" title="14. Limitation of liability">
        <p>To the extent the law allows, we are not liable for indirect or consequential loss, or for loss of profit, revenue, business, goodwill or data, arising from your use of the service or from actions of Google or other third parties. Nothing in these terms limits liability that cannot be limited by law, such as liability for fraud or for death or personal injury caused by negligence.</p>
      </Sec>

      <Sec id="changes" title="15. Changes to these terms">
        <p>We may update these terms. We will post the new version here with its date and, for changes that materially affect you, tell you in the app or by email before they apply. If you do not agree with a change, you can delete your account before it takes effect.</p>
      </Sec>

      {LEGAL.governingLaw ? (
        <Sec id="law" title="16. Governing law">
          <p>These terms are governed by {LEGAL.governingLaw}, except where the law of the country you live in requires otherwise.</p>
        </Sec>
      ) : null}

      <Sec id="contact" title={`${LEGAL.governingLaw ? 17 : 16}. Contact`}>
        <p>Questions about these terms: {mail}{LEGAL.address ? <>, or by post to {LEGAL.operator ?? BRAND.name}, {LEGAL.address}</> : null}. You can also use the <Link href="/contact">contact page</Link>.</p>
      </Sec>
    </PublicPage>
  );
}
