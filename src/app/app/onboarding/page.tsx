import type { Metadata } from "next";
import { OnboardingForm } from "@/components/forms";
import { OnboardingSteps } from "@/components/OnboardingSteps";
import { requireScope } from "@/lib/ctx";
import { db } from "@/lib/store";

export const metadata: Metadata = { title: "Add your business" };

/** Onboarding step 1: business type, name, city and an optional website. Step 2 connects Google. */
export default async function Onboarding() {
  const { scope } = await requireScope();
  const existing = await db.getBusiness(scope);
  return (
    <div className="mx-auto w-full max-w-[520px]">
      <header className="panel-glow mb-8 p-6 sm:p-8">
        <OnboardingSteps current={1} />
        <h1 className="heading-4 mt-6">Tell us about your business</h1>
        <p className="body-3 mt-2 text-muted">Just the basics. Next, you connect Google and we fill in the rest.</p>
      </header>
      <OnboardingForm initial={existing} />
    </div>
  );
}
