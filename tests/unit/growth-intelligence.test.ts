import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { categoryInfo, CATEGORIES, typeMatchesCategory } from "@/lib/business";
import { checklistRows } from "@/lib/checklist";
import { analyseCompetitors, metricsForHistory } from "@/lib/competition";
import { buildGrowth, currentRecommendations, mergeAiRecommendations, parseJsonObject, type GrowthData } from "@/lib/growth";
import { questionsFor, aiGrowthRecommendations } from "@/lib/ai";
import { auditVerdicts, categoryQuery, competitors, profileAudit, resetPlacesFallback } from "@/lib/places";
import type { Business, PlacesHistory, VisibilityCheck } from "@/lib/types";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const biz = (o: Partial<Business> = {}): Business =>
  ({ name: "Sunrise Hospital", website: "https://s.example", location: "Pune", category: "Hospital", type: "healthcare", audit: {}, createdAt: "2026-11-01T00:00:00Z", ...o }) as Business;
const NOW = Date.parse("2026-11-19T12:00:00Z");
const data = (o: Omit<Partial<GrowthData>, "places"> & { places?: Partial<PlacesHistory> } = {}): GrowthData => ({
  business: o.business ?? biz({ placeId: "ChIJx000000001" }),
  places: { profileScores: [], scans: [], ...(o.places ?? {}) },
  checks: o.checks ?? [],
  growth: o.growth ?? { completed: [], drafts: {} },
  now: NOW,
});
const check = (named: number, total: number, at: string): VisibilityCheck =>
  ({ id: at, checkedAt: at, businessName: "x", location: "Pune", category: "Hospital", methodology: "", results: Array.from({ length: total }, (_, i) => ({ provider: "claude", providerLabel: "Claude", question: "q", found: i < named, match: i < named ? "named" : "none", excerpt: "", mentionedBusinesses: [] })) }) as VisibilityCheck;

/* ---------- categories ---------- */

test("hospitals are hospitals, not clinics, in questions and competitor searches", () => {
  const b = biz({ category: "Multi-speciality Hospital" });
  assert.match(questionsFor(b)[0], /best multi-speciality hospitals in Pune/);
  assert.equal(categoryQuery(b), "multi-speciality hospitals in Pune");
  assert.equal(categoryQuery(biz({ category: "Eye Hospital" })), "eye hospitals in Pune");
  assert.equal(categoryQuery(biz({ category: "Pharmacy" })), "pharmacies in Pune");
  assert.equal(categoryQuery(biz({ category: "Salon", type: "general" })), "salons in Pune");
});

test("categories saved by older versions still work and show their new name", () => {
  assert.equal(categoryInfo("Doctor or clinic").label, "Doctor / Clinic");
  assert.equal(categoryInfo("Dentist").label, "Dental Clinic");
  assert.equal(categoryInfo("Restaurant or cafe").label, "Restaurant");
  assert.match(questionsFor(biz({ category: "Doctor or clinic" }))[0], /best clinics in Pune/);
  assert.equal(categoryInfo("Pet grooming").many, "pet grooming"); // unknown names are still usable
  assert.equal(new Set(CATEGORIES.map((c) => c.label)).size, CATEGORIES.length);
});

test("Google's primary type is matched to the chosen category", () => {
  assert.equal(typeMatchesCategory("general_hospital", "Multi-speciality Hospital"), true);
  assert.equal(typeMatchesCategory("beauty_salon", "Hospital"), false);
  assert.equal(typeMatchesCategory("dental_clinic", "Dentist"), true);
  assert.equal(typeMatchesCategory("hospital", "Other healthcare"), undefined);
  assert.equal(typeMatchesCategory(undefined, "Hospital"), undefined);
});

/* ---------- checklist ---------- */

