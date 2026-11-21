import Link from "next/link";
import type { PostDraft } from "@/lib/types";

/**
 * A month view of posts: published ones on the day Google accepted them, approved scheduled ones on their time.
 * Dates are shown in India time (the app's audience); the exact time is on each post.
 */
export function ContentCalendar({ posts, month }: { posts: PostDraft[]; month?: string }) {
  const tz = "Asia/Kolkata";
  const today = new Date().toLocaleDateString("en-CA", { timeZone: tz }).slice(0, 7);
  const m = month && /^\d{4}-\d{2}$/.test(month) ? month : today;
  const [y, mo] = m.split("-").map(Number);
  const first = new Date(Date.UTC(y, mo - 1, 1));
  const days = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const lead = (first.getUTCDay() + 6) % 7; // Monday first
  const dayOf = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: tz });
  type Item = { day: string; p: PostDraft; kind: "published" | "scheduled" | "draft" };
  const items = posts.flatMap((p): Item[] => {
    if (p.status === "posted" && p.publishedAt) return [{ day: dayOf(p.publishedAt), p, kind: "published" }];
    if (p.scheduledAt && p.status !== "posted") return [{ day: dayOf(p.scheduledAt), p, kind: p.status === "approved" ? "scheduled" : "draft" }];
    return [];
  }).filter((i) => i.day.startsWith(m));
  const shift = (n: number) => new Date(Date.UTC(y, mo - 1 + n, 1)).toISOString().slice(0, 7);
  const label = first.toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
  return (
    <section className="card" aria-labelledby="cal-h" data-testid="content-calendar">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="cal-h" className="heading-6">Content calendar: {label}</h2>
        <nav className="flex gap-2" aria-label="Calendar month">
          <Link href={`/app/posts?month=${shift(-1)}`} className="btn btn-ghost btn-sm">Previous</Link>
          <Link href={`/app/posts?month=${shift(1)}`} className="btn btn-ghost btn-sm">Next</Link>
        </nav>
      </div>
      <div className="mt-4 grid grid-cols-7 gap-1 text-center" role="grid" aria-label={`Posts in ${label}`}>
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <div key={d} role="columnheader" className="caption-2 text-muted">{d}</div>)}
        {Array.from({ length: lead }, (_, i) => <div key={`e${i}`} />)}
        {Array.from({ length: days }, (_, i) => {
          const day = `${m}-${String(i + 1).padStart(2, "0")}`;
          const here = items.filter((x) => x.day === day);
          return (
            <div key={day} role="gridcell" className={`min-h-14 rounded-lg border border-line p-1 text-left ${here.length ? "bg-surface-2" : ""}`} aria-label={`${day}: ${here.length} post${here.length === 1 ? "" : "s"}`}>
              <span className="caption-2 text-muted">{i + 1}</span>
              {here.map((x) => (
                <span key={x.p.id} title={x.p.text.slice(0, 120)} className={`mt-0.5 block truncate rounded px-1 text-[10px] leading-4 ${x.kind === "published" ? "bg-ok-soft text-ok" : x.kind === "scheduled" ? "bg-accent-soft text-brand" : "bg-surface-3 text-muted"}`}>
                  {x.kind === "published" ? "Published" : x.kind === "scheduled" ? "Scheduled" : "Draft"}
                </span>
              ))}
            </div>
          );
        })}
      </div>
      <p className="caption-2 mt-3 text-muted">Published: accepted by Google. Scheduled: approved and queued. Draft: has a time but is not approved, so it will not be published.</p>
    </section>
  );
}
