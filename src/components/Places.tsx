"use client";
import { useActionState, useEffect, useRef, useState } from "react";
import { Roboto } from "next/font/google";
import {
  competitorsAction, gridCompetitorNamesAction, profileAuditAction, rankScanAction,
  type AuditState, type CompetitorState, type GridState,
} from "@/app/actions";
import { foundCount, gridSize, leaderMovement, previousOf, scanRequests, top3Count, type GridSize } from "@/lib/grid";
import type { GridScan, PlacesHistory } from "@/lib/types";
import { Msg, SubmitButton } from "./ui";
import { Meter, Ring } from "./bits";

const roboto = Roboto({ weight: "400", subsets: ["latin"], display: "swap" });

/** Required attribution for Places data shown without a Google map: the text "Google Maps", unchanged and unwrapped. */
export function GoogleMapsAttribution() {
  return (
    <p className="caption-5 mt-3 text-muted">
      Data:{" "}
      <span translate="no" className={roboto.className} style={{ fontSize: 12, color: "#5E5E5E", whiteSpace: "nowrap", fontWeight: 400 }}>Google Maps</span>
    </p>
  );
}

/** Profile audit from live Place Details. */
export function ProfileAudit() {
  const [s, action] = useActionState<AuditState, FormData>(profileAuditAction, {});
  const delta = s.score !== undefined && s.previous !== undefined ? s.score - s.previous : null;
  return (
    <div>
      <form action={action}><SubmitButton small pending="Checking Google">{s.score === undefined ? "Run profile audit" : "Run again"}</SubmitButton></form>
      {s.error ? <p role="alert" className="field-error">{s.error}</p> : null}
      {s.items ? (
        <div className="mt-4">
          <div className="flex items-center gap-3">
            <Ring value={s.score ?? 0} total={100} />
            <div>
              <p className="caption-1 text-muted">Profile score for {s.name}</p>
              <p className="heading-5 kpi">{s.score}<span className="title-3 text-muted"> / 100</span></p>
              {delta !== null ? <p className={`caption-2 ${delta > 0 ? "text-ok" : delta < 0 ? "text-bad" : "text-muted"}`}>{delta === 0 ? "No change" : `${delta > 0 ? "+" : ""}${delta}`} vs previous audit</p> : null}
            </div>
          </div>
          <ul className="mt-4 flex flex-col gap-3">
            {s.items.map((i) => (
              <li key={i.label} className="inset">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="title-4">{i.label}: <span className="body-6 text-muted">{i.value}</span></span>
                  <span className="caption-3">{i.points} / {i.max}</span>
                </div>
                <div className="mt-2"><Meter value={i.points} total={i.max} /></div>
                {i.fix ? <p className="caption-2 mt-2 text-muted">How to improve: {i.fix}</p> : null}
              </li>
            ))}
          </ul>
          <GoogleMapsAttribution />
        </div>
      ) : null}
    </div>
  );
}

const yesNo = (v?: boolean) => (v === undefined ? "–" : v ? "Yes" : "No");

