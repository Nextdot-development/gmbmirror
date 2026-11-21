import type { GbpProfileSnapshot } from "./types";

/**
 * Business Profile score (0-100) from the owner's own Google Business Profile data. Transparent: every item shows
 * its points, why points were lost, and the steps to fix it. Items Google does not report are left out of the total
 * (never counted as zero). Deterministic, so it is recalculated whenever the profile is read again.
 */

export type ScoreItem = { key: string; label: string; max: number; points: number | null; detail: string; steps: string[] };
export type ProfileScore = { score: number; items: ScoreItem[]; checked: number };

const item = (key: string, label: string, max: number, points: number | null, detail: string, steps: string[] = []): ScoreItem => ({ key, label, max, points, detail, steps: points === max ? [] : steps });

export function profileScore(s: GbpProfileSnapshot): ProfileScore {
  const desc = s.description?.trim().length ?? 0;
  const items: ScoreItem[] = [
    item("verified", "Verified profile", 15, s.verified === undefined ? null : s.verified ? 15 : 0,
      s.verified === undefined ? "Google did not report verification." : s.verified ? "Google shows the profile as verified." : "Google does not show the profile as verified. Unverified profiles rank lower and cannot reply to reviews.",
      ["Open Google Business Profile and choose Verify.", "Follow Google's method (video, phone or postcard).", "Come back here and press Refresh from Google."]),
    item("status", "Open for business", 10, s.openStatus === undefined ? null : s.openStatus === "OPEN" ? 10 : 0,
      s.openStatus === undefined ? "Google did not report the status." : s.openStatus === "OPEN" ? "Shown as open." : "Google shows the business as closed.",
      ["If you are open, mark the business as open in Google Business Profile."]),
    item("category", "Primary category", 10, s.category ? 10 : 0, s.category ? `Set to "${s.category}".` : "No primary category.",
      ["In Google Business Profile, edit the profile and choose the category that names your main service."]),
    item("hours", "Opening hours", 15, s.hours.length ? 15 : 0, s.hours.length ? `${s.hours.length} opening period${s.hours.length === 1 ? "" : "s"} listed.` : "No opening hours. Google may show your hours as unknown.",
      ["Add your regular hours in Google Business Profile.", "Add special hours before holidays."]),
    item("phone", "Phone number", 10, s.phone ? 10 : 0, s.phone ? "Listed." : "No phone number, so people cannot call from Google.", ["Add a number that someone answers during opening hours."]),
    item("website", "Website", 10, s.website ? 10 : 0, s.website ? "Listed." : "No website link.", ["Add your website, or a page with your services and contact details."]),
    item("description", "Business description", 15, desc >= 250 ? 15 : desc >= 100 ? 8 : desc > 0 ? 3 : 0,
      desc ? `${desc} characters${desc < 250 ? "; 250 to 750 describe your services better" : ""}.` : "No description.",
      ["Write 250 to 750 characters on what you offer, who you serve and where.", "No links, offers or ALL CAPS: Google does not allow them."]),
    item("reviews", "Number of reviews", 10, s.reviewCount === undefined ? null : s.reviewCount >= 50 ? 10 : s.reviewCount >= 10 ? 6 : s.reviewCount > 0 ? 3 : 0,
      s.reviewCount === undefined ? "Google did not report the review count." : `${s.reviewCount} reviews on Google.`,
      ["Share your review link or QR code with every customer (Google profile page).", "Reply to every review."]),
    item("rating", "Rating", 5, s.rating === undefined ? null : s.rating >= 4.5 ? 5 : s.rating >= 4 ? 3 : 1,
      s.rating === undefined ? "No rating yet." : `${s.rating.toFixed(1)} average.`, ["Reply to low ratings, fix what they mention, and keep asking every customer for a review."]),
  ];
  const checked = items.filter((i) => i.points !== null);
  const max = checked.reduce((n, i) => n + i.max, 0);
  const got = checked.reduce((n, i) => n + (i.points ?? 0), 0);
  return { score: max ? Math.round((got / max) * 100) : 0, items, checked: checked.length };
}
