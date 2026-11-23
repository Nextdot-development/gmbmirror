import type { Metadata } from "next";
import Link from "next/link";
import { PublicPage, Sec, Table } from "@/components/PublicPage";
import { BRAND } from "@/lib/brand";

export const metadata: Metadata = {
  title: "Cookie policy",
  description: `${BRAND.name} uses only strictly necessary first-party cookies: sign-in, login protection and the Google connection step. No analytics or advertising cookies.`,
  alternates: { canonical: "/cookies" },
};

export default function Cookies() {
  return (
    <PublicPage current="/cookies" title="Cookie policy" lead={<p>{BRAND.name} uses a few strictly necessary cookies, all set by {BRAND.name} itself. There are no analytics, advertising, social media or other third-party cookies, and no tracking scripts.</p>}>
      <Sec id="list" title="Cookies we set">
        <Table label="Cookies" head={["Cookie", "Purpose", "Lasts"]} rows={[
          [<code key="c">sb-…-auth-token</code>, "Keeps you signed in (set by our sign-in provider, Supabase, on our own domain). Cannot be read by page scripts.", "Up to 30 days; removed when you log out."],
          [<code key="c">ge_device</code>, "Remembers that this browser has signed in to your account before, so a burst of wrong passwords from elsewhere cannot lock you out. Signed and unreadable by page scripts.", "180 days."],
          [<code key="c">g_state</code>, "Links Google's answer to the connection you started (protection against forged requests). Only sent to the Google connection pages.", "10 minutes."],
          [<code key="c">g_pkce</code>, "Holds a one-time code that proves the connection to Google was started by you, in this browser. Only sent to the Google connection pages.", "10 minutes."],
        ]} />
        <p className="caption-2 text-muted">The local demonstration version of the app uses a <code>ge_session</code> cookie (14 days) instead of the Supabase one.</p>
      </Sec>
      <Sec id="why" title="Why no consent banner">
        <p>These cookies are needed for the service you asked for (signing in, protecting your account and connecting Google), so they are set without a consent banner. We would ask first before ever adding a cookie that is not strictly necessary.</p>
      </Sec>
      <Sec id="control" title="Your control">
        <p>You can delete or block cookies in your browser settings. If you block them, you will not be able to sign in or connect Google. Logging out removes the sign-in cookie.</p>
        <p>More about the information we handle: <Link href="/privacy">privacy policy</Link>.</p>
      </Sec>
    </PublicPage>
  );
}
