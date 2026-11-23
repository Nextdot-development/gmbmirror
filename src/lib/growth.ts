import { previousOf, sameSeries } from "./grid";
import { createHash } from "node:crypto";
import { z } from "zod";
import { categoryInfo } from "./business";
import { checklistDone, checklistRows, checklistVerified, type ChecklistRow } from "./checklist";
import { medicalWarnings } from "./medical";
import { checkScore, resultMatch } from "./visibility";
import type { Business, CompetitorSnapshot, Difficulty, GrowthState, PlacesHistory, Priority, Recommendation, VisibilityCheck } from "./types";

/**
 * Business Growth Intelligence: turns the data this app has measured into a health score, ranked issues with
 * evidence, and recent changes. Pure functions over stored data, so the same data always gives the same answer.
 *
 * Every number in a sentence comes from stored data: our own audit points, checklist verdicts, comparison counts,
 * grid ranks and visibility checks. Nothing is estimated, and missing measures are reported as missing.
 * Claude may reorder and rewrite the top issues (see mergeAiRecommendations) but never supplies the evidence.
 */

export type GrowthData = { business: Business; places: PlacesHistory; checks: VisibilityCheck[]; growth: GrowthState; now?: number };

export type MeasureKey = "profile" | "checklist" | "visibility" | "competitors" | "local";
export type Measure = { key: MeasureKey; label: string; value?: number; at?: string; detail: string; href: string };

export type Candidate = Recommendation & {
  severity: number;
  /** When the evidence was measured; a later "done" mark hides the issue until it is measured again. */
  measuredAt?: string;
  /** For owner-only checklist items, marking the action done also ticks the checklist. */
  checklistKey?: string;
  /** Set when the owner marked it done but a newer measurement still shows it. */
  reopened?: string;
};

export type Change = { text: string; direction: "up" | "down" | "done"; at: string };

export type GrowthView = {
  measures: Measure[];
  health: { score: number; measured: number; total: number } | null;
  candidates: Candidate[];
  rules: Recommendation[];
  changes: Change[];
  checklist: ChecklistRow[];
  competitor?: { snapshot: CompetitorSnapshot; lines: string[] };
  fingerprint: string;
  /** True when at least one real measurement exists, so Claude has something to analyse. */
  hasSignals: boolean;
};

const DAY = 86_400_000;
const fmt = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

const WEIGHTS: Record<MeasureKey, number> = { profile: 0.3, checklist: 0.15, visibility: 0.2, competitors: 0.2, local: 0.15 };

const PHOTO_TIER: Record<number, string> = { 15: "10 or more photos", 10: "5 to 9 photos", 5: "1 to 4 photos", 0: "no photos" };
const REVIEW_TIER: Record<number, string> = { 20: "100 or more reviews", 15: "50 to 99 reviews", 10: "20 to 49 reviews", 5: "5 to 19 reviews", 0: "fewer than 5 reviews" };
const RATING_TIER: Record<number, string> = { 15: "a rating of 4.5 or higher", 10: "a rating from 4.0 to 4.4", 5: "a rating from 3.5 to 3.9", 0: "a rating below 3.5, or no rating yet" };

const METRIC_NOUN: Record<string, string> = { rating: "rating", reviews: "reviews", photos: "photos", website: "a website", phone: "a phone number", hours: "opening hours" };

/** One sentence per compared measure, built from counts only. */
export function competitorLines(s: CompetitorSnapshot): string[] {
  const lines: string[] = [];
  lines.push(s.position ? `#${s.position} of ${s.compared + 1} Google results for “${s.query}”.` : `Not in the top ${s.compared} Google results for “${s.query}”.`);
  for (const m of s.metrics) {
    if (!m.known) continue;
    if (m.metric === "website" || m.metric === "phone" || m.metric === "hours") {
      if (m.youHave === false && m.ahead > 0) lines.push(`${m.ahead} of the ${m.known} businesses compared show ${METRIC_NOUN[m.metric]} on Google; yours does not.`);
      else if (m.youHave && m.behind * 2 > m.known) lines.push(`Only ${m.known - m.behind} of the ${m.known} businesses compared show ${METRIC_NOUN[m.metric]}; yours does.`);
    } else if (m.ahead * 2 > m.known) {
      lines.push(m.metric === "rating" ? `Your rating is lower than ${m.ahead} of the ${m.known} businesses compared.` : `You have fewer ${m.metric} than ${m.ahead} of the ${m.known} businesses compared.`);
    } else if (m.behind * 2 > m.known) {
      lines.push(m.metric === "rating" ? `Your rating is higher than ${m.behind} of the ${m.known} businesses compared.` : `You have more ${m.metric} than ${m.behind} of the ${m.known} businesses compared.`);
    }
  }
  return lines;
}

