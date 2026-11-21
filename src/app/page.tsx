import Link from "next/link";
import {
  ArrowRight, ChatCircleText, ListChecks, MagnifyingGlass, ShieldCheck, Sparkle, Stethoscope, CheckCircle, XCircle, Key, Storefront, Megaphone, WarningCircle,
} from "@phosphor-icons/react/dist/ssr";
import { LandingNav } from "@/components/LandingNav";
import { Reveal } from "@/components/Reveal";
import { TaglineReveal } from "@/components/TaglineReveal";
import { Footer } from "@/components/Footer";
import { HeroArt } from "@/components/HeroArt";

const FAQ = [
  {
    q: "Do I need to connect Google to start?",
    a: "No. You can create an account, run an AI visibility check and work through the profile checklist first. Reviews, replies and posts need a connected Google Business Profile.",
  },
  {
    q: "Will anything be posted to Google without me seeing it?",
    a: "No. Every reply and every post is a draft until you approve it. Nothing is sent to Google on its own.",
  },
  {
    q: "Does this connect to ChatGPT Business Hub?",
    a: "No. We have no connection to it and we do not pretend to. You get a plain guide, a checklist of what to prepare, and a place to note your progress.",
  },
  {
    q: "Can you guarantee that ChatGPT or Gemini will recommend my business?",
    a: "No one can. The check shows what the models said on the day you ran it, with the exact question asked. It is a snapshot, not a ranking.",
  },
  {
    q: "Is it safe for a medical practice?",
    a: "Reply drafts avoid diagnoses and patient details. Healthcare posts are scanned for guarantees, cure claims, superlatives and offers before you publish. You still decide, and the rules that apply to you come first.",
  },
  {
    q: "What does Google see when I connect?",
    a: "You sign in with your own Google account and approve one permission to manage your Business Profile. We never see your password. You can disconnect at any time, and your stored Google tokens are deleted.",
  },
  {
    q: "Why do my Google pages show sample data?",
    a: "Google reviews every app that uses the Business Profile API before it can read live data. Until that approval is in place, the Google pages show sample data, and every sample item is labelled.",
  },
  {
    q: "Do you filter or hide negative reviews?",
    a: "No. Google does not allow review gating, and we do not build it. The review link goes to the same page for everyone.",
  },
];

/** Facts about the product itself. No customer or performance numbers are claimed. */
const FACTS = [
  { n: "3", label: "AI models you can check", note: "Claude, plus ChatGPT and Gemini through their APIs" },
  { n: "2", label: "customer questions per model", note: "Shown word for word, with the date" },
  { n: "11", label: "point profile checklist", note: "Each item says why it matters" },
  { n: "0", label: "posts without your approval", note: "Every reply and post starts as a draft" },
];

const STEPS = [
  { n: "01", t: "Add your business", d: "Name, website, city and category. Pick clinic or general business so the wording fits you." },
  { n: "02", t: "Connect Google when you are ready", d: "Sign in with the Google account that manages your profile. Until then, work through the checklist and run visibility checks." },
  { n: "03", t: "Review, approve, repeat", d: "Check drafts, approve what you like, and rerun the visibility check to see what changed." },
];

const WONT = [
  "Scrape private dashboards or use anyone's session cookies",
  "Hide negative reviews or send unhappy customers elsewhere",
  "Write or buy fake reviews",
  "Promise rankings, leads or AI recommendations",
];

const SOLUTIONS = [
  {
    icon: Stethoscope,
    title: "Clinics and doctors",
    who: "Doctors, dentists, diagnostic centres, physiotherapists and counsellors",
    points: [
      "Reply drafts never mention diagnoses, treatments or patient details",
      "Posts are checked for guarantees, cure claims and best doctor wording",
      "A checklist item for doctor names and qualifications on your website",
    ],
  },
  {
    icon: Storefront,
    title: "Local businesses",
    who: "Salons, restaurants, gyms, hotels, shops and local services",
    points: [
      "Short, polite replies that refer to what the reviewer actually wrote",
      "Update, event and offer posts drafted from a few words",
      "A review link and QR code that goes to the same page for everyone",
    ],
  },
];

