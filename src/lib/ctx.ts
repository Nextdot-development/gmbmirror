import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { requireUser } from "./session";
import { db, type Scope } from "./store";

/**
 * Reads shared by the app layout and the page within one request (React cache: one read per request; never shared
 * between requests or users). Server actions are not cached by React, so they always read fresh data.
 */
export const locationsOf = cache((userId: string) => db.getLocations(userId));
const businessOf = cache((userId: string, loc: string) => db.getBusiness({ userId, loc }));

/** The signed-in user and the business location they are working on (their active location). */
export async function requireScope(): Promise<{ user: { id: string; email: string }; scope: Scope }> {
  const user = await requireUser();
  const { active } = await locationsOf(user.id);
  return { user, scope: { userId: user.id, loc: active } };
}

/**
 * As requireScope, plus the location's business details. A location without them goes to onboarding.
 * `also`: other records of the location the page will read; they arrive in the same database round trip.
 */
export async function requireBusiness(also: string[] = []) {
  const { user, scope } = await requireScope();
  await db.preload(scope, ["business", ...also]);
  const business = await businessOf(scope.userId, scope.loc);
  if (!business) redirect("/app/onboarding");
  return { user, scope, business };
}