/** Top 10 businesses for the category and city, with the owner's business highlighted, and a gap analysis. */
export function Competitors({ placeId }: { placeId: string }) {
  const [s, action] = useActionState<CompetitorState, FormData>(competitorsAction, {});
  return (
    <div>
      <form action={action}><SubmitButton small variant="secondary" pending="Searching Google">{s.list ? "Compare again" : "Compare with competitors"}</SubmitButton></form>
      {s.error ? <p role="alert" className="field-error">{s.error}</p> : null}
      {s.list ? (
        <div className="mt-4">
          <p className="body-5">
            Google search: &ldquo;{s.query}&rdquo;. {s.position ? <>You are <strong>#{s.position}</strong> of {s.list.length}.</> : <>You are not in the top {s.list.length}.</>}
          </p>
          {s.commonType ? <p className="caption-2 mt-1 text-muted">Most common Google category among them: {s.commonType.label} ({s.commonType.count} of {s.commonType.of}).</p> : null}
          {s.analysis ? (
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div className="inset" aria-labelledby="cmp-gaps">
                <h3 id="cmp-gaps" className="title-4">Where others are ahead</h3>
                {s.analysis.gaps.length ? <ul className="body-6 mt-2 list-disc pl-5">{s.analysis.gaps.map((g) => <li key={g}>{g}</li>)}</ul> : <p className="body-6 mt-2 text-muted">No measure where most of them are ahead.</p>}
              </div>
              <div className="inset" aria-labelledby="cmp-strengths">
                <h3 id="cmp-strengths" className="title-4">Where you are stronger</h3>
                {s.analysis.strengths.length ? <ul className="body-6 mt-2 list-disc pl-5">{s.analysis.strengths.map((g) => <li key={g}>{g}</li>)}</ul> : <p className="body-6 mt-2 text-muted">No measure where you are ahead of most of them yet.</p>}
              </div>
              {s.analysis.actions.length ? (
                <div className="inset md:col-span-2" aria-labelledby="cmp-actions">
                  <h3 id="cmp-actions" className="title-4">Recommended actions</h3>
                  <ol className="body-6 mt-2 list-decimal pl-5">{s.analysis.actions.map((a) => <li key={a}>{a}</li>)}</ol>
                </div>
              ) : null}
              {s.analysis.notes.length ? <ul className="caption-2 text-muted md:col-span-2">{s.analysis.notes.map((n) => <li key={n}>{n}</li>)}</ul> : null}
            </div>
          ) : null}
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[640px] text-left body-6">
              <thead className="caption-3 text-muted">
                <tr><th className="py-2 pr-3">#</th><th className="py-2 pr-3">Business</th><th className="py-2 pr-3">Rating</th><th className="py-2 pr-3">Reviews</th><th className="py-2 pr-3">Photos</th><th className="py-2 pr-3">Website</th><th className="py-2 pr-3">Phone</th><th className="py-2">Type</th></tr>
              </thead>
              <tbody>
                {s.list.map((p, i) => (
                  <tr key={p.id} className={`border-t border-line ${p.id === placeId ? "bg-accent-soft font-semibold" : ""}`}>
                    <td className="py-2 pr-3">{i + 1}</td>
                    <td className="py-2 pr-3">{p.name}{p.id === placeId ? " (you)" : ""}</td>
                    <td className="py-2 pr-3">{p.rating?.toFixed(1) ?? "–"}</td>
                    <td className="py-2 pr-3">{p.reviews}</td>
                    <td className="py-2 pr-3">{p.photos === undefined ? "–" : p.photos >= 10 ? "10+" : p.photos}</td>
                    <td className="py-2 pr-3">{yesNo(p.website)}</td>
                    <td className="py-2 pr-3">{yesNo(p.phone)}</td>
                    <td className="py-2">{p.type ?? "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="hint">Photos: Google returns at most 10 photos per place here, so 10+ means &ldquo;at least 10&rdquo;. &ldquo;–&rdquo; means Google did not say.</p>
          <GoogleMapsAttribution />
        </div>
      ) : null}
    </div>
  );
}

const cellClass = (r: number | null) =>
  r === null ? "bg-surface-3 text-muted" : r <= 3 ? "bg-ok-soft text-ok" : r <= 10 ? "bg-warn-soft text-warn" : "bg-bad-soft text-bad";

const avg = (x: GridScan) => {
  const f = x.ranks.filter((r): r is number => r !== null);
  return f.length ? f.reduce((a, b) => a + b, 0) / f.length : null;
};
/** Green when `now` is better than `before` (higher by default). */
const trend = (now: number, before: number) => (now === before ? "text-muted" : now > before ? "text-ok" : "text-bad");
const series = (x: GridScan) => `“${x.keyword}”, ${x.radiusKm} km, ${gridSize(x)} x ${gridSize(x)}`;

/** ▲ when a grid point moved up since the previous scan of the same series, ▼ when it moved down. */
function CellChange({ now, before }: { now: number | null; before: number | null }) {
  const better = now !== null && (before === null || now < before);
  const worse = before !== null && (now === null || now > before);
  if (!better && !worse) return null;
  return <span className={`caption-5 ${better ? "text-ok" : "text-bad"}`} aria-label={`${better ? "up" : "down"} from ${before ?? "20+"}`}>{better ? "▲" : "▼"} {before ?? "20+"}</span>;
}

/** Keyword rank at a 3x3 or 5x5 grid around the business, competitor movement, and earlier scans. */
export function RankGrid({ scans, pointsLeft, allowance, keywords = [] }: { scans: GridScan[]; pointsLeft: number; allowance: number; keywords?: string[] }) {
  const [s, action] = useActionState<GridState, FormData>(rankScanAction, {});
  const latest = scans[0];
  const previous = latest ? previousOf(scans, latest) : undefined;
  // React resets the form after every submit, which put the choices back on their first defaults and cleared the
  // phrase after an error. Keep what the owner chose and put it back after each submit.
  const [radius, setRadius] = useState(String(latest?.radiusKm ?? 3));
  const [size, setSize] = useState(String(latest ? gridSize(latest) : 3));
  const [keyword, setKeyword] = useState(latest?.keyword ?? "");
  const radiusRef = useRef<HTMLSelectElement>(null);
  const sizeRef = useRef<HTMLSelectElement>(null);
  const keywordRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (radiusRef.current) radiusRef.current.value = radius;
    if (sizeRef.current) sizeRef.current.value = size;
    if (keywordRef.current) keywordRef.current.value = keyword;
  }, [s, radius, size, keyword]);
  const n = Number(size) as GridSize;
  const points = n * n;
  const n0 = latest ? gridSize(latest) : 3;
  return (
    <div>
      <form action={action} className="flex flex-wrap items-end gap-3">
        <div className="min-w-[200px] flex-1">
          <label htmlFor="g-keyword" className="label">Search phrase</label>
          <input ref={keywordRef} id="g-keyword" name="keyword" className="field" placeholder="skin clinic" value={keyword} onChange={(e) => setKeyword(e.target.value)} required minLength={2} maxLength={80} list="g-keywords" />
          <datalist id="g-keywords">{keywords.map((k) => <option key={k} value={k} />)}</datalist>
        </div>
        <div>
          <label htmlFor="g-size" className="label">Grid</label>
          <select ref={sizeRef} id="g-size" name="size" className="field" value={size} onChange={(e) => setSize(e.target.value)}>
            <option value="3">3 x 3 (9 points)</option><option value="5">5 x 5 (25 points)</option>
          </select>
        </div>
        <div>
          <label htmlFor="g-radius" className="label">Grid spacing</label>
          <select ref={radiusRef} id="g-radius" name="radiusKm" className="field" value={radius} onChange={(e) => setRadius(e.target.value)}>
            <option value="1">1 km</option><option value="3">3 km</option><option value="5">5 km</option>
          </select>
        </div>
        <SubmitButton small pending={`Scanning ${points} points`}>Run grid scan</SubmitButton>
      </form>
      <p className="hint" data-testid="grid-cost">
        This scan makes {scanRequests(n)} Google Places requests (1 to find your business on the map, then {points} searches) and uses {points} of your daily grid points.
        {" "}{pointsLeft} of {allowance} points left in the last 24 hours, for all your locations together.
        {pointsLeft < points ? ` Not enough points left for a ${n} x ${n} scan right now.` : ""}
      </p>
      <p className="caption-2 text-muted">Positions are estimates from Google Places searches near your business. They are not Google Business Profile data, and real searchers may see different results.</p>
      <KeywordMovement scans={scans} />
      <Msg state={s} />
      {latest ? (
        <div className="mt-4">
          <p className="body-5">{series(latest)}, {new Date(latest.at).toLocaleString("en-IN")}</p>
          <div className={`mt-3 grid w-full gap-1.5 sm:gap-2 ${n0 === 5 ? "max-w-[400px] grid-cols-5" : "max-w-[300px] grid-cols-3"}`} role="img" data-testid="rank-grid" data-points={latest.ranks.length}
            aria-label={`Rank grid: ${latest.ranks.map((r) => r ?? "20+").join(", ")}, row by row from the north-west; the centre is your business`}>
            {latest.ranks.map((r, i) => {
              const centre = i === (latest.ranks.length - 1) / 2;
              return (
                <div key={i} className={`flex aspect-square min-w-0 flex-col items-center justify-center rounded-lg sm:rounded-xl ${cellClass(r)} ${centre ? "ring-2 ring-brand" : ""}`}>
                  <span className={n0 === 5 ? "title-4 sm:title-3" : "title-2"}>{r ?? "20+"}</span>
                  {centre ? <span className="caption-5">you</span> : null}
                  {previous ? <CellChange now={r} before={previous.ranks[i]} /> : null}
                </div>
              );
            })}
          </div>
          <p className="hint">North is up. Approximate: Google results change with the searcher&apos;s exact location, device and history.</p>
          {previous ? (
            <div className="inset mt-3" aria-label="Compared with the previous scan">
              <p className="title-4">Compared with {new Date(previous.at).toLocaleDateString("en-IN")} (same phrase, spacing and grid)</p>
              <ul className="caption-2 mt-1 flex flex-col gap-0.5">
                <li className={trend(top3Count(latest), top3Count(previous))}>Top 3 at {top3Count(latest)} of {latest.ranks.length} points (was {top3Count(previous)})</li>
                <li className={trend(foundCount(latest), foundCount(previous))}>In the top 20 at {foundCount(latest)} of {latest.ranks.length} points (was {foundCount(previous)})</li>
                {avg(latest) !== null && avg(previous) !== null ? <li className={trend(avg(previous)!, avg(latest)!)}>Average position {avg(latest)!.toFixed(1)} (was {avg(previous)!.toFixed(1)}; lower is better)</li> : null}
              </ul>
            </div>
          ) : scans.length ? <p className="caption-2 mt-2 text-muted">Scan the same phrase, spacing and grid again later to see the change.</p> : null}
          <GridCompetitors latest={latest} previous={previous} />
          {scans.length > 1 ? (
            <ul className="caption-2 mt-3 flex flex-col gap-1 text-muted" aria-label="Earlier scans">
              {scans.slice(1, 8).map((x) => {
                const found = x.ranks.filter((r): r is number => r !== null);
                return <li key={x.id}>{new Date(x.at).toLocaleDateString("en-IN")}: {series(x)}, in the top 20 at {found.length} of {x.ranks.length} points{found.length ? `, best #${Math.min(...found)}` : ""}</li>;
              })}
            </ul>
          ) : null}
          <GoogleMapsAttribution />
        </div>
      ) : null}
    </div>
  );
}

/**
 * The businesses most often in the top 3 across the latest grid, and how they moved since the previous scan of the
 * same series. Only place IDs and counts are stored; names are read from Google when the owner asks for them.
 */
function GridCompetitors({ latest, previous }: { latest: GridScan; previous?: GridScan }) {
  const [names, setNames] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string>();
  const [busy, setBusy] = useState(false);
  // Names are kept per place ID for this page view (never stored), so a refresh after a new scan cannot wipe them and
  // a competitor that appears in both scans keeps its name.
  if (!latest.leaders) return <p className="caption-2 mt-3 text-muted">Competitor movement is recorded for scans made from now on.</p>;
  if (!latest.leaders.length) return null;
  const movement = leaderMovement(latest, previous);
  const label = (id: string, i: number) => names[id] ?? `Competitor ${String.fromCharCode(65 + i)}`;
  const points = latest.ranks.length;
  const missing = latest.leaders.filter((l) => !names[l.id]).length;
  const show = async () => {
    setBusy(true);
    const r = await gridCompetitorNamesAction(latest.id, latest.leaders!.filter((l) => !names[l.id]).map((l) => l.id));
    setBusy(false);
    if (r.names) setNames((cur) => ({ ...cur, ...r.names }));
    setMsg(r.error);
  };
  return (
    <div className="mt-4" data-testid="grid-competitors">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="title-4">Who ranks around you</h3>
        {missing ? (
          <button type="button" className="btn btn-ghost btn-sm" onClick={show} disabled={busy} aria-busy={busy}>
            {busy ? "Loading names" : `Show names (${missing} Google request${missing === 1 ? "" : "s"})`}
          </button>
        ) : null}
      </div>
      {msg ? <p role="alert" className="field-error">{msg}</p> : null}
      <div className="mt-2 overflow-x-auto">
        <table className="caption-1 w-full min-w-[420px] text-left" aria-label="Competitors in this grid">
          <thead><tr><th className="py-1 pr-3">Business</th><th className="pr-3">Top 3 at</th><th className="pr-3">Average position</th><th>{movement ? "Since the scan before" : ""}</th></tr></thead>
          <tbody>
            {latest.leaders.map((l, i) => {
              const m = movement?.moves.find((x) => x.id === l.id);
              return (
                <tr key={l.id} className="border-t border-line" data-leader={l.id}>
                  <td className="py-1 pr-3">{label(l.id, i)}</td>
                  <td className="pr-3">{l.top3} of {points} points</td>
                  <td className="pr-3">#{l.avg} <span className="text-muted">(listed at {l.found})</span></td>
                  <td className={!m ? "text-muted" : m.change === "up" ? "text-bad" : m.change === "down" ? "text-ok" : "text-muted"}>
                    {!m ? "" : m.change === "new" ? "New in this list" : m.change === "same" ? "No change" : `${m.change === "up" ? "▲ gained" : "▼ lost"} (top 3 at ${m.before!.top3} before)`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {movement?.left.length ? <p className="caption-2 mt-1 text-muted">No longer in this list: {movement.left.length} business{movement.left.length === 1 ? "" : "es"} from the scan before.</p> : null}
      <p className="caption-5 mt-1 text-muted">From the same Google searches as the grid, so it costs nothing extra. A competitor gaining is shown in red because it pushes you down.</p>
    </div>
  );
}

/** Latest result per search phrase and spacing, with the change since the scan before it. Only real scan results. */
function KeywordMovement({ scans }: { scans: PlacesHistory["scans"] }) {
  const groups = new Map<string, PlacesHistory["scans"]>();
  for (const x of scans) {
    const k = `${x.keyword.trim().toLowerCase()}|${x.radiusKm}|${gridSize(x)}`;
    groups.set(k, [...(groups.get(k) ?? []), x]);
  }
  if (groups.size < 2 && ![...groups.values()].some((g) => g.length > 1)) return null;
  const found = (r: (number | null)[]) => r.filter((x): x is number => x !== null);
  const avg = (r: (number | null)[]) => (found(r).length ? found(r).reduce((n, x) => n + x, 0) / found(r).length : null);
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="caption-1 w-full min-w-[420px] text-left" aria-label="Movement per search phrase">
        <thead><tr className="text-muted"><th className="py-1 pr-3 font-medium">Phrase</th><th className="pr-3 font-medium">Found at</th><th className="pr-3 font-medium">Average position</th><th className="font-medium">Since the scan before</th></tr></thead>
        <tbody>
          {[...groups.values()].map((g) => {
            const [a, b] = g;
            const now = avg(a.ranks), was = b ? avg(b.ranks) : null;
            const move = now !== null && was !== null ? Math.round((was - now) * 10) / 10 : null;
            const pts = found(a.ranks).length - (b ? found(b.ranks).length : 0);
            return (
              <tr key={a.id} className="border-t border-line" data-keyword={a.keyword}>
                <td className="py-1 pr-3">&ldquo;{a.keyword}&rdquo;, {a.radiusKm} km, {gridSize(a)} x {gridSize(a)}</td>
                <td className="pr-3">{found(a.ranks).length} of {a.ranks.length} points</td>
                <td className="pr-3">{now === null ? "not in top 20" : `#${Math.round(now * 10) / 10}`}</td>
                <td className={move === null && !b ? "text-muted" : (move ?? 0) > 0 || pts > 0 ? "text-ok" : (move ?? 0) < 0 || pts < 0 ? "text-bad" : "text-muted"}>
                  {!b ? "First scan" : move === null ? (pts ? `${pts > 0 ? "+" : ""}${pts} points found` : "Not found either time") : move === 0 && !pts ? "No change" : `${move > 0 ? "▲ up" : move < 0 ? "▼ down" : "same average"} ${Math.abs(move) || ""}${pts ? `, ${pts > 0 ? "+" : ""}${pts} points found` : ""}`}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
