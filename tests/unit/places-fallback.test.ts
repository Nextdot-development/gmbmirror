import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { competitors, findPlaces, fromLegacy, LegacyPlacesError, PlacesError, profileAudit, rankGrid, resetPlacesFallback } from "@/lib/places";
import type { Business } from "@/lib/types";

// A fake fetch: no request leaves the machine. Each test says how the new and the older API answer.
const KEY = "AIzaFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKE123";
const realFetch = globalThis.fetch;
let calls: string[] = [];
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const denied = () => json(403, { error: { code: 403, status: "PERMISSION_DENIED", message: "Permission denied on the service.", details: [{ reason: "ACCESS_DENIED" }] } });

function fakeGoogle(handlers: { modern: (url: URL, body: any) => Response; older: (url: URL) => Response }) {
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.host === "places.googleapis.com") {
      calls.push(`new ${url.pathname}`);
      return handlers.modern(url, init?.body ? JSON.parse(String(init.body)) : undefined);
    }
    calls.push(`old ${url.pathname.split("/").slice(-2, -1)[0]}`);
    assert.equal(url.searchParams.get("key"), KEY);
    return handlers.older(url);
  }) as typeof fetch;
}

const business = { type: "healthcare", category: "Dentist", location: "Pune", name: "Sunrise Dental" } as unknown as Business;
const oldPlace = (id: string, extra: object = {}) => ({ place_id: id, name: `Place ${id}`, types: ["dentist", "health", "point_of_interest"], rating: 4.6, user_ratings_total: 120, ...extra });

