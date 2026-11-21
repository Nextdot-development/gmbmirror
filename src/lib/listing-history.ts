import type { PlacesHistory } from "./types";

/**
 * Audit, rank-grid and competitor history belongs to the Google listing it was measured for.
 * Entries record that listing's Place ID. Entries saved before this existed carry none; they are labelled with
 * the old listing at the moment the listing is changed (tagHistory), so until a change they belong to the
 * current listing, and after it they never count for the new one.
 */

type Entry = { placeId?: string };
const mine = (placeId?: string) => (e: Entry) => (e.placeId ? e.placeId === placeId : true);

/**
 * The history measured for this listing only. With `competitorQuery` ("dental clinics in Pune"), competitor
 * comparisons made for another category or city are left out too: they compared the owner with other businesses.
 */
export function historyFor(h: PlacesHistory, placeId?: string, competitorQuery?: string): PlacesHistory {
  const keep = mine(placeId);
  const sameSearch = (c: { query: string }) => competitorQuery === undefined || c.query === competitorQuery;
  return { profileScores: h.profileScores.filter(keep), scans: h.scans.filter(keep), competitors: (h.competitors ?? []).filter((c) => keep(c) && sameSearch(c)) };
}

/** How much history from other listings is kept (shown, never mixed in). */
export function otherListings(h: PlacesHistory, placeId?: string) {
  const other = (e: Entry) => !mine(placeId)(e);
  return { audits: h.profileScores.filter(other).length, scans: h.scans.filter(other).length, competitors: (h.competitors ?? []).filter(other).length };
}

/** Before the listing changes from `oldId`: label every untagged entry as measured for `oldId`. Nothing is removed. */
export function tagHistory(h: PlacesHistory, oldId: string): PlacesHistory {
  const tag = <T extends Entry>(e: T): T => (e.placeId ? e : { ...e, placeId: oldId });
  return { ...h, profileScores: h.profileScores.map(tag), scans: h.scans.map(tag), competitors: h.competitors?.map(tag) };
}
