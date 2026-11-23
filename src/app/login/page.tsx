import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/forms";
import { AuthShell } from "@/components/AuthShell";
import { getUser } from "@/lib/session";
import { dashboardReturn } from "@/lib/return-to";

export const metadata: Metadata = { title: "Log in" };

export default async function Login({ searchParams }: { searchParams: Promise<{ link?: string; next?: string }> }) {
  const { link, next: asked } = await searchParams;
  // The dashboard page that sent the visitor here (checked: this site's /app pages only).
  const next = dashboardReturn(asked);
  if (await getUser()) redirect(next ?? "/app");
  return (
    <AuthShell title="Log in">
      {link === "expired" ? <p role="alert" className="field-error mb-4" data-testid="link-expired">That link has expired or was already used. Log in, or ask for a new reset link.</p> : null}
      <AuthForm mode="login" next={next} />
    </AuthShell>
  );
}
