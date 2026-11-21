import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/forms";
import { AuthShell } from "@/components/AuthShell";
import { getUser } from "@/lib/session";

export const metadata: Metadata = { title: "Create your account" };

export default async function Signup() {
  if (await getUser()) redirect("/app");
  return (
    <AuthShell title="Create your account" intro="It takes two minutes. You do not need to connect Google yet.">
      <AuthForm mode="signup" />
    </AuthShell>
  );
}
