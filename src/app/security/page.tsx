import type { Metadata } from "next";
import Link from "next/link";
import { PublicPage, Sec, Bullets } from "@/components/PublicPage";
import { BRAND } from "@/lib/brand";

export const metadata: Metadata = {
  title: "Security",
  description: `How ${BRAND.name} protects accounts, Google tokens and business data, and how to report a security issue.`,
  alternates: { canonical: "/security" },
};

export default function Security() {
  return (
    <PublicPage current="/security" title="Security" lead={<p>How {BRAND.name} protects your account, your Google connection and your data. This describes what is built today; {BRAND.name} holds no security certifications.</p>}>
      <Sec id="google" title="Google connection">
        <Bullets items={[
          "Google sign-in uses OAuth 2.0 with PKCE and a one-time state value tied to your browser and your account, so a forged or replayed answer is refused.",
          "We request one Business Profile permission (business.manage) plus your email address. A connection without the Business Profile permission is cancelled, not kept.",
          "Access and refresh tokens are encrypted with AES-256-GCM by our application before they are stored, decrypted only on our servers, and never sent to your browser.",
          "Disconnecting or deleting your data asks Google to cancel the access and deletes the tokens.",
        ]} />
      </Sec>
      <Sec id="data" title="Data">
        <Bullets items={[
          "All traffic uses HTTPS. Our servers reach the database over TLS with a verified certificate.",
          "Row level security is on for every table: browsers can never read tokens, background jobs or another customer's data, and cannot write anything directly. Every change goes through our server, which checks your identity on each request.",
          "Every record belongs to one account and one location; this separation is covered by automated tests.",
        ]} />
      </Sec>
      <Sec id="accounts" title="Accounts">
        <Bullets items={[
          "Passwords are handled by our sign-in provider (Supabase Auth) and stored only in hashed form. Email addresses are confirmed before first use.",
          "Sign-in cookies are httpOnly, Secure and SameSite. Pages send strict security headers (content security policy, HSTS, no framing).",
          "Sign-ups, logins, password resets, AI requests, Google requests and emails are rate limited. Repeated wrong passwords slow down further attempts without locking you out of browsers you have used before.",
          "You get an email when your password changes or a Google account is connected or disconnected (when email is enabled).",
        ]} />
      </Sec>
      <Sec id="ops" title="Operations">
        <Bullets items={[
          "Secrets (database password, encryption key, API keys) are kept in the hosting provider's encrypted settings, never in code or in the browser.",
          "Scheduled background jobs can be started only by our scheduler, with a secret. Jobs are locked so two servers never run the same job twice.",
          "Logs never contain tokens, passwords, review text or email contents.",
        ]} />
      </Sec>
      <Sec id="report" title="Report a security issue">
        <p>Email <a href={`mailto:${BRAND.email}?subject=Security`}>{BRAND.email}</a> with the subject &quot;Security&quot;. Please give us a reasonable time to fix the issue before telling others, and do not access other people&apos;s data while testing. We do not currently run a paid bug bounty.</p>
        <p>See also the <Link href="/privacy">privacy policy</Link>.</p>
      </Sec>
    </PublicPage>
  );
}
