import "server-only";
import { randomUUID } from "node:crypto";
import { db, type Scope } from "./store";
import { historyFor } from "./listing-history";
import { categoryQuery } from "./places";
import { checkScore } from "./visibility";
import { gridSize, leaderMovement, previousOf } from "./grid";
import { loadGrowth } from "./growth-server";
import { currentRecommendations } from "./growth";
import { writeReportSummary } from "./ai";
import type { AutomationLogEntry, MonthlyReport, ReportSection } from "./types";

/**
 * Monthly reports, built only from what this location stored during the month. Every section says when its data
 * is not available, instead of showing a made-up zero. Claude writes a short summary from these facts only.
 */

export const previousMonth = (d = new Date()) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
const inMonth = (iso: string | undefined, month: string) => Boolean(iso && iso.slice(0, 7) === month);
const missing = (title: string, reason: string): ReportSection => ({ title, available: false, reason, lines: [] });

/** Builds (or rebuilds) one location's report for a month and saves it in the report history. */
export async function buildMonthlyReport(scope: Scope, month: string, trigger: "schedule" | "owner"): Promise<{ report?: MonthlyReport; error?: string; summaryError?: string }> {
  if (!/^\d{4}-\d{2}$/.test(month)) return { error: "Not a month." };
  const b = await db.getBusiness(scope);
  if (!b) return { error: "This location has no business details yet." };
  const [allPlaces, replies, posts, checks, growthState, google, stats, autoLog] = await Promise.all([
    db.getPlaces(scope), db.getReplies(scope), db.getPosts(scope), db.getChecks(scope), db.getGrowth(scope), db.getGoogle(scope),
    db.getLocal<{ at: string; rating?: number; count?: number }[]>(scope, "review_stats", []), db.getLocal<AutomationLogEntry[]>(scope, "automation_log", []),
  ]);
  const places = historyFor(allPlaces, b.placeId, categoryQuery(b));
  const sections: ReportSection[] = [];

  // Profile score
  const audits = places.profileScores.filter((a) => inMonth(a.at, month)).sort((x, y) => x.at.localeCompare(y.at));
  const before = places.profileScores.filter((a) => a.at.slice(0, 7) < month).sort((x, y) => y.at.localeCompare(x.at))[0];
  if (audits.length) {
    const last = audits[audits.length - 1], first = before ?? audits[0];
    const change = last.score - first.score;
    sections.push({ title: "Profile score", available: true, lines: [`Latest profile audit: ${last.score}/100 (${audits.length} audit${audits.length === 1 ? "" : "s"} this month).`,
      first !== last ? `Change: ${change > 0 ? "+" : ""}${change} points since ${first.at.slice(0, 10)}.` : "First audit of the period; no earlier score to compare."] });
  } else sections.push(missing("Profile score", "No profile audit was run this month."));

  // Reviews
  const monthStats = stats.filter((s) => inMonth(s.at, month)).sort((x, y) => x.at.localeCompare(y.at));
  const prevStat = stats.filter((s) => s.at.slice(0, 7) < month).sort((x, y) => y.at.localeCompare(x.at))[0];
  const posted = Object.values(replies).filter((r) => inMonth(r.postedAt, month));
  const auto = posted.filter((r) => r.history?.some((h) => h.action === "auto_published" && inMonth(h.at, month))).length;
  const reviewLines: string[] = [];
  if (monthStats.length) {
    const end = monthStats[monthStats.length - 1], start = prevStat ?? monthStats[0];
    if (end.count !== undefined) reviewLines.push(`Google reviews: ${end.count}${start.count !== undefined && start !== end ? ` (${end.count - start.count >= 0 ? "+" : ""}${end.count - start.count} this month)` : ""}.`);
    if (end.rating !== undefined) reviewLines.push(`Google rating: ${end.rating.toFixed(1)}${start.rating !== undefined && start !== end ? ` (was ${start.rating.toFixed(1)})` : ""}.`);
  }
  reviewLines.push(`Replies published from this app: ${posted.length}${auto ? ` (${auto} automatically)` : ""}.`);
  const waiting = Object.values(replies).filter((r) => r.status === "approved").length;
  if (waiting) reviewLines.push(`Approved replies not yet published: ${waiting}.`);
  sections.push({ title: "Reviews and replies", available: true, lines: reviewLines,
    reason: monthStats.length ? undefined : "Review counts come from Google; none were read this month (Google not connected)." });

  // Posts
  const published = posts.filter((p) => inMonth(p.publishedAt, month));
  const scheduledNext = posts.filter((p) => p.status === "approved" && p.scheduledAt && p.scheduledAt.slice(0, 7) > month).length;
  const failedPosts = posts.filter((p) => p.publishError && p.status === "approved").length;
  sections.push({ title: "Posts", available: true, lines: [`Published to Google: ${published.length}.`, `Scheduled for later: ${scheduledNext}.`, ...(failedPosts ? [`Not published, needing attention: ${failedPosts}.`] : [])] });

  // Rankings
  const scans = places.scans.filter((s) => inMonth(s.at, month));
  if (scans.length) {
    // One line per series (phrase, spacing and grid size): only like-for-like scans are compared.
    const byKw = new Map<string, typeof scans>();
    for (const s of scans) {
      const k = `${s.keyword.trim().toLowerCase()}|${s.radiusKm}|${gridSize(s)}`;
      byKw.set(k, [...(byKw.get(k) ?? []), s]);
    }
    const avg = (r: (number | null)[]) => {
      const found = r.filter((x): x is number => x !== null);
      return found.length ? Math.round((found.reduce((n, x) => n + x, 0) / found.length) * 10) / 10 : null;
    };
    sections.push({ title: "Local rankings (estimate)", available: true, lines: [...byKw.values()].map((list) => {
      const sorted = [...list].sort((x, y) => x.at.localeCompare(y.at));
      const last = sorted[sorted.length - 1];
      const kw = `${last.keyword}" (${last.radiusKm} km, ${gridSize(last)} x ${gridSize(last)} grid)`;
      const a = avg(sorted[0].ranks), z = avg(sorted[sorted.length - 1].ranks);
      const found = sorted[sorted.length - 1].ranks.filter((x) => x !== null).length;
      return `"${kw}: found at ${found} of ${sorted[sorted.length - 1].ranks.length} points, average position ${z ?? "not found"}${sorted.length > 1 && a !== null && z !== null ? ` (was ${a})` : ""}.`;
    }).concat(scans.flatMap((s, i) => {
      // Competitor movement for the latest scan of each series this month, against the scan before it.
      if (scans.findIndex((x) => `${x.keyword.trim().toLowerCase()}|${x.radiusKm}|${gridSize(x)}` === `${s.keyword.trim().toLowerCase()}|${s.radiusKm}|${gridSize(s)}`) !== i) return [];
      const mv = leaderMovement(s, previousOf(places.scans, s));
      if (!mv) return [];
      const up = mv.moves.filter((m) => m.change === "up").length, down = mv.moves.filter((m) => m.change === "down").length, fresh = mv.moves.filter((m) => m.change === "new").length;
      return [`"${s.keyword}" competitors since the scan before: ${up} gained top-3 points, ${down} lost them, ${fresh} new among the leading ${mv.moves.length}.`];
    })), reason: "Positions are estimates from Google Places searches around your business, not Google Business Profile data." });
  } else sections.push(missing("Local rankings (estimate)", "No rank scan was run this month."));

  // Competitors
  const comp = (places.competitors ?? []).filter((c) => inMonth(c.at, month))[0];
  if (comp) {
    const behind = comp.metrics.filter((m) => m.known && m.ahead > m.known / 2).map((m) => m.metric);
    sections.push({ title: "Competitors", available: true, lines: [`Compared with ${comp.compared} nearby businesses for "${comp.query}".`,
      comp.position ? `Your position in that search: ${comp.position}.` : "You were not in the top results of that search.",
      behind.length ? `Most competitors are ahead on: ${behind.join(", ")}.` : "You are level with or ahead of most competitors on every measure compared."] });
  } else sections.push(missing("Competitors", "No competitor comparison was run this month."));

  // Review link sharing: only actions taken in this app are counted, never whether a review was written.
  const shares = (await db.getLocal<Record<string, Record<string, number>>>(scope, "share_events", {}))[month];
  if (shares && Object.values(shares).some((n) => n > 0)) {
    const n = (k: string) => shares[k] ?? 0;
    sections.push({ title: "Review requests", available: true, lines: [`WhatsApp messages opened: ${n("whatsapp_opened")}. QR codes downloaded: ${n("qr_downloaded")}. Review links copied: ${n("link_copied")}. Messages copied: ${n("message_copied")}.`],
      reason: "Counts of share actions in this app. Whether a customer then wrote a review is not known." });
  } else sections.push(missing("Review requests", "No review link was shared from this app this month."));

  // Google performance
  const ins = google?.insights;
  if (ins && google?.locationName) {
    const t = ins.current.totals, p = ins.previous.totals;
    const pct = (a: number, z: number) => (z ? `${Math.round(((a - z) / z) * 100)}%` : a ? "up from 0" : "no change");
    sections.push({ title: "Google performance", available: true, lines: [
      `Profile views: ${t.searchViews + t.mapsViews} (${pct(t.searchViews + t.mapsViews, p.searchViews + p.mapsViews)} vs the 28 days before).`,
      `Calls: ${t.calls}. Website clicks: ${t.website}. Direction requests: ${t.directions}.`],
      reason: `Google's figures for ${ins.current.start} to ${ins.current.end}, the latest 28 days available when this report was made.` });
  } else sections.push(missing("Google performance", "Needs a connected Google Business Profile."));

  // AI visibility
  const monthChecks = checks.filter((c) => inMonth(c.checkedAt, month));
  if (monthChecks.length) {
    sections.push({ title: "AI visibility (estimate)", available: true, lines: [`Latest score: ${checkScore(monthChecks[0])}/100 from ${monthChecks.length} check${monthChecks.length === 1 ? "" : "s"}.`],
      reason: "What AI assistants answered to sample questions; an estimate, not a Google ranking." });
  } else sections.push(missing("AI visibility (estimate)", "No AI visibility check was run this month."));

  // Recommendations
  const { view, growth } = await loadGrowth(scope, b);
  const done = growthState.completed.filter((c) => inMonth(c.at, month));
  const pending = currentRecommendations(view, growth).recs.filter((r) => !growthState.completed.some((c) => c.id === r.id)).slice(0, 3);
  sections.push({ title: "Improvements", available: true, lines: [`Completed this month: ${done.length ? done.map((d) => d.title).join("; ") : "none"}.`] });
  sections.push({ title: "Next month's plan", available: pending.length > 0, reason: pending.length ? undefined : "No open recommendations.", lines: pending.map((r) => `${r.priority}: ${r.title}`) });

  const automation = autoLog.filter((e) => inMonth(e.at, month));
  if (automation.length) sections.push({ title: "Automation", available: true, lines: [`${automation.length} automatic actions logged (${automation.filter((e) => e.result === "done").length} done, ${automation.filter((e) => e.result === "held").length} held for approval, ${automation.filter((e) => e.result === "failed").length} failed).`] });

  const now = new Date();
  const report: MonthlyReport = { id: randomUUID(), month, generatedAt: now.toISOString(), trigger, partial: month >= now.toISOString().slice(0, 7), business: b.name, location: b.location, sections };
  let summaryError: string | undefined;
  try {
    report.summary = await writeReportSummary(b, month, sections);
  } catch (e) {
    summaryError = e instanceof Error ? e.message : "The summary could not be written.";
    report.summaryError = summaryError;
  }
  // One atomic step: a scheduled report and an owner's "create now" for the same month cannot both be kept.
  await db.updateLocal<MonthlyReport[]>(scope, "reports", [], (list) => [report, ...list.filter((r) => r.month !== month)].sort((x, y) => y.month.localeCompare(x.month)).slice(0, 24));
  return { report, summaryError };
}
