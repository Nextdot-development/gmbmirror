export function Source({ children }: { children: React.ReactNode }) {
  return <p className="caption-5 mt-2 text-muted">Source: {children}</p>;
}

/** Date and time, for "last synced" lines. */
export const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });

export const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

export function Stars({ n }: { n: number }) {
  if (!n) return <span className="caption-4 text-muted">No star rating</span>;
  return (
    <span className="inline-flex items-center gap-1.5" aria-label={`${n} out of 5 stars`}>
      <span aria-hidden className="tracking-[2px] text-star">{"★".repeat(n)}<span className="text-line">{"★".repeat(5 - n)}</span></span>
      <span aria-hidden className="caption-4 text-muted">{n} of 5</span>
    </span>
  );
}

/** Thin progress bar. Purely visual; the numbers next to it carry the meaning. */
export function Meter({ value, total }: { value: number; total: number }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return <div className="meter" aria-hidden><span style={{ width: `${pct}%` }} /></div>;
}

/** Small ring chart for "x of y". */
export function Ring({ value, total, size = 56 }: { value: number; total: number; size?: number }) {
  const r = 22, c = 2 * Math.PI * r;
  const share = total > 0 ? value / total : 0;
  return (
    <svg width={size} height={size} viewBox="0 0 56 56" aria-hidden className="shrink-0 -rotate-90">
      <circle cx="28" cy="28" r={r} fill="none" stroke="var(--color-pale)" strokeWidth="6" />
      <circle cx="28" cy="28" r={r} fill="none" stroke="var(--color-accent)" strokeWidth="6" strokeLinecap="round" strokeDasharray={`${c * share} ${c}`} />
    </svg>
  );
}

/** Display label for a reply or post status. */
export const statusLabel = (s: string) => ({ draft: "Draft", approved: "Approved", posted: "Posted" } as Record<string, string>)[s] ?? s;

/**
 * Bar chart of a 0-100 score over time, oldest on the left, with the change between the last two points.
 * Draws only the points given; with none it shows the empty message instead of a made-up line.
 */
export function TrendBars({ points, label, empty, unit = "/ 100" }: { points: { at: string; value: number }[]; label: string; empty: string; unit?: string }) {
  if (!points.length) return <p className="body-6 mt-3 text-muted">{empty}</p>;
  const shown = points.slice(0, 12).reverse();
  const [latest, previous] = points;
  const delta = previous ? latest.value - previous.value : null;
  return (
    <div className="mt-3">
      <div className="flex items-baseline gap-2">
        <p className="title-1 kpi">{latest.value} <span className="caption-2 text-muted">{unit}</span></p>
        {delta === null ? (
          <p className="caption-2 text-muted">First measurement, {fmtDate(latest.at)}</p>
        ) : (
          <p className={`caption-2 ${delta > 0 ? "text-ok" : delta < 0 ? "text-bad" : "text-muted"}`}>
            {delta === 0 ? "No change" : `${delta > 0 ? "▲ +" : "▼ "}${delta}`} vs {fmtDate(previous.at)}
          </p>
        )}
      </div>
      <div className="mt-3 flex h-20 items-end gap-1.5" role="img" aria-label={`${label}: ${shown.map((p) => `${fmtDate(p.at)} ${p.value}`).join(", ")}`}>
        {shown.map((p, i) => (
          <div key={`${p.at}-${i}`} className="flex h-full max-w-8 flex-1 items-end rounded-md bg-surface-3" title={`${fmtDate(p.at)}: ${p.value}`}>
            <div className={`w-full rounded-md ${i === shown.length - 1 ? "bg-brand" : "bg-brand-soft/60"}`} style={{ height: `${Math.max(p.value, 4)}%` }} />
          </div>
        ))}
      </div>
      <p className="caption-5 mt-1 text-muted">{shown.length === 1 ? fmtDate(shown[0].at) : `${fmtDate(shown[0].at)} to ${fmtDate(shown[shown.length - 1].at)}`}</p>
    </div>
  );
}
