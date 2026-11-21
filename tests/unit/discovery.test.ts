import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { labelMatches, matchKind } from "@/lib/discovery";
import { findPlaces, isNotFound, LegacyPlacesError, PlacesError, placeSummary, resetPlacesFallback, type PlaceSummary } from "@/lib/places";

const realFetch = globalThis.fetch;
beforeEach(() => {
  process.env.GOOGLE_PLACES_API_KEY = "test-key";
  delete process.env.GOOGLE_PLACES_BASE_URL;
  resetPlacesFallback();
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

const place = (id: string, name: string, address = "Pune"): PlaceSummary => ({ id, name, address, reviews: 0 });

test("name matching: exact ignores case, punctuation, & vs and, and Google's ' | …' suffix", () => {
  assert.equal(matchKind("Sunrise Multi-speciality Hospital", "sunrise multi speciality hospital"), "exact");
  assert.equal(matchKind("Glow Salon and Spa", "Glow Salon & Spa"), "exact");
  assert.equal(matchKind("Indraprastha Apollo Hospitals", "Indraprastha Apollo Hospitals | Hospital in Delhi"), "exact");
  assert.equal(matchKind("Karim's", "Karims"), "exact");
  assert.equal(matchKind("Glow Salon", "Glow Salon & Spa"), "close");
  assert.equal(matchKind("Apollo Hospital", "Indraprastha Apollo Hospitals"), "close");
  assert.equal(matchKind("Glow Salon", "Sunrise Hospital"), "different");
  assert.equal(matchKind("", "Anything"), "different");
});

test("results: same-name first in Google's order, branches flagged, nothing chosen or removed", () => {
  const out = labelMatches("Glow Salon", [place("a", "Glow Salon & Spa", "Baner"), place("b", "Glow Salon", "FC Road"), place("c", "Hair Studio"), place("d", "Glow Salon", "Kothrud")]);
  assert.deepEqual(out.map((p) => [p.id, p.match, p.branch]), [
    ["b", "exact", true],
    ["d", "exact", true],
    ["a", "close", false],
    ["c", "different", false],
  ]);
  assert.equal(labelMatches("X", []).length, 0);
});

test("search: name + city + state, up to 5 results, only the fields shown, then the category is returned", async () => {
  let sent: { body: { textQuery: string; pageSize: number }; mask: string | null } | undefined;
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    sent = { body: JSON.parse(String(init?.body)), mask: new Headers(init?.headers).get("X-Goog-FieldMask") };
    return new Response(JSON.stringify({ places: [{ id: "ChIJx000000001", displayName: { text: "Glow Salon" }, formattedAddress: "Kothrud, Pune", primaryType: "beauty_salon", primaryTypeDisplayName: { text: "Beauty Salon" } }] }), { status: 200 });
  }) as typeof fetch;
  const r = await findPlaces("  Glow Salon ", "Pune", " Maharashtra ");
  assert.deepEqual(sent?.body, { textQuery: "Glow Salon Pune Maharashtra", pageSize: 5 });
  assert.equal(sent?.mask, "places.id,places.displayName,places.formattedAddress,places.primaryType,places.primaryTypeDisplayName");
  assert.deepEqual([r[0].id, r[0].name, r[0].address, r[0].type], ["ChIJx000000001", "Glow Salon", "Kothrud, Pune", "Beauty Salon"]);
  await findPlaces("Glow Salon", "Pune");
  assert.equal(sent?.body.textQuery, "Glow Salon Pune");
});

test("one listing's name and address are fetched fresh by Place ID", async () => {
  let url = "";
  globalThis.fetch = (async (u: string) => {
    url = u;
    return new Response(JSON.stringify({ id: "ChIJx000000001", displayName: { text: "Glow Salon" }, formattedAddress: "Kothrud, Pune" }), { status: 200 });
  }) as typeof fetch;
  const p = await placeSummary("ChIJx000000001");
  assert.ok(url.endsWith("/places/ChIJx000000001"));
  assert.deepEqual([p.name, p.address], ["Glow Salon", "Kothrud, Pune"]);
});

test("'not found' is told apart from key, quota and network problems", () => {
  assert.equal(isNotFound(new PlacesError(404, { status: "NOT_FOUND" })), true);
  assert.equal(isNotFound(new PlacesError(400, { status: "INVALID_ARGUMENT", message: "Not a valid Place ID." })), true);
  assert.equal(isNotFound(new PlacesError(400, { status: "INVALID_ARGUMENT", details: [{ reason: "API_KEY_INVALID" }] })), false);
  assert.equal(isNotFound(new PlacesError(429, { status: "RESOURCE_EXHAUSTED" })), false);
  assert.equal(isNotFound(new PlacesError(403, { details: [{ reason: "ACCESS_DENIED" }] })), false);
  assert.equal(isNotFound(new LegacyPlacesError("NOT_FOUND")), true);
  assert.equal(isNotFound(new LegacyPlacesError("OVER_QUERY_LIMIT")), false);
  assert.equal(isNotFound(new Error("network")), false);
});
