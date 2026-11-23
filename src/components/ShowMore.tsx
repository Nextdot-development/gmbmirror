import Link from "next/link";

/**
 * "Showing n of total" with a link that shows `step` more. Keeps the page's other query values and scrolls to
 * `anchor` (the list), so the owner stays where they were. Pages read `show` from their search params.
 */
export function ShowMore({ shown, total, step, params, anchor }: { shown: number; total: number; step: number; params: Record<string, string | undefined>; anchor: string }) {
  if (shown >= total) return null;
  const q = new URLSearchParams(Object.entries({ ...params, show: String(shown + step) }).filter((e): e is [string, string] => Boolean(e[1])));
  return (
    <p className="caption-1 mt-4 flex flex-wrap items-center gap-3 text-muted" data-testid="show-more">
      Showing {shown} of {total}.
      <Link href={`?${q.toString()}#${anchor}`} scroll={false} className="btn btn-secondary btn-sm">Show {Math.min(step, total - shown)} more</Link>
    </p>
  );
}

/** How many items to show: at least `step`, more when the owner asked for more (never fewer than `step`). */
export const shownCount = (show: string | undefined, step: number, total: number) => Math.min(total, Math.max(step, Math.floor(Number(show)) || step));