test("checklist: Google verdicts, owner ticks, conflicts, unknowns and stale checks", () => {
  const b = biz({ audit: { website: true, description: true } });
  const audit = { score: 60, at: "2026-11-18T00:00:00Z", checklist: { website: "no" as const, hours: "yes" as const, phone: "attention" as const } };
  const rows = Object.fromEntries(checklistRows(b, audit, NOW).map((r) => [r.key, r]));
  assert.equal(rows.website.status, "missing");
  assert.equal(rows.website.conflict, true); // owner ticked, Google says no
  assert.equal(rows.website.owner, true); // never overwritten
  assert.equal(rows.hours.status, "verified");
  assert.equal(rows.hours.conflict, true); // Google yes, owner not ticked
  assert.equal(rows.phone.status, "attention");
  assert.equal(rows.description.status, "confirmed"); // Google cannot report it
  assert.equal(rows.services.status, "unknown"); // not "missing"
  assert.equal(rows.services.google, undefined);
  assert.equal(rows.hours.google?.stale, false);
  assert.equal(checklistRows(b, { ...audit, at: "2026-09-01T00:00:00Z" }, NOW).find((r) => r.key === "hours")?.google?.stale, true);
});

test("audit verdicts: phone match against Settings, category fit, unknown category", () => {
  const p = { id: "x", nationalPhoneNumber: "098765 43210", primaryType: "general_hospital", websiteUri: "https://x", photos: Array(4).fill({}) };
  assert.deepEqual(auditVerdicts(p, biz({ phone: "+91 98765 43210" })), { hours: "no", photos: "no", website: "yes", phone: "yes", primary_category: "yes" });
  assert.equal(auditVerdicts(p, biz({ phone: "91234 56789" })).phone, "attention");
  assert.equal(auditVerdicts(p, biz()).phone, "partial");
  assert.equal(auditVerdicts(p, biz({ category: "Salon", type: "general" })).primary_category, "attention");
  assert.equal(auditVerdicts({ id: "x" }, biz()).primary_category, "no");
});

/* ---------- competitor gap analysis ---------- */

test("gap analysis counts real results only and says when something cannot be compared", () => {
  const you = { id: "me", rating: 4.0, reviews: 12, photos: 3, website: false, phone: true, hours: undefined };
  const others = Array.from({ length: 10 }, (_, i) => ({ id: `c${i}`, rating: 4.5, reviews: 100 + i, photos: 10, website: i < 7, phone: true, hours: true }));
  const a = analyseCompetitors(you, [you, ...others]);
  assert.equal(a.compared, 10);
  assert.ok(a.gaps.includes("You have fewer reviews than 10 of the 10 businesses compared."));
  assert.ok(a.gaps.includes("Your rating is lower than 10 of the 10 businesses compared."));
  assert.ok(a.gaps.includes("7 of the 10 businesses compared show a website on Google; yours does not."));
  assert.ok(a.notes.some((n) => /opening hours/.test(n))); // your hours unknown: not compared
  assert.ok(a.actions.length > 0 && a.actions.length <= 3);
  const kept = metricsForHistory(a);
  assert.ok(kept.every((m) => !("label" in m) && !("sentence" in m))); // counts only
  assert.equal(kept.find((m) => m.metric === "website")?.youHave, false);
});

test("gap analysis with no comparable data makes no claims", () => {
  const a = analyseCompetitors({ id: "me" }, Array.from({ length: 5 }, (_, i) => ({ id: `c${i}` })));
  assert.deepEqual(a.gaps, []);
  assert.deepEqual(a.strengths, []);
  assert.equal(a.notes.length, 6);
});

test("strengths are reported when the owner is ahead", () => {
  const a = analyseCompetitors({ id: "me", rating: 4.8, reviews: 900 }, [1, 2, 3, 4].map((i) => ({ id: `c${i}`, rating: 4.1, reviews: 100 })));
  assert.ok(a.strengths.includes("Your rating is higher than 4 of the 4 businesses compared."));
  assert.ok(a.strengths.includes("You have more reviews than 4 of the 4 businesses compared."));
});

/* ---------- growth engine ---------- */

test("a new account gets setup actions, no health score, and no invented measures", () => {
  const v = buildGrowth(data({ business: biz() }));
  assert.equal(v.health, null);
  assert.equal(v.hasSignals, false);
  assert.equal(v.candidates[0].id, "place_id");
  assert.equal(v.candidates[0].priority, "Critical");
  assert.ok(v.measures.filter((m) => m.key !== "checklist").every((m) => m.value === undefined && /Not measured yet/.test(m.detail)));
  assert.equal(v.rules.length, 3);
});

