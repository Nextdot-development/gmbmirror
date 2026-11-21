import type { Metadata } from "next";
import { AuthShell } from "@/components/AuthShell";
import { ForgotPasswordForm } from "@/components/forms";
import { env } from "@/lib/env";

// Rendered per request: the page depends on the running mode and, for reset, on the signed-in session.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Reset your password" };

export default function ForgotPassword() {
  const live = env.mode() === "supabase";
  return (
    <AuthShell title="Reset your password" intro={live ? "Enter the email you signed up with. We will send you a link to choose a new password." : undefined}>
      {live ? <ForgotPasswordForm /> : <p className="body-6 text-muted" data-testid="reset-unavailable">Password reset needs the live service. It is not available in this local demo.</p>}
    </AuthShell>
  );
}
