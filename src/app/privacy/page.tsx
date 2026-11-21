import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/Logo";
import { BRAND } from "@/lib/brand";

export const metadata: Metadata = { title: "Privacy policy" };

export default function Privacy() {
  return (
    <main id="main" className="mx-auto max-w-[680px] px-6 py-16">
      <Logo />
      <h1 className="heading-3 mt-8">Privacy policy</h1>
      <p className="caption-2 mt-2 text-muted">Last updated 17 November 2026</p>
      <div className="mt-8 flex flex-col gap-6 body-3 text-muted">
        <section>
          <h2 className="title-2 text-ink">What we collect</h2>
          <p className="mt-2">Your email address, the business details you enter (name, website, city, category), the results of checks you run, drafts you write or approve, and your checklist progress.</p>
        </section>
        <section>
          <h2 className="title-2 text-ink">Google user data</h2>
          <p className="mt-2">If you connect Google, we ask for one permission: managing your Business Profile. We use it only to show your locations and reviews, to post replies you approve, and to publish posts you approve. We never see your Google password. Your Google tokens are encrypted before they are stored, and they are deleted when you disconnect Google or use Delete my data in Settings.</p>
          <p className="mt-2">Our use and transfer of information received from Google APIs follows the Google API Services User Data Policy, including the Limited Use requirements. We do not sell this data, do not use it for advertising, and do not use it to train AI models. Review text is sent to an AI provider only to draft a reply you asked for.</p>
        </section>
        <section>
          <h2 className="title-2 text-ink">AI providers</h2>
          <p className="mt-2">To draft replies and posts and to run visibility checks, we send the minimum text needed to the AI providers you have enabled. Do not enter patient names or medical details into drafts.</p>
        </section>
        <section>
          <h2 className="title-2 text-ink">Your choices</h2>
          <p className="mt-2">You can disconnect Google, or delete your account data, from the Settings page at any time.</p>
        </section>
        <section>
          <h2 className="title-2 text-ink">Contact</h2>
          <p className="mt-2">Questions about your data or this policy: <a className="underline" href={`mailto:${BRAND.email}`}>{BRAND.email}</a></p>
        </section>
      </div>
      <p className="mt-12"><Link href="/" className="btn btn-secondary">Back to home</Link></p>
    </main>
  );
}
