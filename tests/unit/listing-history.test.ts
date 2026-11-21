import { test } from "node:test";
import assert from "node:assert/strict";
import { historyFor, otherListings, tagHistory } from "@/lib/listing-history";
import type { PlacesHistory } from "@/lib/types";

const audit = (score: number, placeId?: string) => ({ score, at: `2026-11-${10 + score % 9}T00:00:00Z`, ...(placeId ? { placeId } : {}) });
const scan = (id: string, placeId?: string) => ({ id, keyword: "k", radiusKm: 1, ranks: [1], at: "2026-11-10T00:00:00Z", ...(placeId ? { placeId } : {}) });

test("untagged history (saved before tagging) belongs to the current listing until the listing changes", () => {
  const h: PlacesHistory = { profileScores: [audit(50), audit(60)], scans: [scan("s1")] };
  assert.equal(historyFor(h, "A").profileScores.length, 2);
  assert.deepEqual(otherListings(h, "A"), { audits: 0, scans: 0, competitors: 0 });
});

test("changing the listing labels old history with the old listing: kept, never shown as the new one's", () => {
  const tagged = tagHistory({ profileScores: [audit(50), audit(60, "A")], scans: [scan("s1")], competitors: [{ at: "x", query: "q", position: 1, compared: 9, metrics: [] }] }, "A");
  assert.ok(tagged.profileScores.every((a) => a.placeId === "A"));
  assert.equal(tagged.scans[0].placeId, "A");
  assert.equal(tagged.competitors?.[0].placeId, "A");
  const forB = historyFor(tagged, "B");
  assert.deepEqual([forB.profileScores.length, forB.scans.length, forB.competitors?.length], [0, 0, 0]);
  assert.deepEqual(otherListings(tagged, "B"), { audits: 2, scans: 1, competitors: 1 });
  // Switching back shows A's history again; nothing was removed.
  assert.equal(historyFor({ ...tagged, profileScores: [audit(70, "B"), ...tagged.profileScores] }, "A").profileScores.length, 2);
});

test("tagging never relabels entries that already name their listing", () => {
  const h = tagHistory({ profileScores: [audit(40, "B"), audit(50)], scans: [] }, "A");
  assert.deepEqual(h.profileScores.map((a) => a.placeId), ["B", "A"]);
});
