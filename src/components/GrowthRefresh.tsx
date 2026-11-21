"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { refreshGrowthAction } from "@/app/actions";

/**
 * Updates the dashboard recommendations with Claude after the page has loaded with the standard ones,
 * only when the data behind them changed. The page stays usable whatever Claude does.
 */
export function GrowthRefresh({ stale, source, canAsk }: { stale: boolean; source: "ai" | "rules"; canAsk: boolean }) {
  const router = useRouter();
  const [msg, setMsg] = useState<string>();
  const [pending, start] = useTransition();
  const asked = useRef(false);

  const run = (force: boolean) =>
    start(async () => {
      setMsg(undefined);
      const r = await refreshGrowthAction(force);
      if (r.status === "updated") router.refresh();
      else if (r.message) setMsg(r.message);
    });

  useEffect(() => {
    if (stale && canAsk && !asked.current) {
      asked.current = true;
      run(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stale, canAsk]);

  return (
    <div className="flex flex-wrap items-center gap-2" aria-live="polite">
      <span className={`badge ${source === "ai" ? "badge-ok" : ""}`}>{source === "ai" ? "Written by Claude from your data" : "Standard recommendations"}</span>
      {pending ? <span className="caption-2 text-muted">Updating with Claude…</span> : null}
      {msg ? <span className="caption-2 text-muted" role="status">{msg}</span> : null}
      {canAsk && source === "rules" && !pending ? (
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => run(true)}>Ask Claude again</button>
      ) : null}
    </div>
  );
}
