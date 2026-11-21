import { CATEGORIES } from "./business";
import type { GbpProfile } from "./gbp-api";
import type { Business, BusinessType, GbpProfileSnapshot, SourcedField } from "./types";

/**
 * How Google Business Profile data fills the business details. No I/O, so it is unit tested directly.
 *
 * Rules:
 * - A value the owner typed ("user") is never replaced by Google. The owner can choose Google's value in Settings.
 * - An empty value is filled from Google, and remembered as Google's ("google").
 * - A value that came from Google follows Google when Google changes it.
 * - Nothing Google did not return is invented.
 */

export const defaultCategory = (type: BusinessType) => (type === "healthcare" ? "Other healthcare" : "Other local business");

/** Our category for Google's primary category name ("Dermatologist", "Beauty salon"), within the business type. */
export function categoryFromGoogle(googleCategory: string | undefined, type: BusinessType): string | undefined {
  if (!googleCategory) return undefined;
  const g = googleCategory.toLowerCase();
  let best: { label: string; score: number } | undefined;
  for (const c of CATEGORIES) {
    if (c.type !== type) continue;
    // An exact name match wins; otherwise the category with the most matching hints (ties: list order).
    const score = c.label.toLowerCase() === g ? 100 : c.googleTypes.filter((h) => g.includes(h)).length;
    if (score > 0 && (!best || score > best.score)) best = { label: c.label, score };
  }
  return best?.label;
}

export function snapshotFrom(p: GbpProfile, location: string, reviews?: { rating?: number; count?: number }, now = new Date()): GbpProfileSnapshot {
  const s: GbpProfileSnapshot = { location, fetchedAt: now.toISOString(), title: p.title, hours: p.hours ?? [] };
  const opt = { address: p.address || undefined, phone: p.phone, website: p.website, category: p.category, description: p.description, openStatus: p.openStatus, verified: p.verified,
    placeId: p.placeId, mapsUri: p.mapsUri, rating: reviews?.rating, reviewCount: reviews?.count };
  for (const [k, v] of Object.entries(opt)) if (v !== undefined && v !== "") (s as Record<string, unknown>)[k] = v;
  return s;
}

const SAME = (a?: string, b?: string) => (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();

/**
 * The business with Google's values applied under the rules above. `changed` names what changed, for the message.
 * The Place ID is returned separately: changing it also re-labels history, which the caller does.
 */
export function applyGoogleProfile(b: Business, snap: GbpProfileSnapshot): { business: Business; changed: SourcedField[]; placeId?: string } {
  const next: Business = { ...b, sources: { ...(b.sources ?? {}) } };
  const changed: SourcedField[] = [];
  const take = (field: "website" | "phone", value?: string) => {
    if (!value) return;
    const src = next.sources![field];
    const empty = !next[field];
    if ((empty || src === "google") && !SAME(next[field], value)) {
      next[field] = value;
      next.sources![field] = "google";
      changed.push(field);
    } else if (empty) next.sources![field] = "google";
  };
  take("website", snap.website);
  take("phone", snap.phone);
  if (next.sources!.category !== "user") {
    const cat = categoryFromGoogle(snap.category, b.type);
    if (cat && cat !== next.category) {
      next.category = cat;
      next.sources!.category = "google";
      changed.push("category");
    }
  }
  const placeId = snap.placeId && snap.placeId !== b.placeId ? snap.placeId : undefined;
  return { business: next, changed, placeId };
}

/**
 * Before switching to another Business Profile location: values that came from the old location are removed, so
 * they are never shown as the new location's. The owner's own values stay. The category goes back to the general
 * one for the type until the new location's category is read.
 */
export function forgetGoogleValues(b: Business): Business {
  const next: Business = { ...b, sources: { ...(b.sources ?? {}) } };
  if (next.sources!.website === "google") { next.website = ""; delete next.sources!.website; }
  if (next.sources!.phone === "google") { delete next.phone; delete next.sources!.phone; }
  if (next.sources!.category === "google") { next.category = defaultCategory(b.type); delete next.sources!.category; }
  return next;
}

export type Gap = { key: string; text: string };

/**
 * What still needs attention, from what Google reports (or, without a connection, from the owner's details).
 * Only things the app can actually see; each is an optional improvement, not a required field.
 */
export function profileGaps(b: Business, snap?: GbpProfileSnapshot): Gap[] {
  const out: Gap[] = [];
  if (!snap) {
    if (!b.website) out.push({ key: "website", text: "Add your website so customers and AI assistants can check your details." });
    if (!b.phone) out.push({ key: "phone", text: "Optional: add a phone number. The profile audit checks that it matches Google." });
    return out;
  }
  if (!snap.phone) out.push({ key: "phone", text: "Your Google profile has no phone number. Customers cannot call you from Google." });
  if (!snap.website) out.push({ key: "website", text: "Your Google profile has no website link." });
  if (!snap.hours.length) out.push({ key: "hours", text: "Your Google profile has no opening hours. Google may show your hours as unknown." });
  if (snap.verified === false) out.push({ key: "verified", text: "Google does not show this profile as verified. Verify it in Google Business Profile." });
  if (snap.openStatus === "CLOSED_TEMPORARILY") out.push({ key: "status", text: "Google shows the business as temporarily closed." });
  if (snap.openStatus === "CLOSED_PERMANENTLY") out.push({ key: "status", text: "Google shows the business as permanently closed." });
  return out;
}
