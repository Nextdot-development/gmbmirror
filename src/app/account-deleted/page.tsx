import type { Metadata } from "next";
import Link from "next/link";
import { BRAND } from "@/lib/brand";
import { emailConfigured } from "@/lib/email";
import { Logo } from "@/components/Logo";

export const metadata: Metadata = { title: "Account deleted", robots: { index: false } };
export const dynamic = "force-dynamic";

/** Shown after "Delete my account". Says only what the deletion reported (see deleteAccountAction). */
export default async function AccountDeleted({ searchParams }: { searchParams: Promise<{ google?: string }> }) {
  const { google } = await searchParams;
  return (
    <main id="main" className="mx-auto flex min-h-[70vh] max-w-[620px] flex-col justify-center px-6 py-16">
      <Logo />
      <h1 className="heading-3 mt-8">Your account was deleted</h1>
      <div className="body-3 mt-4 flex flex-col gap-3 text-muted" data-testid="account-deleted">
        <p>Your {BRAND.name} account, its sign-in and all its stored data were deleted, and you were signed out.</p>
        {google === "revoked" ? <p>Google confirmed that {BRAND.name}&apos;s access to your Google account was cancelled.</p> : null}
        {google === "partial" ? <p>We asked Google to cancel {BRAND.name}&apos;s access, but Google did not confirm it. Our copy of the tokens is deleted; to be sure, remove {BRAND.name} at <a className="text-brand underline underline-offset-2" href="https://myaccount.google.com/connections" rel="noopener noreferrer" target="_blank">your Google account&apos;s connections</a>.</p> : null}
        <p>Replies and posts you already published stay on your Google Business Profile.</p>
        {emailConfigured() ? <p>A confirmation email is being sent to your account&apos;s address.</p> : null}
        <p>Questions: <a className="text-brand underline underline-offset-2" href={`mailto:${BRAND.email}`}>{BRAND.email}</a></p>
      </div>
      <p className="mt-10"><Link href="/" className="btn btn-secondary">Back to home</Link></p>
    </main>
  );
}
