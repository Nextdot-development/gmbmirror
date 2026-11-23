import type { Metadata } from "next";
import { PublicPage, Sec } from "@/components/PublicPage";
import { ContactForm } from "@/components/forms";
import { BRAND } from "@/lib/brand";
import { LEGAL } from "@/lib/legal";
import { emailConfigured } from "@/lib/email";
import { getUser } from "@/lib/session";

export const metadata: Metadata = {
  title: "Contact",
  description: `Contact ${BRAND.name} support at ${BRAND.email}: questions, problems, privacy and data requests, security reports.`,
  alternates: { canonical: "/contact" },
};
// The form depends on the server's email setup and on who is signed in.
export const dynamic = "force-dynamic";

export default async function Contact() {
  const user = await getUser().catch(() => null);
  const formOn = emailConfigured();
  return (
    <PublicPage current="/contact" eyebrow="Support" updated={false} title="Contact us"
      lead={<p>Questions, problems, privacy or data requests: write to <a className="text-brand underline underline-offset-2" href={`mailto:${BRAND.email}`} data-testid="contact-email">{BRAND.email}</a>{formOn ? ", or use the form below." : "."}</p>}>
      <div className="card">
        {formOn ? <ContactForm email={user?.email} /> : (
          <p className="body-5" data-testid="contact-unavailable">The contact form is not available yet. Please email <a className="text-brand underline underline-offset-2" href={`mailto:${BRAND.email}`}>{BRAND.email}</a> and we will answer from there.</p>
        )}
      </div>
      <Sec id="topics" title="Good to know">
        <p>Data deletion: you can do it yourself in Settings (see the data deletion page). Security issues: use the subject &quot;Security&quot;. We answer by email{LEGAL.address ? <>; postal address for legal notices: {LEGAL.operator ?? BRAND.name}, {LEGAL.address}</> : null}.</p>
      </Sec>
    </PublicPage>
  );
}
