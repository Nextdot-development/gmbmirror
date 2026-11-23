import type { Metadata } from "next";
import Link from "next/link";
import { PublicPage, Sec, Bullets } from "@/components/PublicPage";
import { BRAND } from "@/lib/brand";
import { LEGAL } from "@/lib/legal";

export const metadata: Metadata = {
  title: "About",
  description: `${BRAND.name} helps doctors and local businesses manage their Google Business Profile with AI drafts they approve.`,
  alternates: { canonical: "/about" },
};

export default function About() {
  return (
    <PublicPage current="/about" eyebrow="About" updated={false} title={`About ${BRAND.name}`} lead={<p>{BRAND.name} helps doctors, clinics and local businesses look after their Google Business Profile without spending hours on it, and without handing control to a machine.</p>}>
      <Sec id="what" title="What it does">
        <Bullets items={[
          "Shows your Google reviews and drafts thoughtful replies in English, Hindi or Hinglish for you to approve.",
          "Writes and schedules Google posts, and publishes them at the time you choose.",
          "Shows how your profile performs, how complete it is, and where you appear in local search around your business.",
          "Compares you with nearby businesses and turns the gaps into a short list of next steps.",
          "Produces a monthly report for each location.",
        ]} />
      </Sec>
      <Sec id="principles" title="How we build it">
        <Bullets items={[
          "You stay in control: nothing is published to Google without your approval, unless you turn on automatic replies for safe positive reviews yourself.",
          "One AI provider, Anthropic's Claude, used only for the drafts and explanations you ask for.",
          "Honest numbers: when Google does not report a figure we say so rather than show a zero, and estimates are labelled as estimates.",
          "Your Google data is used only to run the features you use, never for advertising, never sold.",
        ]} />
      </Sec>
      <Sec id="who" title="Who runs it">
        <p>{LEGAL.operator ? <>{BRAND.name} is operated by {LEGAL.operator}. </> : null}{BRAND.name} is independent and is not affiliated with, endorsed by or certified by Google. Google and Google Business Profile are trademarks of Google LLC.</p>
        <p>Questions or ideas: <a href={`mailto:${BRAND.email}`}>{BRAND.email}</a> or the <Link href="/contact">contact page</Link>.</p>
      </Sec>
    </PublicPage>
  );
}
