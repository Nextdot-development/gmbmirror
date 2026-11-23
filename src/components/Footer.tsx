import Link from "next/link";
import { BRAND } from "@/lib/brand";
import { Logo } from "./Logo";

const COLS = [
  {
    title: "Platform",
    links: [
      { href: "/#reviews", label: "Review replies" },
      { href: "/#visibility", label: "AI visibility checks" },
      { href: "/#posts", label: "Google posts" },
      { href: "/#checklist", label: "Profile checklist" },
    ],
  },
  {
    title: "Product",
    links: [
      { href: "/#how", label: "How it works" },
      { href: "/#solutions", label: "Solutions" },
      { href: "/#pricing", label: "Pricing" },
      { href: "/#resources", label: "Questions" },
    ],
  },
  {
    title: "Account",
    links: [
      { href: "/login", label: "Sign in" },
      { href: "/signup", label: "Create account" },
    ],
  },
  {
    title: "Trust",
    links: [
      { href: "/about", label: "About" },
      { href: "/privacy", label: "Privacy policy" },
      { href: "/terms", label: "Terms of service" },
      { href: "/cookies", label: "Cookie policy" },
      { href: "/data-deletion", label: "Data deletion" },
      { href: "/security", label: "Security" },
      { href: "/contact", label: "Contact us" },
    ],
  },
];

export function Footer() {
  const email = BRAND.email;
  return (
    <footer className="border-t border-line">
      <div className="mx-auto w-full max-w-[1200px] px-6 py-16">
        <div className="grid gap-12 sm:grid-cols-2 md:grid-cols-[1.4fr_1fr_1fr_1fr_1fr]">
          <div className="flex max-w-[360px] flex-col gap-4">
            <Logo />
            <p className="caption-2 text-muted">
              An independent tool. Not affiliated with or endorsed by Google or OpenAI. Google and Google Business Profile are trademarks of Google LLC.
            </p>
            <p className="caption-2 text-muted">
              Contact: <a href={`mailto:${email}`} className="caption-1 text-ink underline decoration-line underline-offset-4 hover:decoration-accent">{email}</a>
            </p>
          </div>
          {COLS.map((c) => (
            <nav key={c.title} aria-label={c.title}>
              <p className="title-4">{c.title}</p>
              <ul className="mt-4 flex flex-col gap-3 caption-2">
                {c.links.map((l) => (
                  <li key={l.href}><Link href={l.href} className="text-muted transition-colors duration-300 hover:text-ink">{l.label}</Link></li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
      </div>
    </footer>
  );
}
