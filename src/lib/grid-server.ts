import "server-only";
import { db } from "./store";
import { pointsUsed } from "./grid";

/** Grid points used in the last 24 hours across all of the user's locations (from saved scans, so restarts keep it). */
export async function gridPointsUsed(userId: string): Promise<number> {
  const { ids } = await db.getLocations(userId);
  let n = 0;
  for (const loc of ids) n += pointsUsed((await db.getPlaces({ userId, loc })).scans);
  return n;
}
