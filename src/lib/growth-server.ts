import "server-only";
import { db, type Scope } from "./store";
import { buildGrowth } from "./growth";
import { historyFor } from "./listing-history";
import { categoryQuery } from "./places";
import type { Business } from "./types";

/** Everything the dashboard and action plans need, read from the signed-in user's own data only. */
export async function loadGrowth(scope: Scope, business: Business) {
  const [all, checks, growth] = await Promise.all([db.getPlaces(scope), db.getChecks(scope), db.getGrowth(scope)]);
  // Only what was measured for the current Google listing.
  const places = historyFor(all, business.placeId, categoryQuery(business));
  return { view: buildGrowth({ business, places, checks, growth }), growth, places, checks };
}
