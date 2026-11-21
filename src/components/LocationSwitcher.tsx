"use client";
import { useRef } from "react";
import Link from "next/link";
import { switchLocationAction } from "@/app/actions";

/** Which business location the app shows. Changing it submits straight away; without JavaScript, press Switch. */
export function LocationSwitcher({ locations, active }: { locations: { id: string; name: string }[]; active: string }) {
  const ref = useRef<HTMLFormElement>(null);
  return (
    <div className="flex flex-col gap-1 px-1 md:px-2">
      <form ref={ref} action={switchLocationAction} className="flex items-center gap-2">
        <label htmlFor="loc-switch" className="sr-only">Business location</label>
        <select id="loc-switch" name="loc" defaultValue={active} className="field !py-1.5 text-sm" onChange={() => ref.current?.requestSubmit()}>
          {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
        <noscript><button type="submit" className="btn btn-secondary btn-sm">Switch</button></noscript>
      </form>
      <Link href="/app/locations" className="caption-2 text-brand underline-offset-2 hover:underline">All locations</Link>
    </div>
  );
}
