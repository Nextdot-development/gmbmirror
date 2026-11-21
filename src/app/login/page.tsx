import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/forms";
import { AuthShell } from "@/components/AuthShell";
import { getUser } from "@/lib/session";

export const metadata: Metadata = { title: "Log in" };

export default async function Login() {
  if (await getUser()) redirect("/app");
  return (
    <AuthShell title="Log in">
      <AuthForm mode="login" />
    </AuthShell>
  );
}
