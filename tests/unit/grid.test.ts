import { test } from "node:test";
import assert from "node:assert/strict";
import { foundCount, gridLeaders, gridOffsets, gridPointsPerDay, gridSize, leaderMovement, pointsUsed, previousOf, sameSeries, scanRequests, top3Count } from "@/lib/grid";
import type { GridScan } from "@/lib/types";

const scan = (over: Partial<GridScan>): GridScan => ({ id: "s", keyword: "skin clinic", radiusKm: 3, ranks: Array(9).fill(5), at: "2026-11-20T10:00:00Z", ...over });

test("grid: 3x3 and 5x5 points run row by row from the north-west with the business in the centre", () => {
  const three = gridOffsets(3), five = gridOffsets(5);
  assert.equal(three.length, 9);
  assert.equal(five.length, 25);
  assert.deepEqual(three[0], { row: 1, col: -1 });
  assert.deepEqual(three[4], { row: 0, col: 0 });
  assert.deepEqual(five[0], { row: 2, col: -2 });
  assert.deepEqual(five[12], { row: 0, col: 0 });
  assert.deepEqual(five[24], { row: -2, col: 2 });
  assert.equal(new Set(five.map((o) => `${o.row},${o.col}`)).size, 25);
});

test("grid cost: exact request counts, a daily points allowance across scans, and an override", () => {
  assert.equal(scanRequests(3), 10);
  assert.equal(scanRequests(5), 26);
  const now = Date.parse("2026-11-20T12:00:00Z");
  const scans = [scan({ ranks: Array(25).fill(1), at: "2026-11-20T09:00:00Z" }), scan({ at: "2026-11-20T08:00:00Z" }), scan({ ranks: Array(25).fill(1), at: "2026-11-18T08:00:00Z" })];
  assert.equal(pointsUsed(scans, now), 34, "only the last 24 hours count");
  const before = process.env.GRID_POINTS_PER_DAY;
  delete process.env.GRID_POINTS_PER_DAY;
  assert.equal(gridPointsPerDay(), 75);
  process.env.GRID_POINTS_PER_DAY = "200";
  assert.equal(gridPointsPerDay(), 200);
  process.env.GRID_POINTS_PER_DAY = "3";
  assert.equal(gridPointsPerDay(), 75, "below one 3x3 scan is ignored");
  if (before === undefined) delete process.env.GRID_POINTS_PER_DAY; else process.env.GRID_POINTS_PER_DAY = before;
});

test("grid series: only the same phrase, spacing and grid size are compared; old scans count as 3x3", () => {
  const old = scan({ id: "old" });
  assert.equal(gridSize(old), 3);
  assert.equal(gridSize(scan({ ranks: Array(25).fill(null) })), 5);
  const big = scan({ id: "b", size: 5, ranks: Array(25).fill(2) });
  assert.ok(!sameSeries(big, old));
  assert.ok(sameSeries(scan({ id: "x", keyword: " Skin Clinic " }), old));
  assert.ok(!sameSeries(scan({ id: "y", radiusKm: 5 }), old));
  const list = [big, scan({ id: "n" }), old];
  assert.equal(previousOf(list, big), undefined);
  assert.equal(previousOf(list, list[1])!.id, "old");
  assert.equal(top3Count(scan({ ranks: [1, 3, 4, null, 2, 20, null, 3, 9] })), 4);
  assert.equal(foundCount(scan({ ranks: [1, 3, 4, null, 2, 20, null, 3, 9] })), 7);
});

test("grid leaders: who is most often in the top 3, from the result lists only, never including the owner", () => {
  const cells = [["A", "me", "B", "C"], ["A", "B", "me"], ["B", "A", "D"], ["me", "D", "A"]];
  const l = gridLeaders(cells, "me");
  assert.deepEqual(l.map((x) => x.id), ["A", "B", "D", "C"]);
  assert.deepEqual(l[0], { id: "A", top3: 4, found: 4, avg: 1.8 }, "positions 1, 1, 2 and 3");
  assert.ok(!l.some((x) => x.id === "me"));
  assert.equal(gridLeaders(Array(25).fill(Array.from({ length: 20 }, (_, i) => `P${i}`)), "me").length, 5, "at most 5");
});

test("grid competitor movement: gained, lost, new and dropped out, only when both scans recorded competitors", () => {
  const prev = scan({ id: "p", leaders: [{ id: "A", top3: 5, found: 9, avg: 2 }, { id: "B", top3: 3, found: 9, avg: 3 }, { id: "C", top3: 2, found: 8, avg: 4 }] });
  const now = scan({ id: "n", leaders: [{ id: "A", top3: 7, found: 9, avg: 1.5 }, { id: "B", top3: 1, found: 9, avg: 5 }, { id: "D", top3: 2, found: 6, avg: 6 }] });
  const m = leaderMovement(now, prev)!;
  assert.deepEqual(m.moves.map((x) => [x.id, x.change]), [["A", "up"], ["B", "down"], ["D", "new"]]);
  assert.deepEqual(m.left.map((x) => x.id), ["C"]);
  assert.equal(leaderMovement(now, scan({ id: "old" })), null, "older scans without competitor data are not compared");
  assert.equal(leaderMovement(now, undefined), null);
});
