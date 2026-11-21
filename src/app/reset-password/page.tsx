import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/AuthShell";
import { NewPasswordForm } from "@/components/forms";
import { getUser } from "@/lib/session";
import { env } from "@/lib/env";

// Rendered per request: the page depends on the running mode and, for reset, on the signed-in session.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Choose a new password" };

/** Reached from the reset email: the link has already signed the person in. */
export default async function ResetPassword() {
  if (env.mode() !== "supabase") redirect("/forgot-password");
  const user = await getUser();
  if (!user) redirect("/login?link=expired");
  return (
    <AuthShell title="Choose a new password" intro={`For ${user.email}.`}>
      <NewPasswordForm />
    </AuthShell>
  );
}
