/** "Step 1 of 2" indicator for onboarding. */
export function OnboardingSteps({ current }: { current: 1 | 2 }) {
  const steps = ["Your business", "Connect Google"];
  return (
    <ol className="flex items-center gap-3" aria-label={`Step ${current} of ${steps.length}`}>
      {steps.map((label, i) => {
        const n = i + 1;
        const done = n < current, now = n === current;
        return (
          <li key={label} className="flex items-center gap-2" aria-current={now ? "step" : undefined}>
            <span className={`grid h-7 w-7 place-items-center rounded-full text-xs font-semibold ${now ? "bg-brand text-white shadow-[0_6px_14px_-6px_rgba(36,99,255,0.7)]" : done ? "bg-accent-soft text-brand-strong" : "bg-surface text-muted ring-1 ring-line"}`}>{done ? "✓" : n}</span>
            <span className={`caption-1 ${now ? "text-ink" : "text-muted"}`}>{label}</span>
            {n < steps.length ? <span className="h-px w-8 bg-line-strong" aria-hidden /> : null}
          </li>
        );
      })}
    </ol>
  );
}
