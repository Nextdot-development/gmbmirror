import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/forms";
import { AuthShell } from "@/components/AuthShell";
import { getUser } from "@/lib/session";

export const metadata: Metadata = { title: "Log in" };

export default async function Login({ searchParams }: { searchParams: Promise<{ link?: string }> }) {
  if (await getUser()) redirect("/app");
  const { link } = await searchParams;
  return (
    <AuthShell title="Log in">
      {link === "expired" ? <p role="alert" className="field-error mb-4" data-testid="link-expired">That link has expired or was already used. Log in, or ask for a new reset link.</p> : null}
      <AuthForm mode="login" />
    </AuthShell>
  );
}
