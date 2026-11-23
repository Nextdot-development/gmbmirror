import type { Metadata } from "next";
import Link from "next/link";
import { PublicPage, Sec, Bullets, Table } from "@/components/PublicPage";
import { BRAND } from "@/lib/brand";

export const metadata: Metadata = {
  title: "Data deletion",
  description: `How to disconnect Google, delete your ${BRAND.name} business data or your whole account, what is deleted, and what remains.`,
  alternates: { canonical: "/data-deletion" },
};

const mail = <a href={`mailto:${BRAND.email}`}>{BRAND.email}</a>;

export default function DataDeletion() {
  return (
    <PublicPage current="/data-deletion" title="Data deletion" lead={<p>You can remove {BRAND.name}&apos;s access to Google and delete your data yourself, at any time. Deletion in the app happens immediately and cannot be undone.</p>}>
      <Sec id="options" title="Your three options">
        <Table label="Deletion options" head={["Option", "Where", "What happens"]} rows={[
          ["Disconnect Google", "Google profile page or Settings > Google connection > Disconnect", `${BRAND.name} asks Google to cancel its access and deletes the stored tokens, the chosen location, the copy of the profile and the performance data for that location. Your account and other data stay.`],
          ["Delete my business data", "Settings > Account", "Cancels Google access for every location and deletes all data in every location: details, drafts, replies and their history, posts, schedules, reports, logs, settings, email preferences, email log and tokens. Your sign-in account stays, so you can start again."],
          ["Delete my account", "Settings > Account", "Everything in the row above, plus the sign-in account itself, then signs you out everywhere. You confirm by typing your email address."],
        ]} />
        <p>You can also remove {BRAND.name} directly in <a href="https://myaccount.google.com/connections" rel="noopener noreferrer" target="_blank">your Google account&apos;s third-party connections</a>. {BRAND.name} then can no longer reach your profile; delete the stored data with one of the options above.</p>
      </Sec>
      <Sec id="confirmation" title="Confirmation">
        <p>After deleting your account you see a confirmation page that says whether Google confirmed cancelling access. When email is enabled, a confirmation is also sent to your account&apos;s address. If something could not be completed, the page says so and tells you what to do.</p>
      </Sec>
      <Sec id="remains" title="What is not deleted">
        <Bullets items={[
          <>Replies and posts you published remain on your Google Business Profile. Remove them on Google if you wish.</>,
          <>Copies in our providers&apos; backups and logs (Supabase, Vercel, Resend) are removed when those expire, as described in the <Link href="/privacy#retention">privacy policy</Link>.</>,
          <>Rate-limit records that may include your email or IP address are deleted within a day after their time window ends.</>,
          <>{BRAND.name} takes no payments, so there are no financial records that must be kept.</>,
        ]} />
      </Sec>
      <Sec id="request" title="Ask us to delete">
        <p>If you cannot sign in, email {mail} from the address of your account and ask for deletion. We confirm the request comes from the account owner, delete the account and its data, and reply to tell you it is done.</p>
      </Sec>
    </PublicPage>
  );
}