test("issues and evidence come from stored data, with competitor counts as extra evidence", () => {
  const v = buildGrowth(data({
    places: {
      profileScores: [{ score: 45, at: "2026-11-18T00:00:00Z", items: { status: 10, rating: 5, reviews: 5, photos: 5, hours: 0, website: 0, phone: 10, category: 5 }, checklist: { hours: "no", website: "no", photos: "no", phone: "partial", primary_category: "yes" } }],
      competitors: [{ at: "2026-11-18T00:00:00Z", query: "hospitals in Pune", position: null, compared: 10, metrics: [{ metric: "reviews", known: 10, ahead: 9, behind: 1 }, { metric: "website", known: 10, ahead: 8, behind: 0, youHave: false }] }],
      scans: [{ id: "s", keyword: "hospital", radiusKm: 3, ranks: [null, 8, 9, 4, 2, 5, null, 12, 15], at: "2026-11-18T00:00:00Z" }],
    },
    checks: [check(1, 4, "2026-11-17T00:00:00Z")],
  }));
  const ids = v.candidates.map((c) => c.id);
  for (const id of ["hours", "website", "reviews_count", "photos", "rating", "competitor_rank", "local_rank", "ai_visibility"]) assert.ok(ids.includes(id), id);
  const reviews = v.candidates.find((c) => c.id === "reviews_count")!;
  assert.ok(reviews.evidence.includes("Profile audit on 18 Nov 2026: Google shows 5 to 19 reviews."));
  assert.ok(reviews.evidence.some((e) => e.includes("9 of the 10 businesses compared have more reviews")));
  assert.ok(v.candidates.find((c) => c.id === "website")!.evidence.some((e) => e.includes("8 of the 10 businesses compared show a website")));
  assert.ok(v.candidates.find((c) => c.id === "local_rank")!.evidence[0].includes("in the top 3 at 1 of 9 points, not in the top 20 at 2"));
  assert.equal(v.health?.measured, 4);
  // Sorted by severity, highest first.
  assert.deepEqual([...v.candidates].sort((a, b) => b.severity - a.severity).map((c) => c.id), ids);
});

test("health is a weighted average of measured values only", () => {
  const v = buildGrowth(data({ places: { profileScores: [{ score: 80, at: "2026-11-18T00:00:00Z" }] } }));
  assert.equal(v.health?.measured, 1);
  // profile 80 (0.3) and checklist 0 of 11 (0.15): (80*0.3 + 0*0.15) / 0.45 = 53
  assert.equal(v.health?.score, 53);
});

test("done actions hide until a newer measurement still shows them", () => {
  const audit = (at: string) => ({ score: 50, at, items: { status: 10, rating: 15, reviews: 20, photos: 5, hours: 15, website: 10, phone: 10, category: 5 } });
  const done = { completed: [{ id: "photos", title: "Add photos", at: "2026-11-18T10:00:00Z" }], drafts: {} };
  assert.ok(!buildGrowth(data({ places: { profileScores: [audit("2026-11-18T00:00:00Z")] }, growth: done })).candidates.some((c) => c.id === "photos"));
  const again = buildGrowth(data({ places: { profileScores: [audit("2026-11-19T00:00:00Z")] }, growth: done })).candidates.find((c) => c.id === "photos");
  assert.ok(again?.reopened);
  assert.ok(again?.evidence.some((e) => e.includes("You marked this done on 18 Nov 2026")));
});

