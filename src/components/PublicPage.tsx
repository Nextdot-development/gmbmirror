import Link from "next/link";
import { LandingNav } from "./LandingNav";
import { Footer } from "./Footer";
import { TRUST_PAGES, LEGAL } from "@/lib/legal";

/** The layout of the public trust pages: the site navigation, a menu of the trust pages, the content, the footer. */
export function PublicPage({ current, eyebrow = "Trust", title, lead, updated = true, children }: {
  current: (typeof TRUST_PAGES)[number]["href"]; eyebrow?: string; title: string; lead?: React.ReactNode; updated?: boolean; children: React.ReactNode;
}) {
  return (
    <>
      <LandingNav />
      <main id="main" className="mx-auto w-full max-w-[1200px] px-6 pb-20 pt-28 md:pt-36">
        <div className="grid gap-10 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-16">
          <nav aria-label="Trust and legal pages" className="lg:sticky lg:top-28 lg:self-start">
            <ul className="flex flex-wrap gap-2 lg:flex-col lg:gap-1">
              {TRUST_PAGES.map((p) => (
                <li key={p.href}>
                  <Link href={p.href} aria-current={p.href === current ? "page" : undefined}
                    className={`caption-1 block rounded-lg px-3 py-2 transition-colors ${p.href === current ? "bg-brand-soft text-brand" : "text-muted hover:bg-surface-2 hover:text-ink"}`}>
                    {p.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <article className="min-w-0 max-w-[760px]">
            <p className="eyebrow">{eyebrow}</p>
            <h1 className="heading-3 mt-3">{title}</h1>
            {lead ? <div className="body-2 mt-4 text-muted">{lead}</div> : null}
            {updated ? <p className="caption-2 mt-3 text-muted">Last updated {LEGAL.updated}</p> : null}
            <div className="mt-10 flex flex-col gap-10">{children}</div>
          </article>
        </div>
      </main>
      <Footer />
    </>
  );
}

/** One numbered or plain section with an anchor. */
export function Sec({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="scroll-mt-28">
      <h2 id={`${id}-h`} className="heading-6">{title}</h2>
      <div className="body-3 mt-3 flex flex-col gap-3 text-muted [&_a]:text-brand [&_a]:underline [&_a]:underline-offset-2 [&_strong]:text-ink [&_code]:break-all">{children}</div>
    </section>
  );
}

export function Bullets({ items }: { items: React.ReactNode[] }) {
  return <ul className="ml-5 flex list-disc flex-col gap-2">{items.map((x, i) => <li key={i}>{x}</li>)}</ul>;
}

/** A simple responsive table: scrolls sideways inside itself on small screens, never the page. */
export function Table({ head, rows, label }: { head: string[]; rows: React.ReactNode[][]; label: string }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-line" role="region" aria-label={label} tabIndex={0}>
      <table className="w-full min-w-[560px] border-collapse text-left caption-1">
        <thead className="bg-surface-2 text-ink">
          <tr>{head.map((h) => <th key={h} scope="col" className="px-4 py-3 font-semibold">{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-line align-top">
              {r.map((c, j) => (j === 0 ? <th key={j} scope="row" className="px-4 py-3 font-medium text-ink">{c}</th> : <td key={j} className="px-4 py-3 text-muted">{c}</td>))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Contents list for long pages. */
export function Contents({ items }: { items: { id: string; title: string }[] }) {
  return (
    <nav aria-label="On this page" className="inset">
      <p className="title-4">On this page</p>
      <ol className="caption-1 mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-2">
        {items.map((s, i) => <li key={s.id}><a href={`#${s.id}`} className="text-muted underline-offset-2 hover:text-ink hover:underline">{i + 1}. {s.title}</a></li>)}
      </ol>
    </nav>
  );
}
