"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { MagnifyingGlass, MapPin } from "@phosphor-icons/react";
import { lookupPlaceAction, renameBusinessAction, savePlaceIdAction, searchPlacesAction } from "@/app/actions";
import type { DiscoveryMatch } from "@/lib/discovery";
import type { PlaceSummary } from "@/lib/places";
import { GoogleMapsAttribution } from "./Places";

type Listing = Partial<PlaceSummary> & { id: string };

const MATCH_LABEL: Record<DiscoveryMatch["match"], { t: string; c: string }> = {
  exact: { t: "Same name", c: "badge-ok" },
  close: { t: "Similar name", c: "badge-warn" },
  different: { t: "Different name", c: "" },
};

/**
 * Find the business's public Google listing by name and city, and link it (only the Place ID is kept). The choice is
 * saved straight away. This reads public data only: it does not connect, verify or prove ownership of a Business
 * Profile. Nothing is chosen automatically, and replacing a saved listing always asks first.
 */
export function BusinessFinder({
  initialId, placesOn, defaultName = "", defaultCity = "",
}: {
  /** The listing saved for the business, if any. */
  initialId?: string;
  placesOn: boolean; defaultName?: string; defaultCity?: string;
}) {
  const [saved, setSaved] = useState<string | undefined>(initialId || undefined); // the listing on record
  const [selected, setSelected] = useState<Listing | null>(initialId ? { id: initialId } : null);
  const [searching, setSearching] = useState(!initialId);
  const [matches, setMatches] = useState<DiscoveryMatch[]>([]);
  const [msg, setMsg] = useState<{ text: string; kind: "error" | "ok" }>();
  const [note, setNote] = useState<string>();
  // Typed entry is open when Google cannot be searched.
  const [manual, setManual] = useState(!placesOn);
  const [manualId, setManualId] = useState(!placesOn ? (initialId ?? "") : "");
  // A choice waiting for "Replace listing", remembering whether it is to be saved without a Google check.
  const [pendingPick, setPendingPick] = useState<{ p: Listing; force: boolean } | null>(null);
  // Offered only when Google could not be reached (never when Google says the place does not exist).
  const [force, setForce] = useState<Listing | null>(null);
  const [suggestName, setSuggestName] = useState<string>();
  const [pending, start] = useTransition();
  const [searchName, setSearchName] = useState(defaultName);
  const [searchCity, setSearchCity] = useState(defaultCity);
  const [state, setState] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const [currentName, setCurrentName] = useState(defaultName);

  // Show the saved listing's name and address, fetched fresh from Google (they are not stored).
  useEffect(() => {
    if (!initialId || !placesOn) return;
    let live = true;
    lookupPlaceAction(initialId).then((r) => live && r.place && setSelected(r.place));
    return () => { live = false; };
  }, [initialId, placesOn]);

  function search() {
    const name = searchName;
    const city = searchCity;
    setMsg(undefined);
    setNote(undefined);
    setMatches([]);
    start(async () => {
      const r = await searchPlacesAction(name, city, state);
      setMatches(r.matches ?? []);
      setNote(r.note);
      if (r.error) setMsg({ text: r.error, kind: "error" });
    });
  }

  /** The owner chose a listing. Replacing a different saved one needs confirmation first. */
  function pick(p: Listing, unchecked = false) {
    setForce(null);
    if (saved && p.id !== saved) return setPendingPick({ p, force: unchecked });
    apply(p, false, unchecked);
  }

  function apply(p: Listing, replace: boolean, unchecked: boolean) {
    setPendingPick(null);
    const googleName = p.name?.split(/\s[|–—-]\s/)[0];
    // A different name on Google is offered, never applied by itself.
    setSuggestName(googleName && googleName.trim().toLowerCase() !== currentName.trim().toLowerCase() ? googleName : undefined);
    start(async () => {
      const r = await savePlaceIdAction(p.id, { replace, force: unchecked });
      if (r.needsConfirm) return setPendingPick({ p, force: unchecked });
      if (r.error) {
        setMsg({ text: r.error, kind: "error" });
        if (r.canForce) setForce(p);
        return;
      }
      setSaved(p.id);
      setSelected(r.place ?? p);
      setSearching(false);
      setManual(false);
      setMatches([]);
      setForce(null);
      setMsg({ text: r.ok ?? "Saved.", kind: "ok" });
    });
  }

  /** A typed Place ID: checked with Google when possible, then chosen like a search result. */
  function useManual() {
    const id = manualId.trim();
    setMsg(undefined);
    setForce(null);
    if (!placesOn) return pick({ id });
    start(async () => {
      const r = await lookupPlaceAction(id);
      if (r.place) return pick(r.place);
      setMsg({ text: r.error ?? "Google could not be checked.", kind: "error" });
      if (!r.notFound && /^[A-Za-z0-9_-]{10,300}$/.test(id)) setForce({ id });
    });
  }

  const current = selected && !searching ? selected : null;

  return (
    <div ref={ref} className="flex flex-col gap-3" data-testid="business-finder">
      {current ? (
        <div className="inset" aria-label="Your Google listing">
          <p className="caption-1 text-muted">Your Google listing</p>
          <p className="title-3 mt-1 flex items-start gap-2"><MapPin size={18} className="mt-1 shrink-0 text-accent" aria-hidden />{current.name ?? "Listing saved"}</p>
          {current.address ? <p className="body-6 text-muted">{current.address}</p> : null}
          {current.type ? <p className="caption-2 text-muted">{current.type}</p> : null}
          {!current.name ? <p className="caption-2 text-muted break-all">Place ID {current.id}</p> : null}
          <p className="caption-2 mt-2 text-muted">
            This lets the app read your public Google listing. It does not verify or connect your Google Business Profile.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {placesOn ? <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setSearching(true); setMsg(undefined); }}>Change listing</button> : null}
            {suggestName ? (
              <button type="button" className="btn btn-ghost btn-sm" disabled={pending} onClick={() => start(async () => {
                const r = await renameBusinessAction(suggestName);
                if (r.error) return setMsg({ text: r.error, kind: "error" });
                setCurrentName(suggestName);
                setSuggestName(undefined);
                setMsg({ text: r.ok!, kind: "ok" });
              })}>Use “{suggestName}” as the business name</button>
            ) : null}
          </div>
          {current.name ? <GoogleMapsAttribution /> : null}
        </div>
      ) : null}

      {searching && placesOn ? (
        <div className="inset flex flex-col gap-3" aria-label="Find your business on Google">
          <p className="title-4">Find your business on Google</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div><label htmlFor="find-name" className="label">Business name</label><input id="find-name" className="field" value={searchName} onChange={(e) => setSearchName(e.target.value)} /></div>
            <div><label htmlFor="find-city" className="label">City or area</label><input id="find-city" className="field" value={searchCity} onChange={(e) => setSearchCity(e.target.value)} /></div>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-0 flex-1">
              <label htmlFor="f-state" className="label">State (optional)</label>
              <input id="f-state" className="field" value={state} onChange={(e) => setState(e.target.value)} placeholder="Maharashtra" />
            </div>
            <button type="button" className="btn btn-primary" onClick={search} disabled={pending}>
              <MagnifyingGlass size={16} aria-hidden /> {pending ? "Searching Google" : "Find my business"}
            </button>
          </div>
          {matches.length ? (
            <div>
              {note ? <p className="body-6 mb-2 text-warn" data-testid="finder-note">{note}</p> : null}
              {/* Chains often name each branch differently ("… in FC Road", "… in Kothrud"), so prompt whenever several match. */}
              {matches.filter((m) => m.match !== "different").length > 1 ? (
                <p className="body-6 mb-2" data-testid="finder-branches">Several listings match your search. Check the address to pick the right branch.</p>
              ) : null}
              <ul className="flex flex-col gap-2" aria-label="Matches on Google">
                {matches.map((m) => (
                  <li key={m.id} className="card flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="title-4">{m.name}</p>
                      {m.address ? <p className="caption-2 text-muted">{m.address}</p> : null}
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        {m.type ? <span className="caption-2 text-muted">{m.type}</span> : null}
                        <span className={`badge ${MATCH_LABEL[m.match].c}`}>{MATCH_LABEL[m.match].t}</span>
                        {m.branch ? <span className="caption-2 text-warn">Same name as another result: check the address</span> : null}
                      </div>
                    </div>
                    <button type="button" className="btn btn-secondary btn-sm shrink-0" onClick={() => pick(m)} disabled={pending} aria-label={`Select ${m.name}${m.address ? `, ${m.address}` : ""}`}>Select</button>
                  </li>
                ))}
              </ul>
              <p className="hint">Not your business? Try a different spelling, a nearby area, add the state, or enter the Place ID manually.</p>
              <GoogleMapsAttribution />
            </div>
          ) : null}
          {selected ? <button type="button" className="btn btn-ghost btn-sm w-fit" onClick={() => { setSearching(false); setMatches([]); setMsg(undefined); setPendingPick(null); }}>Keep my current listing</button> : null}
        </div>
      ) : null}

      {pendingPick ? (
        <div className="inset border-warn" role="alertdialog" aria-label="Replace your Google listing?">
          <p className="title-4">Replace your Google listing?</p>
          <p className="body-6 mt-1">New listing: <strong>{pendingPick.p.name ?? pendingPick.p.id}</strong>{pendingPick.p.address ? `, ${pendingPick.p.address}` : ""}</p>
          <p className="caption-2 mt-1 text-muted">Your business details, earlier audits, scans and recommendations are kept. New checks will use the new listing.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className="btn btn-primary btn-sm" onClick={() => apply(pendingPick.p, true, pendingPick.force)} disabled={pending}>Replace listing</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPendingPick(null)}>Cancel</button>
          </div>
        </div>
      ) : null}

      {msg ? <p role={msg.kind === "error" ? "alert" : "status"} className={msg.kind === "error" ? "field-error" : "body-6 text-ok"}>{msg.text}</p> : null}
      {force ? (
        <button type="button" className="btn btn-ghost btn-sm w-fit" onClick={() => pick(force, true)} disabled={pending}>
          Save without checking
        </button>
      ) : null}

      {placesOn && !manual ? (
        <button type="button" className="btn btn-ghost btn-sm w-fit !px-0 underline" onClick={() => { setManual(true); setMsg(undefined); }}>Enter Place ID manually</button>
      ) : null}
      {manual ? (
        <div>
          <label htmlFor="f-placeId" className="label">Google Place ID</label>
          <div className="flex flex-wrap gap-2">
            <input id="f-placeId" className="field min-w-0 flex-1" value={manualId} onChange={(e) => setManualId(e.target.value)}
              aria-describedby="f-placeId-h" placeholder="ChIJ…" />
            <button type="button" className="btn btn-secondary btn-sm" onClick={useManual} disabled={pending || manualId.trim().length < 2}>Use this ID</button>
          </div>
          <p id="f-placeId-h" className="hint">
            {placesOn ? "Only if the search cannot find you. The ID is checked with Google before it is used." : "Searching Google is not available right now. Paste your Place ID if you know it."}
          </p>
          {placesOn ? <button type="button" className="btn btn-ghost btn-sm mt-1 !px-0 underline" onClick={() => { setManual(false); setManualId(""); }}>Search by name instead</button> : null}
        </div>
      ) : null}
    </div>
  );
}
