import { Logo } from "@/components/Logo";
import { AppNav } from "@/components/AppNav";
import { logOutAction } from "@/app/actions";
import { requireUser } from "@/lib/session";
import { db } from "@/lib/store";
import { locationsOf } from "@/lib/ctx";
import { LocationSwitcher } from "@/components/LocationSwitcher";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const idx = await locationsOf(user.id);
  // Names come from each location's own business details (one query); a location still in onboarding is shown as new.
  const names = idx.ids.length > 1 ? await db.getBusinessNames(user.id, idx.ids) : {};
  const locations = idx.ids.map((id, i) => ({ id, name: names[id] ?? `New location ${i + 1}` }));
  return (
    <div className="min-h-screen md:grid md:grid-cols-[232px_minmax(0,1fr)]">
      <aside className="flex flex-col gap-3 border-b border-line bg-surface px-4 py-3 md:sticky md:top-0 md:h-screen md:gap-6 md:border-b-0 md:border-r md:px-3 md:py-5">
        <div className="px-1 md:px-2">
          {/* The brand leads to the public home page; "Dashboard" in the menu leads to /app. */}
          <Logo href="/" />
        </div>
        {locations.length > 1 ? <LocationSwitcher locations={locations} active={idx.active} /> : null}
        <AppNav />
        <div className="mt-auto hidden flex-col items-start gap-1 border-t border-line px-2 pt-4 md:flex">
          <p className="caption-5 w-full truncate text-muted" title={user.email}>{user.email}</p>
          <form action={logOutAction}><button className="side-link -ml-2.5 cursor-pointer" type="submit">Log out</button></form>
        </div>
      </aside>
      <div className="min-w-0 px-4 py-6 sm:px-6 md:py-8 lg:px-10">
        <main id="main" className="w-full max-w-[1320px]">{children}</main>
        {/* The email can be long; it is shortened with … so the page never gets wider than the phone screen. */}
        <form action={logOutAction} className="mt-8 md:hidden">
          <button className="btn btn-ghost btn-sm max-w-full" type="submit" title={user.email}><span className="min-w-0 truncate">Log out ({user.email})</span></button>
        </form>
      </div>
    </div>
  );
}
