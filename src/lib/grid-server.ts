import "server-only";
import { db } from "./store";
import { pointsUsed } from "./grid";

/** Grid points used in the last 24 hours across all of the user's locations (from saved scans, so restarts keep it). */
export async function gridPointsUsed(userId: string): Promise<number> {
  const { ids } = await db.getLocations(userId);
  const all = await Promise.all(ids.map((loc) => db.getPlaces({ userId, loc })));
  return all.reduce((n, p) => n + pointsUsed(p.scans), 0);
}