export function measures(d: GrowthData, rows: ChecklistRow[]): Measure[] {
  const audit = d.places.profileScores[0];
  const check = d.checks[0];
  const snap = d.places.competitors?.[0];
  const scan = d.places.scans[0];
  const done = checklistDone(rows);
  const out: Measure[] = [
    audit
      ? { key: "profile", label: "Google profile", value: audit.score, at: audit.at, detail: `Profile audit score ${audit.score} / 100`, href: "/app/google-profile" }
      : { key: "profile", label: "Google profile", detail: "Not measured yet: run the profile audit", href: "/app/google-profile" },
    { key: "checklist", label: "Profile checklist", value: rows.length ? Math.round((done / rows.length) * 100) : undefined, detail: `${done} of ${rows.length} done (${checklistVerified(rows)} checked on Google)`, href: "/app/google-profile#audit" },
    check
      ? { key: "visibility", label: "AI visibility", value: checkScore(check), at: check.checkedAt, detail: `Named in ${check.results.filter((r) => resultMatch(r) === "named").length} of ${check.results.length} AI answers`, href: "/app/ai-visibility" }
      : { key: "visibility", label: "AI visibility", detail: "Not measured yet: run an AI visibility check", href: "/app/ai-visibility" },
  ];
  const known = snap?.metrics.filter((m) => m.known > 0) ?? [];
  out.push(
    snap && known.length
      ? {
          key: "competitors",
          label: "Against competitors",
          // Average share of compared businesses that are not ahead of the owner, across the measures compared.
          value: Math.round((known.reduce((s, m) => s + (m.known - m.ahead) / m.known, 0) / known.length) * 100),
          at: snap.at,
          detail: `Level with or ahead of most on ${known.filter((m) => m.ahead * 2 <= m.known).length} of ${known.length} measures`,
          href: "/app/google-profile",
        }
      : { key: "competitors", label: "Against competitors", detail: "Not measured yet: run the competitor comparison", href: "/app/google-profile" },
  );
  if (scan) {
    const top3 = scan.ranks.filter((r) => r !== null && r <= 3).length;
    out.push({ key: "local", label: "Local search rank", value: Math.round((top3 / scan.ranks.length) * 100), at: scan.at, detail: `Top 3 at ${top3} of ${scan.ranks.length} points for “${scan.keyword}”`, href: "/app/google-profile" });
  } else {
    out.push({ key: "local", label: "Local search rank", detail: "Not measured yet: run a rank grid scan", href: "/app/google-profile" });
  }
  return out;
}

/** Weighted average of the measures that exist; null when nothing has been measured. */
export function health(ms: Measure[]): GrowthView["health"] {
  // The checklist alone is the owner's own ticks, so it does not make a health score by itself.
  const real = ms.filter((m) => m.value !== undefined && m.key !== "checklist");
  if (!real.length) return null;
  const used = ms.filter((m) => m.value !== undefined);
  const w = used.reduce((s, m) => s + WEIGHTS[m.key], 0);
  return { score: Math.round(used.reduce((s, m) => s + (m.value as number) * WEIGHTS[m.key], 0) / w), measured: real.length, total: ms.length - 1 };
}

function rec(c: Omit<Candidate, "evidence" | "steps"> & { evidence: (string | false | undefined)[]; steps: string[] }): Candidate {
  return { ...c, evidence: c.evidence.filter((e): e is string => Boolean(e)) };
}

