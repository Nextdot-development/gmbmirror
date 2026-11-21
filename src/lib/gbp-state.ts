import { env } from "./env";
import type { GbpLocation } from "./gbp-api";
import type { GoogleConnection } from "./types";

/** Connection rules for the Business Profile integration. No I/O, so they are unit tested directly. */

export type LiveConnection = GoogleConnection & { accountName: string; locationName: string };

/** True only when real Google calls are allowed and a location is chosen. */
export function live(conn: GoogleConnection | null): conn is LiveConnection {
  return Boolean(env.googleConfigured() && env.gbpApproved() && conn && !conn.needsReconnect && conn.accountName && conn.locationName);
}

export type GbpStatus =
  | "not_configured" // OAuth credentials are not on the server yet
  | "not_connected"
  | "reconnect" // Google refused the stored sign-in
  | "not_enabled" // connected, but live Business Profile calls are switched off (GBP_API_APPROVED)
  | "choose_location"
  | "connected";

export function gbpStatus(conn: GoogleConnection | null): GbpStatus {
  if (!env.googleConfigured()) return conn ? (conn.needsReconnect ? "reconnect" : "not_enabled") : "not_configured";
  if (!conn) return "not_connected";
  if (conn.needsReconnect) return "reconnect";
  if (!env.gbpApproved()) return "not_enabled";
  if (!conn.accountName || !conn.locationName) return "choose_location";
  return "connected";
}

/**
 * The location to pick without asking: the only one, or the only one whose Google Place ID is the listing the
 * owner chose in Settings. Anything else is left for the owner to choose.
 */
export function autoLocation(locations: GbpLocation[], placeId?: string): GbpLocation | undefined {
  if (locations.length === 1) return locations[0];
  const same = placeId ? locations.filter((l) => l.placeId === placeId) : [];
  return same.length === 1 ? same[0] : undefined;
}

export const locationFields = (l: GbpLocation): Partial<GoogleConnection> => ({
  accountName: l.account,
  locationName: l.location,
  locationTitle: l.title,
  locationAddress: l.address || undefined,
  locationPlaceId: l.placeId,
  insights: undefined,
  profile: undefined,
});
