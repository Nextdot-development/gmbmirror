import { CheckCircle } from "@phosphor-icons/react/dist/ssr";
import { Logo } from "./Logo";
import { BRAND } from "@/lib/brand";

const POINTS = [
  "Nothing posts to Google until you approve it",
  "Visibility checks work before Google is connected",
  "Disconnect any time and your tokens are deleted",
];

/** Layout only. The form passed in as children is unchanged. */
export function AuthShell({ title, intro, children }: { title: string; intro?: string; children: React.ReactNode }) {
  return (
    <main id="main" className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      <div className="hero-bg hidden border-r border-line flex-col justify-between p-12 lg:flex xl:p-16">
        <Logo />
        <div>
          <p className="heading-2 max-w-[520px] text-ink">See how Google and AI describe your business</p>
          <ul className="mt-8 flex flex-col gap-3 body-2 text-ink-soft">
            {POINTS.map((p) => (
              <li key={p} className="flex items-center gap-3"><CheckCircle size={20} weight="fill" className="shrink-0 text-brand" aria-hidden /> {p}</li>
            ))}
          </ul>
        </div>
        <p className="caption-2 text-muted">Built for doctors, clinics and local shops.</p>
      </div>
      <div className="flex flex-col justify-center px-6 py-12">
        <div className="mx-auto w-full max-w-[420px]">
          <div className="mb-10 lg:hidden"><Logo /></div>
          <h1 className="heading-4">{title}</h1>
          {intro ? <p className="body-6 mt-2 text-muted">{intro}</p> : null}
          <div className="card mt-6">{children}</div>
          <p className="caption-2 mt-6 text-muted">Need help? Email <a className="underline" href={`mailto:${BRAND.email}`}>{BRAND.email}</a></p>
        </div>
      </div>
    </main>
  );
}
