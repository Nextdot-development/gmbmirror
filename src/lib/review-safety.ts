import { medicalWarnings } from "./medical";
import type { AutomationSettings, Business, Review } from "./types";

/**
 * Safety rules for review replies. Deterministic (no AI), so they cannot be talked out of and are unit tested.
 * They decide what Claude sees, which replies need the owner, and what automation may publish.
 */

export type Sentiment = "positive" | "neutral" | "negative" | "rating_unknown";
export type ReviewClass = { sentiment: Sentiment; noText: boolean; sensitive: boolean; reasons: string[] };

// Health details people write in reviews (English, Hindi, Hinglish). Matched as words or word starts.
const HEALTH = [
  "diagnos", "treatment", "treated", "surgery", "operation", "medicine", "medication", "prescri", "injection", "tablet", "dose", "report",
  "test result", "scan", "x-ray", "mri", "blood", "pregnan", "delivery", "miscarriage", "cancer", "diabet", "infection", "fever", "pain",
  "allerg", "rash", "acne", "therapy", "depress", "anxiety", "my son", "my daughter", "my child", "my baby", "my mother", "my father", "my wife", "my husband",
  "dawai", "ilaj", "bimari", "operation", "dard", "इलाज", "दवा", "बीमारी", "ऑपरेशन", "दर्द", "रिपोर्ट", "डॉक्टर ने",
];
// Complaints that need a person, whatever the business.
const ESCALATE = ["refund", "legal", "lawyer", "police", "court", "fraud", "scam", "cheat", "harass", "abuse", "discriminat", "unsafe", "injur", "consumer forum", "complaint filed"];

/** The listed words that appear in the text: English as a word start ("diagnos" matches "diagnosed"), others anywhere. */
const has = (text: string, words: string[]) => {
  const t = text.toLowerCase();
  return words.filter((w) => (/^[\x00-\x7F]+$/.test(w) ? new RegExp(`(^|[^a-z])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(t) : t.includes(w)));
};

export function classifyReview(r: Pick<Review, "stars" | "comment">, type: Business["type"]): ReviewClass {
  const sentiment: Sentiment = r.stars >= 4 ? "positive" : r.stars === 3 ? "neutral" : r.stars >= 1 ? "negative" : "rating_unknown";
  const text = r.comment.trim();
  const reasons: string[] = [];
  if (sentiment === "negative") reasons.push("Negative review: a person should read and approve the reply.");
  if (sentiment === "rating_unknown") reasons.push("Google has no star rating for this review.");
  const health = type === "healthcare" && has(text, HEALTH).length > 0;
  const escalate = has(text, ESCALATE).length > 0;
  if (health) reasons.push("Mentions health or treatment details: the reply must not repeat them, so it needs your approval.");
  if (escalate) reasons.push("Mentions a refund, legal, safety or abuse issue: reply personally.");
  return { sentiment, noText: text.length === 0, sensitive: health || escalate, reasons };
}

/** Removes contact details and long numbers (patient or booking IDs) before review text is sent to Claude. */
export function redactForAi(text: string): string {
  return text
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email removed]")
    .replace(/(\+?\d[\d\s-]{7,}\d)/g, "[number removed]");
}

const RESOLVED = [/\b(has|have) been (resolved|fixed|refunded|sorted)\b/i, /\bwe (have )?(fixed|resolved|refunded)\b/i, /\b(issue|problem) is (now )?(fixed|resolved)\b/i, /\brefund (has been|was) (issued|processed)\b/i];

/**
 * Problems in a drafted reply. Any problem keeps the reply from being published automatically, and is shown to the
 * owner before approval.
 */
export function replyIssues(reply: string, review: Pick<Review, "comment">, b: Pick<Business, "type" | "phone" | "website">): string[] {
  const out: string[] = [];
  if (!reply.trim()) return ["The reply is empty."];
  if (b.type === "healthcare") out.push(...medicalWarnings(reply));
  if (RESOLVED.some((re) => re.test(reply))) out.push("Says the problem is solved. Only keep this if it is true and you can show it.");
  if (/[\w.+-]+@[\w-]+\.[\w.-]+/.test(reply) || /\+?\d[\d\s-]{7,}\d/.test(reply.replace(b.phone ?? "\u0000", ""))) {
    out.push("Contains an email address or phone number. Check it is the business's own public contact.");
  }
  if (b.type === "healthcare") {
    const repeated = has(reply, HEALTH).filter((w) => has(review.comment, [w]).length);
    if (repeated.length) out.push("Repeats health details from the review. Remove them to protect the reviewer's privacy.");
  }
  if (Buffer.byteLength(reply, "utf8") > 4096) out.push("Too long for Google (over 4096 bytes).");
  return [...new Set(out)];
}

export const defaultAutomation = (): AutomationSettings => ({ replies: "manual", paused: false, autoMinStars: 5 });

/** Why a reply may not be published automatically; empty means it may. */
export function autoBlockers(s: AutomationSettings, stars: number, cls: ReviewClass, issues: string[], live: boolean): string[] {
  const out: string[] = [];
  if (s.paused) out.push("Automation is paused.");
  if (s.replies !== "auto") out.push("Automatic publishing is off.");
  if (s.replies === "auto" && !s.autoOptInAt) out.push("Automatic publishing was not confirmed by the owner.");
  if (!live) out.push("Google is not connected for this location.");
  if (cls.sentiment !== "positive" || stars < s.autoMinStars) out.push(`Only ${s.autoMinStars === 5 ? "5-star" : "4 and 5-star"} reviews are published automatically.`);
  if (cls.sensitive) out.push(...cls.reasons);
  out.push(...issues);
  return [...new Set(out)];
}
