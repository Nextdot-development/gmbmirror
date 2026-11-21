import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/Logo";
import { BRAND } from "@/lib/brand";

export const metadata: Metadata = { title: "Terms of service" };

export default function Terms() {
  return (
    <main id="main" className="mx-auto max-w-[680px] px-6 py-16">
      <Logo />
      <h1 className="heading-3 mt-8">Terms of service</h1>
      <p className="caption-2 mt-2 text-muted">Last updated 17 November 2026</p>
      <div className="mt-8 flex flex-col gap-6 body-3 text-muted">
        <section>
          <h2 className="title-2 text-ink">What the service is</h2>
          <p className="mt-2">{BRAND.name} helps you manage a Google Business Profile you are allowed to manage, and check how your business appears in AI assistants. It is independent and is not affiliated with or endorsed by Google or OpenAI.</p>
        </section>
        <section>
          <h2 className="title-2 text-ink">What we do not promise</h2>
          <p className="mt-2">We do not promise rankings, AI recommendations, leads, traffic or revenue. Visibility checks are dated snapshots and can differ from what other users see.</p>
        </section>
        <section>
          <h2 className="title-2 text-ink">Your responsibilities</h2>
          <p className="mt-2">You connect only profiles you are authorised to manage. You review every draft before approving it. You follow Google&apos;s policies, including its review policies, and the advertising rules that apply to your profession. Do not use the service to post fake reviews or to filter reviews by rating.</p>
        </section>
        <section>
          <h2 className="title-2 text-ink">Medical content</h2>
          <p className="mt-2">The healthcare checks flag common risky wording. They are a prompt to reread, not legal advice, and you remain responsible for what you publish.</p>
        </section>
        <section>
          <h2 className="title-2 text-ink">Ending your use</h2>
          <p className="mt-2">You can disconnect Google and delete your data from Settings at any time.</p>
        </section>
        <section>
          <h2 className="title-2 text-ink">Contact</h2>
          <p className="mt-2">Questions about these terms: <a className="underline" href={`mailto:${BRAND.email}`}>{BRAND.email}</a></p>
        </section>
      </div>
      <p className="mt-12"><Link href="/" className="btn btn-secondary">Back to home</Link></p>
    </main>
  );
}
