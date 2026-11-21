import { test } from "node:test";
import assert from "node:assert/strict";
import { applyGoogleProfile, categoryFromGoogle, defaultCategory, forgetGoogleValues, profileGaps, snapshotFrom } from "@/lib/business-sync";
import { formatHours } from "@/lib/gbp-api";
import type { Business, GbpProfileSnapshot } from "@/lib/types";

// How Google Business Profile data fills the business details. Pure functions; nothing reaches Google.

const biz = (o: Partial<Business> = {}): Business => ({ name: "Zentrix Skin Clinic", website: "", location: "Bhubaneswar", category: "Other healthcare", type: "healthcare", audit: {}, createdAt: "", ...o });
const snap = (o: Partial<GbpProfileSnapshot> = {}): GbpProfileSnapshot => ({ location: "locations/1", fetchedAt: "2026-11-20T00:00:00Z", title: "Zentrix Skin Clinic", hours: ["Monday 09:00–18:00"], ...o });

test("Google's category maps to ours within the business type, preferring the closest match", () => {
  assert.equal(categoryFromGoogle("Dermatologist", "healthcare"), "Dermatology Clinic");
  assert.equal(categoryFromGoogle("Skin care clinic", "healthcare"), "Dermatology Clinic"); // skin + clinic beats clinic alone
  assert.equal(categoryFromGoogle("Dental clinic", "healthcare"), "Dental Clinic");
  assert.equal(categoryFromGoogle("Hospital", "healthcare"), "Hospital");
  assert.equal(categoryFromGoogle("Beauty salon", "general"), "Salon");
  assert.equal(categoryFromGoogle("Beauty salon", "healthcare"), undefined, "never crosses the business type");
  assert.equal(categoryFromGoogle("Notary public", "general"), undefined);
  assert.equal(categoryFromGoogle(undefined, "general"), undefined);
  assert.equal(defaultCategory("healthcare"), "Other healthcare");
  assert.equal(defaultCategory("general"), "Other local business");
});

test("empty details are filled from Google and remembered as Google's; the owner's own values are never replaced", () => {
  const r = applyGoogleProfile(biz(), snap({ website: "https://zentrix.example", phone: "0674 123 4567", category: "Dermatologist", placeId: "ChIJa" }));
  assert.deepEqual([r.business.website, r.business.phone, r.business.category], ["https://zentrix.example", "0674 123 4567", "Dermatology Clinic"]);
  assert.deepEqual(r.business.sources, { website: "google", phone: "google", category: "google" });
  assert.deepEqual(r.changed.sort(), ["category", "phone", "website"]);
  assert.equal(r.placeId, "ChIJa");

  const mine = biz({ website: "https://my-own.example", phone: "99999 00000", category: "Hospital", sources: { website: "user", phone: "user", category: "user" } });
  const r2 = applyGoogleProfile(mine, snap({ website: "https://zentrix.example", phone: "0674 123 4567", category: "Dermatologist" }));
  assert.deepEqual([r2.business.website, r2.business.phone, r2.business.category], ["https://my-own.example", "99999 00000", "Hospital"]);
  assert.deepEqual(r2.changed, []);
  assert.equal(r2.placeId, undefined, "no Place ID from Google: nothing to change");
});

test("a value that came from Google follows Google; Google leaving a field empty never clears it", () => {
  const b = biz({ website: "https://old.example", sources: { website: "google" } });
  assert.equal(applyGoogleProfile(b, snap({ website: "https://new.example" })).business.website, "https://new.example");
  assert.equal(applyGoogleProfile(b, snap({})).business.website, "https://old.example");
  // The name is the owner's: Google's title is shown, not applied.
  assert.equal(applyGoogleProfile(biz({ name: "Zentrix" }), snap({ title: "Zentrix Skin & Hair Clinic" })).business.name, "Zentrix");
  // Same value in different case is not a change.
  assert.deepEqual(applyGoogleProfile(biz({ website: "https://Zentrix.example", sources: { website: "google" } }), snap({ website: "https://zentrix.example" })).changed, []);
});

test("snapshot keeps only what Google returned, with rating and review count when known", () => {
  const s = snapshotFrom({ title: "Clinic", address: "", hasHours: false, hours: [], phone: undefined, verified: false, placeId: "ChIJa" }, "locations/9", { rating: 4.2, count: 60 }, new Date("2026-11-20T00:00:00Z"));
  assert.deepEqual(s, { location: "locations/9", fetchedAt: "2026-11-20T00:00:00.000Z", title: "Clinic", hours: [], verified: false, placeId: "ChIJa", rating: 4.2, reviewCount: 60 });
});

test("gaps: only what can be seen, phrased as improvements", () => {
  assert.deepEqual(profileGaps(biz(), snap({ phone: "1", website: "w" })).map((g) => g.key), []);
  assert.deepEqual(profileGaps(biz(), snap({ hours: [], verified: false, openStatus: "CLOSED_TEMPORARILY" })).map((g) => g.key), ["phone", "website", "hours", "verified", "status"]);
  // Not connected: only the owner's own missing details.
  assert.deepEqual(profileGaps(biz({ website: "x", phone: "1" })).map((g) => g.key), []);
  assert.deepEqual(profileGaps(biz()).map((g) => g.key), ["website", "phone"]);
});

test("opening hours read as lines; zero values Google omits are midnight; overnight periods name the closing day", () => {
  assert.deepEqual(formatHours([
    { openDay: "MONDAY", openTime: { hours: 9 }, closeDay: "MONDAY", closeTime: { hours: 18, minutes: 30 } },
    { openDay: "FRIDAY", openTime: { hours: 20 }, closeDay: "SATURDAY", closeTime: {} },
    { openDay: "DAY_OF_WEEK_UNSPECIFIED" },
  ]), ["Monday 09:00–18:30", "Friday 20:00–Saturday 00:00"]);
  assert.deepEqual(formatHours(undefined), []);
});

test("switching location: values from the old location are removed, the owner's own values stay", () => {
  const b = biz({ website: "https://old-branch.example", phone: "0674 1", category: "Dermatology Clinic", name: "Zentrix", sources: { website: "google", phone: "google", category: "google", name: "user" } });
  const f = forgetGoogleValues(b);
  assert.deepEqual([f.website, f.phone, f.category, f.name], ["", undefined, "Other healthcare", "Zentrix"]);
  assert.deepEqual(f.sources, { name: "user" });
  const own = biz({ website: "https://mine.example", phone: "9", category: "Hospital", sources: { website: "user", phone: "user", category: "user" } });
  assert.deepEqual(forgetGoogleValues(own), own);
});