export function candidates(d: GrowthData, rows: ChecklistRow[]): Candidate[] {
  const b = d.business;
  const now = d.now ?? Date.now();
  const who = b.type === "healthcare" ? "patients" : "customers";
  const audit = d.places.profileScores[0];
  const items = audit?.items;
  const snap = d.places.competitors?.[0];
  const metric = (m: string) => snap?.metrics.find((x) => x.metric === m && x.known > 0);
  const cmp = (m: string) => {
    const x = metric(m);
    if (!x || !snap) return undefined;
    if (x.youHave === false) return `Competitor comparison on ${fmt(snap.at)}: ${x.ahead} of the ${x.known} businesses compared show ${METRIC_NOUN[m]}; yours does not.`;
    if (x.ahead > 0 && x.youHave === undefined) return `Competitor comparison on ${fmt(snap.at)}: ${x.ahead} of the ${x.known} businesses compared ${m === "rating" ? "have a higher rating" : `have more ${m}`}.`;
    return undefined;
  };
  const auditEvidence = (what: string) => (audit ? `Profile audit on ${fmt(audit.at)}: Google shows ${what}.` : undefined);
  const out: Candidate[] = [];

  if (!b.placeId) {
    out.push(rec({ id: "place_id", title: "Link your Google listing", severity: 96, priority: "Critical", difficulty: "Easy", href: "/app/settings",
      why: "Without your Google Place ID this app cannot read your public Google profile, compare you with nearby businesses or check where you appear in local search.",
      evidence: ["No Google Place ID is saved for your business."],
      steps: ["Open Settings.", "Press Find on Google next to Google Place ID, or paste the ID if you have it.", "Pick your business from the matches and save."],
      benefit: "Unlocks the profile audit, competitor comparison and rank grid, which feed every other recommendation." }));
  } else if (!audit) {
    out.push(rec({ id: "run_audit", title: "Run your first Google profile audit", severity: 88, priority: "High", difficulty: "Easy", href: "/app/google-profile",
      why: "The audit reads your public Google listing and shows what is missing, which is the starting point for every profile fix.",
      evidence: ["Your Place ID is saved, but no profile audit has been run yet."],
      steps: ["Open Google profile.", "Press Run profile audit.", "Come back here to see recommendations based on the result."],
      benefit: "Turns guesses about your profile into a checked list." }));
  } else if (now - Date.parse(audit.at) > 30 * DAY) {
    out.push(rec({ id: "rerun_audit", title: "Run the profile audit again", severity: 50, priority: "Medium", difficulty: "Easy", href: "/app/google-profile", measuredAt: audit.at,
      why: "Your profile may have changed since the last check, and recommendations are only as fresh as the data behind them.",
      evidence: [`The last profile audit was on ${fmt(audit.at)}, ${Math.floor((now - Date.parse(audit.at)) / DAY)} days ago.`],
      steps: ["Open Google profile.", "Press Run again in the profile audit."], benefit: "Keeps the score, checklist and recommendations current." }));
  }

  if (items) {
    if ((items.status ?? 10) < 10)
      out.push(rec({ id: "business_status", title: "Make Google show your business as open", severity: 100, priority: "Critical", difficulty: "Medium", href: "/app/google-profile", measuredAt: audit.at,
        why: "If Google shows the business as closed or does not say it is open, many people will not contact you at all.",
        evidence: [auditEvidence("your business as not open, or no business status")],
        steps: ["Sign in to your Google Business Profile.", "Check the business status and set it to open.", "If it says permanently or temporarily closed by mistake, correct it and save.", "Run the profile audit again in a few days."],
        benefit: "People searching can see that you are open." }));
    if ((items.photos ?? 15) < 15)
      out.push(rec({ id: "photos", title: "Add more recent photos", severity: items.photos === 0 ? 82 : items.photos === 5 ? 76 : 58, priority: (items.photos ?? 0) <= 5 ? "High" : "Medium", difficulty: "Easy", href: "/app/google-profile", measuredAt: audit.at, contentKind: "photos",
        why: `Photos help ${who} decide before they call or visit, and a profile with few photos looks less active.`,
        evidence: [auditEvidence(PHOTO_TIER[items.photos ?? 0]), cmp("photos")],
        steps: ["Take clear photos of the entrance, reception or inside, your team and your main services.", "Use daylight and avoid people's faces unless they agree.", "Upload them to your Google Business Profile under Photos.", "Add a few new photos every month."],
        benefit: "A fuller, more trustworthy profile. It does not guarantee more calls or a higher position." }));
    if ((items.reviews ?? 20) < 20)
      out.push(rec({ id: "reviews_count", title: `Ask every ${who === "patients" ? "patient" : "customer"} for a review`, severity: (items.reviews ?? 0) <= 5 ? 84 : (items.reviews ?? 0) <= 10 ? 70 : 52, priority: (items.reviews ?? 0) <= 10 ? "High" : "Medium", difficulty: "Medium", href: "/app/google-profile", measuredAt: audit.at, contentKind: "review_request",
        why: `The number of recent reviews is one of the first things ${who} look at, and it is something you can grow steadily.`,
        evidence: [auditEvidence(REVIEW_TIER[items.reviews ?? 0]), cmp("reviews")],
        steps: [`Share your review link or QR code with every ${who === "patients" ? "patient" : "customer"} after a visit, not only happy ones.`, "Use the WhatsApp share on the Google profile page.", "Place the printed QR code at the front desk.", "Reply to every review you receive."],
        benefit: "More, and more recent, reviews over time. Never buy, filter or write reviews yourself." }));
    if ((items.rating ?? 15) < 15)
      out.push(rec({ id: "rating", title: "Improve your average rating", severity: (items.rating ?? 0) === 0 ? 72 : 55, priority: (items.rating ?? 0) <= 5 ? "High" : "Medium", difficulty: "Advanced", href: "/app/reviews", measuredAt: audit.at,
        why: "A lower rating makes people choose someone else, and the fastest way to improve it is fixing what reviewers complain about.",
        evidence: [auditEvidence(RATING_TIER[items.rating ?? 0]), cmp("rating")],
        steps: ["Read your recent low reviews and list the repeated complaints.", "Fix the most common problem first.", "Reply politely to every review; never argue or share private details.", "Keep asking every customer for honest feedback."],
        benefit: "A rating that reflects your real service. No one can promise a specific rating." }));
    const simple: [key: string, id: string, title: string, why: string, steps: string[], severity: number, kind?: Recommendation["contentKind"]][] = [
      ["hours", "hours", "Add your opening hours on Google", `Missing hours make ${who} unsure whether you are open, and wrong hours lead to wasted trips.`, ["Sign in to your Google Business Profile.", "Add your regular opening hours.", "Add holiday hours before every holiday."], 80],
      ["website", "website", "Add your website to Google", "A website link lets people check your services and helps Google and AI assistants confirm who you are.", ["Sign in to your Google Business Profile.", "Add your website address under Contact.", "Make sure the website shows the same name, address and phone as Google."], 74, "website_text"],
      ["phone", "phone", "Add a phone number to Google", "Many people call before they visit; without a number they may choose someone else.", ["Sign in to your Google Business Profile.", "Add a phone number that someone answers during opening hours."], 78],
      ["category", "category", "Set your primary category on Google", "Google uses the primary category to decide which searches show your business.", ["Sign in to your Google Business Profile.", "Choose the category that names your main service.", "Add secondary categories for other services."], 70],
    ];
    for (const [key, id, title, why, steps, severity, kind] of simple)
      if (items[key] === 0)
        out.push(rec({ id, title, why, steps, severity, priority: "High", difficulty: id === "website" ? "Medium" : "Easy", href: "/app/google-profile", measuredAt: audit.at, contentKind: kind,
          evidence: [auditEvidence(key === "category" ? "no primary category" : `no ${METRIC_NOUN[key]}`), cmp(key)], benefit: "A more complete profile that answers people's first questions." }));
    const phoneRow = rows.find((r) => r.key === "phone");
    if (phoneRow?.google?.verdict === "attention")
      out.push(rec({ id: "phone_match", title: "Make your phone number the same everywhere", severity: 66, priority: "High", difficulty: "Easy", href: "/app/settings", measuredAt: audit.at,
        why: "Different phone numbers on Google and elsewhere confuse people and make it harder for Google and AI assistants to trust your details.",
        evidence: [`Profile audit on ${fmt(audit.at)}: the phone number on Google is different from the one in your Settings.`],
        steps: ["Decide which number is correct.", "Update it on Google or in Settings so both match.", "Use the same number on your website."], benefit: "Consistent contact details." }));
    const catRow = rows.find((r) => r.key === "primary_category");
    if (catRow?.google?.verdict === "attention")
      out.push(rec({ id: "category_fit", title: "Check that your Google category fits your business", severity: 64, priority: "High", difficulty: "Medium", href: "/app/google-profile", measuredAt: audit.at,
        why: "If Google files you under a different category, you can be left out of the searches that matter most.",
        evidence: [`Profile audit on ${fmt(audit.at)}: Google's primary category does not fit the category you chose here (${categoryInfo(b.category, b.type).label}).`],
        steps: ["Look at the primary category in your Google Business Profile.", "If it is wrong, change it to the one that names your main service.", "If the category in this app is wrong, change it in Settings instead."], benefit: "You are compared and found under the right category." }));
  }

  if (snap) {
    if (snap.position === null)
      out.push(rec({ id: "competitor_rank", title: `Get into the top results for “${snap.query}”`, severity: 60, priority: "Medium", difficulty: "Advanced", href: "/app/google-profile", measuredAt: snap.at,
        why: "People rarely look past the first results, so not appearing there means fewer calls and visits.",
        evidence: [`Competitor comparison on ${fmt(snap.at)}: not in the top ${snap.compared} Google results for “${snap.query}”.`, ...competitorLines(snap).slice(1, 3)],
        steps: ["Work through the profile fixes listed here first.", "Keep collecting reviews from every customer.", "Make sure your website names your services and city in plain text.", "Compare again in a month."], benefit: "Over time, a profile that can compete with the businesses already shown." }));
  }

  const scan = d.places.scans[0];
  if (scan) {
    const top3 = scan.ranks.filter((r) => r !== null && r <= 3).length;
    const missing = scan.ranks.filter((r) => r === null).length;
    const share = top3 / scan.ranks.length;
    // Same thresholds as the original 3x3 grid (fewer than 5 of 9 points, or 2 or fewer), as shares of any grid size.
    if (share < 5 / 9) {
      const prev = previousOf(d.places.scans, scan);
      const prevTop3 = prev ? prev.ranks.filter((r) => r !== null && r <= 3).length : undefined;
      out.push(rec({ id: "local_rank", title: `Show up more often nearby for “${scan.keyword}”`, severity: share <= 2 / 9 ? 68 : 52, priority: share <= 2 / 9 ? "High" : "Medium", difficulty: "Advanced", href: "/app/google-profile", measuredAt: scan.at,
        why: "Searches from a little further away often show other businesses first, and those are customers you could be reaching.",
        evidence: [`Rank grid on ${fmt(scan.at)} for “${scan.keyword}” (${scan.radiusKm} km spacing): in the top 3 at ${top3} of ${scan.ranks.length} points${missing ? `, not in the top 20 at ${missing}` : ""}.`,
          prevTop3 !== undefined && prev ? `The previous scan for the same phrase (${fmt(prev.at)}) was in the top 3 at ${prevTop3} of ${prev.ranks.length} points.` : undefined],
        steps: ["Make sure your Google category and services match the phrase you scanned.", "Mention the areas you serve on your website.", "Keep collecting reviews.", "Scan the same phrase again in a few weeks to compare."], benefit: "Better coverage of nearby searches over time; positions change and cannot be promised." }));
    }
  }

  const check = d.checks[0];
  if (!check) {
    out.push(rec({ id: "run_visibility", title: "Run your first AI visibility check", severity: 55, priority: "Medium", difficulty: "Easy", href: "/app/ai-visibility",
      why: "More people now ask AI assistants for recommendations; this shows whether they name your business.",
      evidence: ["No AI visibility check has been run yet."], steps: ["Open AI visibility.", "Press Run a new check."], benefit: "A starting point you can track over time." }));
  } else {
    const score = checkScore(check);
    const named = check.results.filter((r) => resultMatch(r) === "named").length;
    if (score < 50)
      out.push(rec({ id: "ai_visibility", title: "Help AI assistants find and name you", severity: score <= 25 ? 74 : 56, priority: score <= 25 ? "High" : "Medium", difficulty: "Medium", href: "/app/ai-visibility", measuredAt: check.checkedAt, contentKind: "faq",
        why: "AI assistants mostly name businesses whose name, location and services are clearly written on the web.",
        evidence: [`AI visibility check on ${fmt(check.checkedAt)}: named in ${named} of ${check.results.length} answers (score ${score} / 100).`,
          d.checks[1] ? `The check before (${fmt(d.checks[1].checkedAt)}) scored ${checkScore(d.checks[1])} / 100.` : undefined],
        steps: ["Write your business name, city, area, services and phone in plain text on your website's home page.", "Add a short questions-and-answers section about your services.", "Keep your Google profile complete and consistent with your website.", "Run another check in a few weeks."],
        benefit: "Clearer information that AI assistants can use. No one controls what they say." }));
    const possible = check.results.filter((r) => resultMatch(r) === "possible");
    if (possible.length)
      out.push(rec({ id: "possible_match", title: "Add the name variant AI assistants use", severity: 46, priority: "Medium", difficulty: "Easy", href: "/app/settings", measuredAt: check.checkedAt,
        why: "AI answers mentioned a close variant of your name, which is not counted as you until you confirm it.",
        evidence: [`AI visibility check on ${fmt(check.checkedAt)}: ${possible.length} possible match${possible.length === 1 ? "" : "es"}${possible[0]?.possibleName ? `, for example “${possible[0].possibleName}”` : ""}.`],
        steps: ["Check the possible matches on the AI visibility page.", "If a variant is really you, add it under Other names in Settings.", "Run another check."], benefit: "A score that counts every way people name you." }));
  }

  if (b.placeId && audit && !snap)
    out.push(rec({ id: "run_competitors", title: "Compare yourself with nearby competitors", severity: 48, priority: "Medium", difficulty: "Easy", href: "/app/google-profile",
      why: "Knowing where the top businesses near you are ahead shows which fixes matter most.",
      evidence: ["No competitor comparison has been run yet."], steps: ["Open Google profile.", "Press Compare with competitors."], benefit: "Recommendations based on real nearby businesses." }));
  if (b.placeId && audit && !scan)
    out.push(rec({ id: "run_grid", title: "Check where you appear around your area", severity: 44, priority: "Medium", difficulty: "Easy", href: "/app/google-profile",
      why: "Your position changes with the searcher's location; a grid scan shows how far your visibility reaches.",
      evidence: ["No rank grid scan has been run yet."], steps: ["Open Google profile.", "Enter a phrase people search for, such as your main service.", "Press Run grid scan."], benefit: "A map of where you appear, to track over time." }));

  const owner: Record<string, { id: string; title: string; steps: string[]; severity: number; href?: string; kind?: Recommendation["contentKind"] }> = {
    description: { id: "description", title: "Write a clear business description", severity: 47, kind: "description", steps: ["Write 300 to 600 characters about who you are, your main services and the area you serve.", "Do not add links, offers or prices; Google does not allow them in the description.", "Paste it into your Google Business Profile and tick it in the checklist."] },
    services: { id: "services", title: "List every service on your profile", severity: 45, steps: ["Write down every service you offer.", "Add each one in the Services section of your Google Business Profile.", "Tick it in the checklist when done."] },
    secondary_categories: { id: "secondary_categories", title: "Add secondary categories", severity: 40, steps: ["Open your Google Business Profile categories.", "Add categories for your other main services.", "Keep the primary category for your main service."] },
    review_replies: { id: "review_replies", title: "Reply to every review", severity: 49, href: "/app/reviews", steps: ["Open Reviews.", "Draft a reply for each review and edit it to sound like you.", "Approve the replies; they will post once Google access is approved."] },
    booking_link: { id: "booking_link", title: "Add a booking or appointment link", severity: 41, steps: ["Choose how people should book (phone, WhatsApp or a booking page).", "Add the link in your Google Business Profile.", "Tick it in the checklist."] },
    doctor_profiles: { id: "doctor_profiles", title: "Put your doctors' names and qualifications on your website", severity: 46, kind: "website_text", steps: ["Add a team page listing each doctor's name, qualifications and specialities.", "Use the same names everywhere online.", "Tick it in the checklist."] },
  };
  for (const r of rows) {
    const o = owner[r.key];
    if (o && r.status === "unknown")
      out.push(rec({ id: o.id, title: o.title, severity: o.severity, priority: "Medium", difficulty: "Easy", href: o.href ?? "/app/google-profile#audit", checklistKey: r.key, contentKind: o.kind,
        why: r.why, evidence: [`Not confirmed in your profile checklist. Google does not report this, so only you can check it.`], steps: o.steps, benefit: "A more complete profile." }));
  }

  // Marked done: hidden until a newer measurement still shows the problem.
  const doneAt = new Map(d.growth.completed.map((c) => [c.id, c.at]));
  return out
    .flatMap((c) => {
      const at = doneAt.get(c.id);
      if (!at) return [c];
      if (!c.measuredAt || Date.parse(c.measuredAt) <= Date.parse(at)) return [];
      return [{ ...c, reopened: at, evidence: [...c.evidence, `You marked this done on ${fmt(at)}, but the newer check above still shows it.`] }];
    })
    .sort((a, b2) => b2.severity - a.severity);
}

