import "server-only";
import { redirect } from "next/navigation";
import { requireUser } from "./session";
import { db, type Scope } from "./store";

/** The signed-in user and the business location they are working on (their active location). */
export async function requireScope(): Promise<{ user: { id: string; email: string }; scope: Scope }> {
  const user = await requireUser();
  const { active } = await db.getLocations(user.id);
  return { user, scope: { userId: user.id, loc: active } };
}

/** As requireScope, plus the location's business details. A location without them goes to onboarding. */
export async function requireBusiness() {
  const { user, scope } = await requireScope();
  const business = await db.getBusiness(scope);
  if (!business) redirect("/app/onboarding");
  return { user, scope, business };
}
