import type { CompetitorMetric, CompetitorMetricName } from "./types";

/**
 * Competitor gap analysis from one fresh Google Places search.
 * Every sentence counts real results. A measure is compared only where Google returned it for both sides;
 * otherwise the analysis says it could not be compared. Nothing is guessed.
 */

/** The fields of one place that can be compared. undefined means Google did not say. */
export type Comparable = {
  id: string;
  rating?: number;
  reviews?: number;
  photos?: number;
  website?: boolean;
  phone?: boolean;
  hours?: boolean;
};

export type MetricFinding = CompetitorMetric & {
  label: string;
  /** gap: most compared businesses are ahead; strength: the owner is ahead of most; even; unknown: not comparable. */
  kind: "gap" | "strength" | "even" | "unknown";
  sentence: string;
};

export type GapAnalysis = {
  compared: number;
  findings: MetricFinding[];
  gaps: string[];
  strengths: string[];
  notes: string[];
  actions: string[];
};

const NUMERIC: { metric: CompetitorMetricName; label: string; noun: string; get: (p: Comparable) => number | undefined; margin: number }[] = [
  { metric: "rating", label: "Rating", noun: "rating", get: (p) => p.rating, margin: 0.05 },
  { metric: "reviews", label: "Reviews", noun: "reviews", get: (p) => p.reviews, margin: 0 },
  { metric: "photos", label: "Photos", noun: "photos", get: (p) => p.photos, margin: 0 },
];

const PRESENCE: { metric: CompetitorMetricName; label: string; noun: string; get: (p: Comparable) => boolean | undefined }[] = [
  { metric: "website", label: "Website", noun: "a website", get: (p) => p.website },
  { metric: "phone", label: "Phone", noun: "a phone number", get: (p) => p.phone },
  { metric: "hours", label: "Opening hours", noun: "opening hours", get: (p) => p.hours },
];

export const ACTIONS: Record<CompetitorMetricName, string> = {
  rating: "Reply to every review, fix the problems people mention, and keep asking every customer for honest feedback.",
  reviews: "Share your review link or QR code with every customer after a visit. Do not filter by rating.",
  photos: "Add recent photos of the entrance, inside, team and services to your Google profile.",
  website: "Add your website to your Google Business Profile.",
  phone: "Add a phone number that someone answers to your Google Business Profile.",
  hours: "Add your regular opening hours to your Google Business Profile.",
};

const of = (n: number, known: number) => `${n} of the ${known} businesses compared`;

export function analyseCompetitors(you: Comparable, others: Comparable[]): GapAnalysis {
  const rest = others.filter((p) => p.id !== you.id);
  const findings: MetricFinding[] = [];

  for (const m of NUMERIC) {
    const mine = m.get(you);
    const known = rest.filter((p) => m.get(p) !== undefined);
    if (mine === undefined || !known.length) {
      findings.push({ metric: m.metric, label: m.label, known: 0, ahead: 0, behind: 0, kind: "unknown",
        sentence: mine === undefined ? `Google did not return your ${m.noun}, so ${m.noun} were not compared.` : `Google did not return ${m.noun} for the other businesses, so ${m.noun} were not compared.` });
      continue;
    }
    const ahead = known.filter((p) => m.get(p)! > mine + m.margin).length;
    const behind = known.filter((p) => m.get(p)! < mine - m.margin).length;
    const n = known.length;
    let kind: MetricFinding["kind"] = "even";
    let sentence = `On ${m.noun} you are level with most of the ${n} businesses compared.`;
    if (ahead * 2 > n) {
      kind = "gap";
      sentence = m.metric === "rating" ? `Your rating is lower than ${of(ahead, n)}.` : `You have fewer ${m.noun} than ${of(ahead, n)}.`;
    } else if (behind * 2 > n) {
      kind = "strength";
      sentence = m.metric === "rating" ? `Your rating is higher than ${of(behind, n)}.` : `You have more ${m.noun} than ${of(behind, n)}.`;
    }
    findings.push({ metric: m.metric, label: m.label, known: n, ahead, behind, kind, sentence });
  }

  for (const m of PRESENCE) {
    const mine = m.get(you);
    const known = rest.filter((p) => m.get(p) !== undefined);
    if (mine === undefined || !known.length) {
      findings.push({ metric: m.metric, label: m.label, known: 0, ahead: 0, behind: 0, kind: "unknown",
        sentence: `Google did not say whether ${mine === undefined ? "your profile" : "the other businesses"} show ${m.noun}, so this was not compared.` });
      continue;
    }
    const have = known.filter((p) => m.get(p)).length;
    const n = known.length;
    // "ahead" = businesses that show it when you do not; "behind" = businesses that lack it when you show it.
    const ahead = mine ? 0 : have;
    const behind = mine ? n - have : 0;
    let kind: MetricFinding["kind"] = "even";
    let sentence = `${of(have, n)} show ${m.noun} on Google${mine ? ", and so do you" : ", and you do not either"}.`;
    if (!mine && have > 0) {
      kind = have * 2 > n ? "gap" : "even";
      sentence = `${of(have, n)} show ${m.noun} on Google; yours does not.`;
    } else if (mine && have * 2 < n) {
      kind = "strength";
      sentence = `Only ${have} of the ${n} businesses compared show ${m.noun} on Google; yours does.`;
    }
    findings.push({ metric: m.metric, label: m.label, known: n, ahead, behind, youHave: mine, kind, sentence });
  }

  // Most important first: the share of compared businesses ahead of the owner.
  const gapFindings = findings.filter((f) => f.kind === "gap" || (f.kind === "even" && f.ahead > 0)).sort((a, b) => b.ahead / b.known - a.ahead / a.known);
  return {
    compared: rest.length,
    findings,
    gaps: findings.filter((f) => f.kind === "gap").sort((a, b) => b.ahead / b.known - a.ahead / a.known).map((f) => f.sentence),
    strengths: findings.filter((f) => f.kind === "strength").map((f) => f.sentence),
    notes: findings.filter((f) => f.kind === "unknown").map((f) => f.sentence),
    actions: gapFindings.slice(0, 3).map((f) => ACTIONS[f.metric]),
  };
}

/** The counts kept in history; no Google values. */
export const metricsForHistory = (a: GapAnalysis): CompetitorMetric[] =>
  a.findings.filter((f) => f.kind !== "unknown").map(({ metric, known, ahead, behind, youHave }) => ({ metric, known, ahead, behind, ...(youHave === undefined ? {} : { youHave }) }));