test("the fingerprint changes when the data changes, and only then", () => {
  const a = buildGrowth(data({ checks: [check(1, 4, "2026-11-17T00:00:00Z")] }));
  const same = buildGrowth(data({ checks: [check(1, 4, "2026-11-17T00:00:00Z")] }));
  const changed = buildGrowth(data({ checks: [check(3, 4, "2026-11-18T00:00:00Z")] }));
  assert.equal(a.fingerprint, same.fingerprint);
  assert.notEqual(a.fingerprint, changed.fingerprint);
  const cached = { completed: [], drafts: {}, cache: { fingerprint: a.fingerprint, at: "", source: "ai" as const, recs: a.rules } };
  assert.equal(currentRecommendations(a, cached).source, "ai");
  assert.equal(currentRecommendations(changed, cached).source, "rules");
  assert.equal(currentRecommendations(changed, cached).stale, true);
});

test("recent changes compare like with like and never invent history", () => {
  const v = buildGrowth(data({
    places: {
      profileScores: [{ score: 70, at: "2026-11-19T00:00:00Z" }, { score: 55, at: "2026-11-10T00:00:00Z" }],
      scans: [
        { id: "a", keyword: "hospital", radiusKm: 3, ranks: [1, 1, 1, 2, 1, 2, 5, 5, 5], at: "2026-11-19T00:00:00Z" },
        { id: "b", keyword: "clinic", radiusKm: 3, ranks: Array(9).fill(1), at: "2026-11-15T00:00:00Z" },
        { id: "c", keyword: "hospital", radiusKm: 3, ranks: [9, 9, 9, 9, 1, 9, 9, 9, 9], at: "2026-11-10T00:00:00Z" },
      ],
    },
  }));
  const texts = v.changes.map((c) => c.text);
  assert.ok(texts.includes("Profile audit score rose from 55 to 70 / 100"));
  assert.ok(texts.includes("Top 3 for “hospital” at 6 of 9 points, up from 1"));
  assert.deepEqual(buildGrowth(data({ places: { profileScores: [{ score: 70, at: "2026-11-19T00:00:00Z" }] } })).changes, []);
});

/* ---------- Claude's answer ---------- */

const viewWithIssues = () => buildGrowth(data({ checks: [check(0, 4, "2026-11-17T00:00:00Z")] }));

test("a valid Claude answer is used, but evidence and links always come from our data", () => {
  const v = viewWithIssues();
  const ids = v.candidates.slice(0, 3).map((c) => c.id);
  const raw = { recommendations: ids.map((id) => ({ id, title: `Do ${id}`, why: "Because the data says so here.", steps: ["One step.", "Two steps."], benefit: "Clearer profile.", difficulty: "Easy", priority: "High", evidence: ["made-up 999 reviews"] })) };
  const out = mergeAiRecommendations(v, raw, true)!;
  assert.deepEqual(out.map((r) => r.id), ids);
  assert.equal(out[0].title, `Do ${ids[0]}`);
  assert.deepEqual(out[0].evidence, v.candidates[0].evidence);
  assert.ok(!JSON.stringify(out).includes("999"));
});

test("unknown ids, bad JSON and broken shapes are rejected; promises fall back to the rules text", () => {
  const v = viewWithIssues();
  assert.equal(mergeAiRecommendations(v, parseJsonObject("not json at all"), false), null);
  assert.equal(mergeAiRecommendations(v, { recommendations: [{ id: "made_up", title: "x", why: "y" }] }, false), null);
  assert.equal(mergeAiRecommendations(v, { recommendations: [{ id: "made_up", title: "Valid title", why: "A long enough reason.", steps: ["a step", "b step"], benefit: "Some benefit", difficulty: "Easy", priority: "High" }] }, false), null);
  const id = v.candidates[0].id;
  const promise = mergeAiRecommendations(v, { recommendations: [{ id, title: "Rank first", why: "We guarantee you will rank first.", steps: ["a step", "b step"], benefit: "Top spot", difficulty: "Easy", priority: "Critical" }] }, false)!;
  assert.equal(promise[0].title, v.candidates[0].title); // replaced by the rules version
  assert.equal(promise.length, Math.min(3, v.candidates.length)); // filled from the rules
  assert.deepEqual(parseJsonObject('Sure: {"a": 1} done'), { a: 1 });
});

