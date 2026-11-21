import Link from "next/link";
import { Logo } from "@/components/Logo";
import { BRAND } from "@/lib/brand";

export default function NotFound() {
  return (
    <main id="main" className="mx-auto flex min-h-screen max-w-[680px] flex-col items-start justify-center gap-6 px-6">
      <Logo />
      <h1 className="heading-3">This page does not exist</h1>
      <p className="body-3 text-muted">The link may be old, or the address was typed wrong. Your account and data are not affected.</p>
      <div className="flex flex-wrap gap-3">
        <Link href="/" className="btn btn-primary">Go to the home page</Link>
        <Link href="/app" className="btn btn-secondary">Open your dashboard</Link>
      </div>
      <p className="caption-2 text-muted">Need help? Email <a className="underline" href={`mailto:${BRAND.email}`}>{BRAND.email}</a></p>
    </main>
  );
}