function Sample() {
  return <span className="badge absolute right-3 top-3">Sample</span>;
}

function Wrap({ children, id, className = "" }: { children: React.ReactNode; id?: string; className?: string }) {
  return <section id={id} className={`mx-auto w-full max-w-[1200px] scroll-mt-24 px-6 ${className}`}>{children}</section>;
}

export default function Home() {
  return (
    <>
      <LandingNav />
      <main id="main" className="overflow-x-clip">
        {/* Hero: white to pale blue, with the product facts along its base */}
        <section className="hero-bg relative">
          <div className="mx-auto w-full max-w-[1200px] px-6 pb-14 pt-32 md:pt-40">
            <div className="grid items-center gap-12 lg:grid-cols-[1fr_1.1fr] lg:gap-6">
              <div>
                <p className="inline-flex items-center gap-2 rounded-full border border-line bg-surface/80 px-3 py-1 caption-1 text-ink-soft shadow-[var(--shadow-card)]">
                  <span className="rounded-full bg-brand px-2 py-0.5 caption-3 text-white">New</span> AI visibility checks for local businesses
                </p>
                <h1 className="heading-1 mt-6 max-w-[620px] text-ink">
                  See how Google and AI describe your business
                </h1>
                <p className="body-3 mt-6 max-w-[540px] text-muted">
                  Connect your Google Business Profile, reply to reviews faster, and check whether ChatGPT and Gemini
                  name you when someone asks for a business like yours. Built for doctors, clinics and local shops.
                </p>
                <div className="mt-8 flex flex-wrap items-center gap-3">
                  <Link href="/signup" className="btn btn-primary button-md">
                    Create your account <ArrowRight size={16} weight="bold" aria-hidden />
                  </Link>
                  <a href="#how" className="btn btn-secondary button-md">See how it works</a>
                </div>
                <p className="caption-1 mt-6 flex items-start gap-2 text-muted">
                  <ShieldCheck size={18} weight="fill" className="mt-px shrink-0 text-brand" aria-hidden /> Uses Google&apos;s official Business Profile API. Nothing posts until you approve it.
                </p>
              </div>
              <HeroArt />
            </div>

            <dl className="mt-14 grid grid-cols-2 gap-x-6 gap-y-8 border-t border-line pt-8 lg:grid-cols-4">
              {FACTS.map((f) => (
                <div key={f.label}>
                  <dd className="heading-3 kpi">{f.n}</dd>
                  <dt className="title-3 mt-1 text-ink">{f.label}</dt>
                  <p className="caption-2 mt-1 text-muted">{f.note}</p>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* Problem to solution */}
        <Wrap className="py-20 md:py-28">
          <Reveal>
            <div className="grid gap-8 md:grid-cols-2 md:gap-16">
              <div>
                <p className="eyebrow">Why it matters</p>
                <h2 className="heading-3 mt-4 max-w-[560px]">People check Google, and now an AI assistant, before they call</h2>
              </div>
              <div className="flex flex-col gap-4 body-3 text-muted md:pt-9">
                <p>
                  Most owners have never seen what those answers say about them. Reviews sit unanswered for weeks, the
                  hours are wrong, and the website does not say which services you offer or where.
                </p>
                <p>
                  GMBmirror puts the three things that matter on one screen: how your Google profile looks, what
                  AI assistants say about you, and the next three things to fix.
                </p>
              </div>
            </div>
          </Reveal>
        </Wrap>

        {/* Features */}
        <div className="border-y border-line bg-surface-3/40">
          <Wrap id="features" className="py-20 md:py-28">
            <Reveal>
              <p className="eyebrow">Features</p>
              <h2 className="heading-3 mt-4 max-w-[640px]">What you get on day one</h2>
            </Reveal>

            <div className="mt-12 grid gap-6 md:grid-cols-2">
              <Reveal>
                <article id="reviews" className="card card-hover h-full scroll-mt-24">
                  <div className="relative rounded-2xl bg-surface-3/60 p-5 pt-10" aria-hidden>
                    <Sample />
                    <div className="rounded-xl border border-line bg-surface p-3">
                      <p className="caption-4 text-muted">Sunita D. <span className="ml-1 tracking-[2px] text-star">★★</span><span className="tracking-[2px] text-line">★★★</span></p>
                      <p className="caption-2 mt-1">I was called in 40 minutes after my slot.</p>
                    </div>
                    <div className="ml-6 mt-3 rounded-xl border border-accent/40 bg-accent-soft p-3">
                      <p className="caption-4 text-accent-strong">Draft reply</p>
                      <p className="caption-2 mt-1">Thank you for telling us, Sunita. We are sorry about the wait, and we would like to hear more.</p>
                      <p className="mt-2 flex gap-2"><span className="badge">Edit</span><span className="badge badge-accent">Approve</span></p>
                    </div>
                  </div>
                  <ChatCircleText size={28} weight="duotone" className="mt-6 text-accent" aria-hidden />
                  <h3 className="heading-6 mt-3">Reply to every review in about a minute</h3>
                  <p className="body-6 mt-2 text-muted">Claude drafts a reply that refers to what the reviewer actually wrote. You edit it, approve it, and only then does it go to Google.</p>
                </article>
              </Reveal>

              <Reveal delay={80}>
                <article id="visibility" className="card card-hover h-full scroll-mt-24">
                  <div className="relative rounded-2xl bg-surface-3/60 p-5 pt-10" aria-hidden>
                    <Sample />
                    <div className="rounded-xl border border-line bg-surface p-3">
                      <p className="caption-4 text-muted">Question asked</p>
                      <p className="caption-2 mt-1">Which are the best dentists in Bhubaneswar?</p>
                    </div>
                    <ul className="mt-3 flex flex-col gap-2">
                      <li className="flex items-center justify-between rounded-xl border border-line bg-surface px-3 py-2 caption-1">Claude <span className="badge badge-ok"><CheckCircle size={14} weight="fill" /> Named</span></li>
                      <li className="flex items-center justify-between rounded-xl border border-line bg-surface px-3 py-2 caption-1">ChatGPT <span className="badge badge-bad"><XCircle size={14} weight="fill" /> Not named</span></li>
                    </ul>
                    <p className="caption-5 mt-3 text-muted">Named instead: two other clinics</p>
                  </div>
                  <MagnifyingGlass size={28} weight="duotone" className="mt-6 text-accent" aria-hidden />
                  <h3 className="heading-6 mt-3">See where AI assistants skip you</h3>
                  <p className="body-6 mt-2 text-muted">Each check asks plain customer questions, shows the exact question and the answer, and is dated. You see which businesses were named instead.</p>
                </article>
              </Reveal>

              <Reveal>
                <article id="posts" className="card card-hover h-full scroll-mt-24">
                  <div className="relative rounded-2xl bg-surface-3/60 p-5 pt-10" aria-hidden>
                    <Sample />
                    <div className="rounded-xl border border-line bg-surface p-3">
                      <p className="caption-4 flex items-center gap-1.5 text-muted"><Megaphone size={14} /> Post draft</p>
                      <p className="caption-2 mt-1">Monsoon skin care: keep skin dry, change out of wet clothes, and see us for a <span className="rounded bg-warn-soft px-1 text-warn underline decoration-dotted">guaranteed cure</span>.</p>
                    </div>
                    <p className="caption-4 mt-3 flex items-start gap-1.5 text-warn"><WarningCircle size={16} weight="fill" className="shrink-0" /> Avoids guarantees. Results differ between patients.</p>
                  </div>
                  <Stethoscope size={28} weight="duotone" className="mt-6 text-accent" aria-hidden />
                  <h3 className="heading-6 mt-3">Posts that stay inside medical advertising rules</h3>
                  <p className="body-6 mt-2 text-muted">Drafts for clinics are scanned for guarantees, cure claims, best doctor claims and discounts before you publish.</p>
                </article>
              </Reveal>

              <Reveal delay={80}>
                <article id="checklist" className="card card-hover h-full scroll-mt-24">
                  <div className="relative rounded-2xl bg-surface-3/60 p-5 pt-10" aria-hidden>
                    <Sample />
                    <ul className="flex flex-col gap-2">
                      <li className="flex items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 caption-1"><CheckCircle size={18} weight="fill" className="text-accent" /> Opening hours are current</li>
                      <li className="flex items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 caption-1"><CheckCircle size={18} weight="fill" className="text-accent" /> Every service is listed</li>
                      <li className="flex items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 caption-1 text-muted"><span className="h-[18px] w-[18px] rounded-full border-2 border-line" /> At least 10 recent photos</li>
                    </ul>
                    <div className="meter mt-4"><span style={{ width: "66%" }} /></div>
                  </div>
                  <ListChecks size={28} weight="duotone" className="mt-6 text-accent" aria-hidden />
                  <h3 className="heading-6 mt-3">A profile checklist that explains itself</h3>
                  <p className="body-6 mt-2 text-muted">Categories, services, hours, photos, description length, phone and website. Each item says why it matters, so you fix the right thing first.</p>
                </article>
              </Reveal>
            </div>

            <Reveal>
              <p className="body-3 mt-10 max-w-[680px] text-muted">
                Also included: a review link and QR code that sends everyone to the same Google review page, and a step by step guide
                for ChatGPT Business Hub with a checklist of documents to prepare.
              </p>
            </Reveal>
          </Wrap>
        </div>

        {/* Dashboard preview */}
        <Wrap className="py-20 md:py-28">
          <Reveal>
            <div className="mx-auto max-w-[720px] text-center">
              <p className="eyebrow">Dashboard</p>
              <h2 className="heading-3 mt-4">One screen, three things to fix next</h2>
              <p className="body-3 mt-4 text-muted">Every number says where it came from, so you always know what is measured and what you entered yourself.</p>
            </div>
          </Reveal>
          <Reveal>
            <div className="mx-auto mt-12 max-w-[1000px] overflow-hidden rounded-[24px] border border-line bg-surface shadow-[var(--shadow-lift)]" role="img" aria-label="Preview of the dashboard with sample data">
              <div className="flex items-center gap-2 border-b border-line bg-surface-2 px-5 py-3">
                <span className="h-2.5 w-2.5 rounded-full bg-surface-3" /><span className="h-2.5 w-2.5 rounded-full bg-surface-3" /><span className="h-2.5 w-2.5 rounded-full bg-surface-3" />
                <span className="badge ml-auto">Sample data</span>
              </div>
              <div className="p-5 md:p-8">
                <p className="heading-5">Dr. Meera Sahu, Dermatology</p>
                <p className="caption-2 text-muted">Bhubaneswar</p>
                <div className="mt-6 grid gap-4 md:grid-cols-3">
                  <div className="inset">
                    <p className="caption-1 text-muted">Google connection</p>
                    <p className="mt-2"><span className="badge badge-ok">Connected</span></p>
                    <p className="caption-5 mt-3 text-muted">Source: Google API</p>
                  </div>
                  <div className="inset">
                    <p className="caption-1 text-muted">AI visibility, 14 Nov</p>
                    <div className="mt-2 flex items-center gap-3">
                      <svg width="44" height="44" viewBox="0 0 56 56" className="-rotate-90"><circle cx="28" cy="28" r="22" fill="none" stroke="var(--color-surface-3)" strokeWidth="6" /><circle cx="28" cy="28" r="22" fill="none" stroke="var(--color-accent)" strokeWidth="6" strokeLinecap="round" strokeDasharray="34.5 138.2" /></svg>
                      <p className="title-3">Named in 1 of 4 answers</p>
                    </div>
                    <p className="caption-5 mt-3 text-muted">Source: check run by this product</p>
                  </div>
                  <div className="inset">
                    <p className="caption-1 text-muted">Profile checklist</p>
                    <p className="title-3 mt-2">8 of 11 done</p>
                    <div className="meter mt-3"><span style={{ width: "73%" }} /></div>
                    <p className="caption-5 mt-3 text-muted">Source: entered by you</p>
                  </div>
                </div>
                <div className="inset mt-4">
                  <p className="caption-1 text-muted">Your next three actions</p>
                  <ol className="mt-3 flex flex-col gap-2 body-5">
                    {["Add your services list to your Google profile", "Put your phone number in plain text on your website", "Reply to the 2 star review from last week"].map((t, i) => (
                      <li key={t} className="flex items-center gap-3 rounded-xl border border-line bg-surface px-3 py-2.5">
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-pale caption-3 text-brand-strong">{i + 1}</span>{t}
                      </li>
                    ))}
                  </ol>
                </div>
              </div>
            </div>
          </Reveal>
        </Wrap>

        {/* Tagline reveal */}
        <Wrap className="py-16 md:py-24">
          <div aria-label="Our promise">
            <TaglineReveal text="The next person who needs you is already asking Google and an AI assistant who to trust. Make sure the answer is accurate, and that it is in your words." />
          </div>
        </Wrap>

        {/* How it works */}
        <Wrap id="how" className="py-20 md:py-28">
          <Reveal>
            <p className="eyebrow">How it works</p>
            <h2 className="heading-3 mt-4 max-w-[640px]">Three steps, at your own pace</h2>
          </Reveal>
          <ol className="mt-12 grid gap-6 md:grid-cols-3">
            {STEPS.map((s, i) => (
              <li key={s.n}>
                <Reveal delay={i * 80} className="h-full">
                  <div className="h-full border-t-2 border-ink pt-6">
                    <span className="heading-4 text-brand">{s.n}</span>
                    <h3 className="heading-6 mt-4">{s.t}</h3>
                    <p className="body-6 mt-2 text-muted">{s.d}</p>
                  </div>
                </Reveal>
              </li>
            ))}
          </ol>
        </Wrap>

        {/* Solutions: who it is for */}
        <div className="border-y border-line bg-surface-3/40">
          <Wrap id="solutions" className="py-20 md:py-28">
            <Reveal>
              <p className="eyebrow">Solutions</p>
              <h2 className="heading-3 mt-4 max-w-[640px]">Wording that fits the kind of business you run</h2>
            </Reveal>
            <div className="mt-12 grid gap-6 md:grid-cols-2">
              {SOLUTIONS.map((s, i) => (
                <Reveal key={s.title} delay={i * 80}>
                  <div className="card card-hover h-full md:p-8">
                    <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent-soft text-accent"><s.icon size={26} weight="duotone" aria-hidden /></span>
                    <h3 className="heading-5 mt-5">{s.title}</h3>
                    <p className="body-6 mt-1 text-muted">{s.who}</p>
                    <ul className="mt-5 flex flex-col gap-3">
                      {s.points.map((p) => (
                        <li key={p} className="flex items-start gap-3 body-6"><CheckCircle size={18} weight="fill" className="mt-0.5 shrink-0 text-accent" aria-hidden /> {p}</li>
                      ))}
                    </ul>
                  </div>
                </Reveal>
              ))}
            </div>
          </Wrap>
        </div>

        {/* Trust: what we do and do not do */}
        <Wrap className="py-20 md:py-28">
          <Reveal>
            <div className="grid gap-12 md:grid-cols-2 md:gap-16">
              <div>
                <p className="eyebrow">Trust</p>
                <h2 className="heading-3 mt-4 max-w-[560px]">Built so Google has nothing to object to</h2>
                <p className="body-3 mt-4 text-muted">
                  We use Google&apos;s official API with your permission, and we keep the permission narrow. You can disconnect at any
                  time and we delete the stored tokens.
                </p>
                <p className="mt-6 flex items-center gap-2 body-5"><Key size={18} className="text-accent" aria-hidden /> Tokens are encrypted before they are stored.</p>
              </div>
              <div className="card md:p-8">
                <p className="title-2">We will not</p>
                <ul className="mt-5 flex flex-col gap-4">
                  {WONT.map((w) => (
                    <li key={w} className="flex items-start gap-3 body-6 text-muted">
                      <XCircle size={18} weight="fill" className="mt-0.5 shrink-0 text-bad" aria-hidden /> {w}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </Reveal>
        </Wrap>

        {/* Pricing */}
        <Wrap id="pricing" className="pb-20 md:pb-28">
          <Reveal>
            <div className="card grid gap-8 md:grid-cols-[1fr_auto] md:items-center md:p-10">
              <div>
                <p className="eyebrow">Pricing</p>
                <h2 className="heading-4 mt-4">No card needed to start</h2>
                <p className="body-3 mt-3 max-w-[640px] text-muted">
                  Creating an account, adding your business and working through the checklist does not ask for payment details.
                  Plans will be listed here when they are available.
                </p>
              </div>
              <Link href="/signup" className="btn btn-secondary button-md">Create your account</Link>
            </div>
          </Reveal>
        </Wrap>

        {/* Resources: FAQ */}
        <Wrap id="resources" className="pb-20 md:pb-28">
          <div className="grid gap-10 md:grid-cols-[1fr_1.4fr] md:gap-16">
            <Reveal>
              <p className="eyebrow">Resources</p>
              <h2 id="faq" className="heading-3 mt-4 scroll-mt-24">Questions owners ask first</h2>
              <p className="body-3 mt-4 text-muted">Inside the product you also get a step by step ChatGPT Business Hub guide and a document checklist.</p>
            </Reveal>
            <div className="flex flex-col">
              {FAQ.map((f) => (
                <details key={f.q} className="group border-b border-line py-5 first:border-t">
                  <summary className="title-2 flex cursor-pointer list-none items-center justify-between gap-4 [&::-webkit-details-marker]:hidden">
                    {f.q}
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line bg-surface text-accent transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] group-open:rotate-45" aria-hidden>+</span>
                  </summary>
                  <p className="body-6 mt-3 max-w-[640px] text-muted">{f.a}</p>
                </details>
              ))}
            </div>
          </div>
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{
              __html: JSON.stringify({
                "@context": "https://schema.org",
                "@type": "FAQPage",
                mainEntity: FAQ.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
              }),
            }}
          />
        </Wrap>

        {/* Final CTA */}
        <Wrap className="pb-20 md:pb-28">
          <Reveal>
            <div className="hero-bg relative overflow-hidden rounded-[28px] border border-line px-6 py-14 md:px-16 md:py-20">
              <svg className="pointer-events-none absolute -right-16 -top-16 h-[360px] w-[360px] opacity-30" viewBox="0 0 360 360" aria-hidden>
                {[60, 110, 160].map((r) => <circle key={r} cx="180" cy="180" r={r} fill="none" stroke="var(--color-brand)" strokeDasharray="2 8" strokeLinecap="round" />)}
              </svg>
              <div className="relative flex flex-col items-start gap-6">
                <h2 className="heading-2 max-w-[720px] text-ink">Start with the checklist. Connect Google when you are ready.</h2>
                <ul className="flex flex-col gap-2 body-5 text-ink-soft">
                  <li className="flex items-center gap-2"><CheckCircle size={18} weight="fill" className="text-brand" aria-hidden /> Nothing posts to Google until you approve it</li>
                  <li className="flex items-center gap-2"><CheckCircle size={18} weight="fill" className="text-brand" aria-hidden /> Disconnect any time and your tokens are deleted</li>
                  <li className="flex items-center gap-2"><Sparkle size={18} weight="fill" className="text-brand" aria-hidden /> Visibility checks work before Google is connected</li>
                </ul>
                <Link href="/signup" className="btn btn-primary button-md">
                  Create your account <ArrowRight size={16} weight="bold" aria-hidden />
                </Link>
              </div>
            </div>
          </Reveal>
        </Wrap>
      </main>
      <Footer />
    </>
  );
}