test("cautions are allowed, promises are not, and medical wording is checked in what the owner will do", async () => {
  const { riskyAdvice } = await import("@/lib/growth");
  const r = (o: Partial<{ title: string; why: string; benefit: string; steps: string[] }>) => ({ title: "Add services", why: "Because.", benefit: "Clearer.", steps: ["Open the profile."], ...o });
  assert.equal(riskyAdvice(r({ steps: ["Avoid claims such as guaranteed results or the best treatment."] }), true), false);
  assert.equal(riskyAdvice(r({ benefit: "This does not guarantee a top position." }), false), false);
  assert.equal(riskyAdvice(r({ steps: ["Do not use words like best doctor or make cure claims."] }), true), false);
  assert.equal(riskyAdvice(r({ benefit: "We guarantee you will rank first." }), false), true);
  assert.equal(riskyAdvice(r({ steps: ["Fine advice.", "Tell patients you are the best hospital in town."] }), true), true);
  assert.equal(riskyAdvice(r({ title: "Say our treatment cures back pain" }), true), true);
  assert.equal(riskyAdvice(r({ why: "You are not among the top hospitals in this search yet." }), true), false); // describes, does not advertise
  assert.equal(riskyAdvice(r({ steps: ["Say our treatment cures back pain."] }), false), false); // medical wording applies to healthcare only
});

test("the Claude request carries our derived facts only, never Google's own content", async () => {
  process.env.ANTHROPIC_API_KEY = "test-key";
  let sent = "";
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    sent = String(init?.body);
    return new Response(JSON.stringify({ content: [{ type: "text", text: "no json" }], stop_reason: "end_turn" }), { status: 200 });
  }) as typeof fetch;
  const v = buildGrowth(data({ places: { profileScores: [{ score: 45, at: "2026-11-18T00:00:00Z", items: { status: 10, rating: 5, reviews: 5, photos: 5, hours: 0, website: 0, phone: 10, category: 5 } }] } }));
  assert.equal(await aiGrowthRecommendations(biz({ placeId: "ChIJx000000001" }), v), null);
  const body = JSON.parse(sent);
  const user = JSON.parse(body.messages[0].content);
  assert.deepEqual(Object.keys(user), ["business", "measures", "candidates"]);
  assert.ok(!sent.includes("ChIJx000000001")); // not even the Place ID
  assert.ok(sent.includes("Google shows 5 to 19 reviews")); // our own tier, not Google's number
});

/* ---------- Places: verdicts and analysis come back from a real request shape ---------- */

test("profile audit returns item keys and checklist verdicts; competitors return the gap analysis", async () => {
  process.env.GOOGLE_PLACES_API_KEY = "test-key";
  delete process.env.GOOGLE_PLACES_BASE_URL;
  resetPlacesFallback();
  const me = { id: "ChIJme00000001", displayName: { text: "Me" }, rating: 4.0, userRatingCount: 12, photos: [{}], primaryType: "hospital", nationalPhoneNumber: "98765 43210" };
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const u = new URL(url);
    if (u.pathname.endsWith("searchText"))
      return new Response(JSON.stringify({ places: [1, 2, 3].map((i) => ({ id: `ChIJc${i}000000001`, rating: 4.6, userRatingCount: 400, photos: Array(10).fill({}), websiteUri: "https://c", nationalPhoneNumber: "1", regularOpeningHours: {} })) }), { status: 200 });
    assert.ok(new Headers(init?.headers).get("X-Goog-FieldMask"));
    return new Response(JSON.stringify(me), { status: 200 });
  }) as typeof fetch;
  const a = await profileAudit("ChIJme00000001", biz({ phone: "98765 43210" }));
  assert.deepEqual(a.items.map((i) => i.key), ["status", "rating", "reviews", "photos", "hours", "website", "phone", "category"]);
  assert.equal(a.checklist.phone, "yes");
  assert.equal(a.checklist.website, "no");
  const c = await competitors("ChIJme00000001", biz());
  assert.equal(c.position, null);
  assert.ok(c.analysis.gaps.includes("You have fewer reviews than 3 of the 3 businesses compared."));
  assert.ok(c.gaps[0].startsWith("You are not in the top 3"));
  assert.equal(c.list[0].website, true);
});
