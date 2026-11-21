import type { GridLeader, GridScan } from "./types";

/**
 * Local rank grid: shared rules for 3x3 (9 points) and 5x5 (25 points) scans. Pure functions, unit tested.
 * Positions are estimates from Google Places text searches, never Google Business Profile data.
 */

export const GRID_SIZES = [3, 5] as const;
export type GridSize = (typeof GRID_SIZES)[number];

/** Scans saved before 5x5 existed have no size: they are 3x3. */
export const gridSize = (s: Pick<GridScan, "size" | "ranks">): GridSize => (s.size ?? (s.ranks.length === 25 ? 5 : 3)) as GridSize;

/** Only scans with the same phrase, spacing and grid size are compared with each other. */
export const sameSeries = (a: GridScan, b: GridScan) =>
  a.keyword.trim().toLowerCase() === b.keyword.trim().toLowerCase() && a.radiusKm === b.radiusKm && gridSize(a) === gridSize(b);

/** The earlier scan of the same series, if any (scans are newest first). */
export const previousOf = (scans: GridScan[], scan: GridScan) => scans.slice(scans.indexOf(scan) + 1).find((s) => sameSeries(s, scan));

/** Grid points as row and column offsets from the business, row by row from the north-west; the centre is (0, 0). */
export function gridOffsets(size: GridSize): { row: number; col: number }[] {
  const h = (size - 1) / 2;
  const out: { row: number; col: number }[] = [];
  for (let r = h; r >= -h; r--) for (let c = -h; c <= h; c++) out.push({ row: r, col: c });
  return out;
}

/** Exact Google Places requests one scan makes: the business's map location, then one search per point. */
export const scanRequests = (size: GridSize) => 1 + size * size;

/**
 * Daily grid allowance per user (all locations together), counted in grid points from saved scans so it survives
 * restarts. Default 75 points: for example three 5x5 scans, or eight 3x3 scans. GRID_POINTS_PER_DAY overrides it.
 */
export const gridPointsPerDay = () => {
  const n = Number(process.env.GRID_POINTS_PER_DAY);
  return Number.isFinite(n) && n >= 9 ? Math.floor(n) : 75;
};
export const pointsUsed = (scans: Pick<GridScan, "at" | "ranks">[], now = Date.now()) =>
  scans.filter((s) => now - Date.parse(s.at) < 86_400_000).reduce((n, s) => n + s.ranks.length, 0);

/**
 * The businesses that appear most in the top 3 across the grid (place IDs only, which Google allows storing),
 * from the result lists every point already returns: no extra Google requests. Up to `limit`, best first.
 */
export function gridLeaders(cells: string[][], ownId: string, limit = 5): GridLeader[] {
  const stat = new Map<string, { top3: number; found: number; sum: number }>();
  for (const list of cells) {
    list.slice(0, 20).forEach((id, i) => {
      if (id === ownId) return;
      const s = stat.get(id) ?? { top3: 0, found: 0, sum: 0 };
      s.found++;
      s.sum += i + 1;
      if (i < 3) s.top3++;
      stat.set(id, s);
    });
  }
  return [...stat.entries()]
    .map(([id, s]) => ({ id, top3: s.top3, found: s.found, avg: Math.round((s.sum / s.found) * 10) / 10 }))
    .sort((a, b) => b.top3 - a.top3 || b.found - a.found || a.avg - b.avg || a.id.localeCompare(b.id))
    .slice(0, limit);
}

export type LeaderMove = { id: string; now: GridLeader; before?: GridLeader; change: "new" | "up" | "down" | "same" };

/**
 * How the leading competitors moved since the previous scan of the same series. `left`: businesses that were in the
 * previous top list and are not now. Only computed when both scans recorded competitors.
 */
export function leaderMovement(latest: GridScan, previous: GridScan | undefined): { moves: LeaderMove[]; left: GridLeader[] } | null {
  if (!latest.leaders || !previous?.leaders) return null;
  const before = new Map(previous.leaders.map((l) => [l.id, l]));
  const moves = latest.leaders.map((now): LeaderMove => {
    const b = before.get(now.id);
    if (!b) return { id: now.id, now, change: "new" };
    const d = now.top3 - b.top3 || b.avg - now.avg;
    return { id: now.id, now, before: b, change: d > 0 ? "up" : d < 0 ? "down" : "same" };
  });
  const nowIds = new Set(latest.leaders.map((l) => l.id));
  return { moves, left: previous.leaders.filter((l) => !nowIds.has(l.id)) };
}

export const top3Count = (s: Pick<GridScan, "ranks">) => s.ranks.filter((r) => r !== null && r <= 3).length;
export const foundCount = (s: Pick<GridScan, "ranks">) => s.ranks.filter((r) => r !== null).length;