export function recentChanges(d: GrowthData): Change[] {
  const out: Change[] = [];
  const [a1, a2] = d.places.profileScores;
  if (a1 && a2 && a1.score !== a2.score) out.push({ text: `Profile audit score ${a1.score > a2.score ? "rose" : "fell"} from ${a2.score} to ${a1.score} / 100`, direction: a1.score > a2.score ? "up" : "down", at: a1.at });
  const [c1, c2] = d.checks;
  if (c1 && c2) {
    const s1 = checkScore(c1), s2 = checkScore(c2);
    if (s1 !== s2) out.push({ text: `AI visibility score ${s1 > s2 ? "rose" : "fell"} from ${s2} to ${s1} / 100`, direction: s1 > s2 ? "up" : "down", at: c1.checkedAt });
  }
  const [g1, ...older] = d.places.scans;
  const g2 = g1 ? older.find((s) => sameSeries(s, g1)) : undefined;
  if (g1 && g2) {
    const t = (s: typeof g1) => s.ranks.filter((r) => r !== null && r <= 3).length;
    if (t(g1) !== t(g2)) out.push({ text: `Top 3 for “${g1.keyword}” at ${t(g1)} of ${g1.ranks.length} points, ${t(g1) > t(g2) ? "up" : "down"} from ${t(g2)}`, direction: t(g1) > t(g2) ? "up" : "down", at: g1.at });
  }
  const [s1, ...olderSnaps] = d.places.competitors ?? [];
  const s2 = s1 ? olderSnaps.find((s) => s.query === s1.query) : undefined;
  if (s1 && s2 && s1.position !== s2.position) {
    const better = (s1.position ?? 99) < (s2.position ?? 99);
    out.push({ text: `Position for “${s1.query}”: ${s1.position ? `#${s1.position}` : "not in the top results"}, was ${s2.position ? `#${s2.position}` : "not in the top results"}`, direction: better ? "up" : "down", at: s1.at });
  }
  const recent = (d.now ?? Date.now()) - 30 * DAY;
  for (const c of d.growth.completed) if (Date.parse(c.at) >= recent) out.push({ text: `Marked done: ${c.title}`, direction: "done", at: c.at });
  return out.sort((x, y) => Date.parse(y.at) - Date.parse(x.at)).slice(0, 6);
}

const strip = ({ severity: _s, measuredAt: _m, checklistKey: _c, reopened: _r, ...r }: Candidate): Recommendation => r;

export function buildGrowth(d: GrowthData): GrowthView {
  const rows = checklistRows(d.business, d.places.profileScores[0], d.now);
  const ms = measures(d, rows);
  const cands = candidates(d, rows);
  const snap = d.places.competitors?.[0];
  const hasSignals = Boolean(d.places.profileScores.length || d.checks.length || d.places.scans.length || snap);
  const fingerprint = createHash("sha256")
    .update(JSON.stringify({ c: cands.map((c) => [c.id, c.priority, c.evidence]), m: ms.map((m) => [m.key, m.value ?? null]), cat: d.business.category, type: d.business.type }))
    .digest("hex")
    .slice(0, 32);
  return {
    measures: ms,
    health: health(ms),
    candidates: cands,
    rules: cands.slice(0, 3).map(strip),
    changes: recentChanges(d),
    checklist: rows,
    competitor: snap ? { snapshot: snap, lines: competitorLines(snap) } : undefined,
    fingerprint,
    hasSignals,
  };
}

/** The recommendations to show: Claude's, if they were made from exactly this data, otherwise the rules. */
export function currentRecommendations(view: GrowthView, growth: GrowthState): { recs: Recommendation[]; source: "ai" | "rules"; stale: boolean } {
  const c = growth.cache;
  if (c && c.fingerprint === view.fingerprint && c.source === "ai") return { recs: c.recs, source: "ai", stale: false };
  return { recs: view.rules, source: "rules", stale: !c || c.fingerprint !== view.fingerprint };
}

/* ---------------- Claude's answer: validated before use ---------------- */

const aiSchema = z.object({
  recommendations: z
    .array(
      z.object({
        id: z.string(),
        title: z.string().min(3).max(90),
        why: z.string().min(10).max(420),
        steps: z.array(z.string().min(3).max(260)).min(2).max(6),
        benefit: z.string().min(5).max(260),
        difficulty: z.enum(["Easy", "Medium", "Advanced"]),
        priority: z.enum(["Critical", "High", "Medium"]),
      }),
    )
    .min(1)
    .max(3),
});

const PROMISE = /\bguarantee|\bguaranteed\b|\bwill rank\b|\brank (first|#?1)\b|\bnumber one\b|\b#1\b|\btop spot\b|\bdouble your\b/i;
/** A sentence that warns against something ("Avoid claims such as guaranteed results") is advice, not a promise. */
const NEGATION = /\b(avoid|avoiding|don'?t|do not|does not|doesn'?t|never|not|no|without|cannot|can'?t|won'?t|isn'?t|aren'?t|nor|instead of|rather than)\b/i;

const sentences = (parts: string[]) => parts.flatMap((p) => p.split(/(?<=[.!?])\s+|\n+/));

/**
 * True when advice promises results anywhere, or (healthcare) tells the owner to do or say something the medical
 * wording check flags. The medical check covers the title and steps, which describe what the owner will do or
 * publish; explanations such as "you are not among the top hospitals in this search" describe, they do not advertise.
 * Sentences that warn against something are allowed. Public replies and posts still get the full medical check.
 */
export function riskyAdvice(r: { title: string; why: string; benefit: string; steps: string[] }, healthcare: boolean): boolean {
  const promise = sentences([r.title, r.why, r.benefit, ...r.steps]).some((s) => PROMISE.test(s) && !NEGATION.test(s));
  const medical = healthcare && sentences([r.title, ...r.steps]).some((s) => medicalWarnings(s).length > 0 && !NEGATION.test(s));
  return promise || medical;
}

/** The JSON object inside a model reply, or null. */
export function parseJsonObject(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * Turns Claude's reply into recommendations, or null if it cannot be trusted.
 * Only ids from the candidate list are accepted; evidence and links always come from the candidate (our data).
 * An item that promises results, or trips the healthcare wording check, is replaced by the rules version.
 * Missing slots are filled from the rules, so the dashboard always has as many actions as there are candidates.
 */
export function mergeAiRecommendations(view: GrowthView, raw: unknown, healthcare: boolean): Recommendation[] | null {
  const parsed = aiSchema.safeParse(raw);
  if (!parsed.success) return null;
  const byId = new Map(view.candidates.map((c) => [c.id, c]));
  const out: Recommendation[] = [];
  for (const r of parsed.data.recommendations) {
    const c = byId.get(r.id);
    if (!c || out.some((o) => o.id === r.id)) continue;
    const unsafe = riskyAdvice(r, healthcare);
    out.push(unsafe ? strip(c) : { ...strip(c), title: r.title, why: r.why, steps: r.steps, benefit: r.benefit, difficulty: r.difficulty as Difficulty, priority: r.priority as Priority });
  }
  if (!out.length) return null;
  for (const c of view.candidates) {
    if (out.length >= Math.min(3, view.candidates.length)) break;
    if (!out.some((o) => o.id === c.id)) out.push(strip(c));
  }
  return out;
}