beforeEach(() => {
  process.env.GOOGLE_PLACES_API_KEY = KEY;
  calls = [];
  resetPlacesFallback();
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

test("the new API is used when Google allows it; the older one is not called", async () => {
  fakeGoogle({ modern: () => json(200, { places: [{ id: "ChIJnew0000001", displayName: { text: "New result" } }] }), older: () => assert.fail("older API called") });
  const r = await findPlaces("Sunrise Dental", "Pune");
  assert.equal(r[0].name, "New result");
  assert.deepEqual(calls, ["new /v1/places:searchText"]);
});

test("new API refused: the older API answers, and for 10 minutes the new API is not retried", async () => {
  fakeGoogle({ modern: denied, older: () => json(200, { status: "OK", candidates: [oldPlace("ChIJold0000001")] }) });
  assert.equal((await findPlaces("Sunrise Dental", "Pune"))[0].id, "ChIJold0000001");
  assert.equal((await findPlaces("Sunrise Dental", "Pune"))[0].id, "ChIJold0000001");
  assert.deepEqual(calls, ["new /v1/places:searchText", "old findplacefromtext", "old findplacefromtext"]);
});

test("both refused: the error explains the Places API (New) setting to fix and never contains the key", async () => {
  fakeGoogle({ modern: denied, older: () => json(200, { status: "REQUEST_DENIED", error_message: `The key ${KEY} is not allowed.` }) });
  await assert.rejects(findPlaces("Sunrise Dental", "Pune"), (e: Error) => e instanceof PlacesError && /Places API \(New\)/.test(e.message) && !e.message.includes(KEY));
});

test("other older-API failures are reported as they are, without the key", async () => {
  fakeGoogle({ modern: denied, older: () => json(200, { status: "OVER_QUERY_LIMIT", error_message: `quota for ${KEY}` }) });
  await assert.rejects(findPlaces("Sunrise Dental", "Pune"), (e: Error) => e instanceof LegacyPlacesError && /quota/.test(e.message) && !e.message.includes(KEY));
});

test("profile audit through the older API scores the same fields", async () => {
  fakeGoogle({
    modern: denied,
    older: () =>
      json(200, {
        status: "OK",
        result: oldPlace("ChIJold0000001", { business_status: "OPERATIONAL", photos: Array(10).fill({}), opening_hours: { open_now: true }, website: "https://x.example", formatted_phone_number: "098765 43210" }),
      }),
  });
  const a = await profileAudit("ChIJold0000001", business);
  assert.equal(a.score, 10 + 15 + 20 + 15 + 15 + 10 + 10 + 5);
  assert.equal(a.items.find((i) => i.label === "Primary category")?.value, "Dentist");
});

test("competitors through the older API: photo counts unknown, so no photo comparison is made", async () => {
  fakeGoogle({
    modern: denied,
    older: (url) =>
      url.pathname.includes("textsearch")
        ? json(200, { status: "OK", results: [oldPlace("ChIJcomp000001", { photos: [{}] }), oldPlace("ChIJcomp000002"), oldPlace("ChIJmine000001", { user_ratings_total: 3, rating: 4.0 })] })
        : assert.fail("details not needed: the business is in the list"),
  });
  const c = await competitors("ChIJmine000001", business);
  assert.equal(c.position, 3);
  assert.ok(c.list.every((p) => p.photos === undefined));
  assert.ok(c.gaps.some((g) => g.includes("reviews")));
  assert.ok(!c.gaps.some((g) => g.includes("photos")));
});

test("rank grid through the older API: 9 searches biased to each point", async () => {
  fakeGoogle({
    modern: denied,
    older: (url) => {
      if (url.pathname.includes("details")) return json(200, { status: "OK", result: { place_id: "ChIJmine000001", geometry: { location: { lat: 18.52, lng: 73.85 } } } });
      assert.match(url.searchParams.get("location") ?? "", /^\d+\.\d+,\d+\.\d+$/);
      assert.equal(url.searchParams.get("radius"), "3000");
      return json(200, { status: "OK", results: [oldPlace("ChIJother00001"), oldPlace("ChIJmine000001")] });
    },
  });
  const g = await rankGrid("ChIJmine000001", "dentist near me", 3);
  assert.deepEqual(g.ranks, Array(9).fill(2));
  // The business ahead at every point is recorded from the same results (place ID and counts only).
  assert.deepEqual(g.leaders, [{ id: "ChIJother00001", top3: 9, found: 9, avg: 1 }]);
  assert.equal(calls.filter((c) => c === "old textsearch").length, 9);
});

test("rank grid 5x5: 25 searches, one per point, plus one location lookup", async () => {
  const centres: string[] = [];
  fakeGoogle({
    modern: denied,
    older: (url) => {
      if (url.pathname.includes("details")) return json(200, { status: "OK", result: { place_id: "ChIJmine000001", geometry: { location: { lat: 18.52, lng: 73.85 } } } });
      centres.push(url.searchParams.get("location")!);
      return json(200, { status: "OK", results: [oldPlace("ChIJmine000001")] });
    },
  });
  const g = await rankGrid("ChIJmine000001", "dentist near me", 1, 5);
  assert.deepEqual(g.ranks, Array(25).fill(1));
  assert.equal(calls.filter((c) => c === "old textsearch").length, 25);
  assert.equal(new Set(centres).size, 25, "every point is a different place");
  assert.deepEqual(g.leaders, []);
});

test("the specific type is chosen over broad groups such as health", () => {
  assert.equal(fromLegacy({ place_id: "ChIJx", types: ["health", "hospital", "point_of_interest", "establishment"] }).primaryTypeDisplayName?.text, "Hospital");
  assert.equal(fromLegacy({ place_id: "ChIJx", types: ["health", "point_of_interest"] }).primaryTypeDisplayName?.text, "Health");
});

test("older-API places map onto the new shape", () => {
  const p = fromLegacy({ place_id: "ChIJx", name: "A", types: ["point_of_interest", "dental_clinic"], geometry: { location: { lat: 1, lng: 2 } } }, true);
  assert.deepEqual(
    { id: p.id, name: p.displayName?.text, type: p.primaryTypeDisplayName?.text, loc: p.location, limited: p.photosLimited },
    { id: "ChIJx", name: "A", type: "Dental clinic", loc: { latitude: 1, longitude: 2 }, limited: true },
  );
});
