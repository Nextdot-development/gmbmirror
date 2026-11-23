"use client";
import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Gauge, MapPinArea, ChatCircleText, Megaphone, MagnifyingGlass, ListChecks, GearSix, CaretRight, Storefront, FileText } from "@phosphor-icons/react";

const ITEMS = [
  { href: "/app", label: "Dashboard", icon: Gauge },
  { href: "/app/google-profile", label: "Google profile", icon: MapPinArea },
  { href: "/app/reviews", label: "Reviews", icon: ChatCircleText },
  { href: "/app/posts", label: "Posts", icon: Megaphone },
  { href: "/app/ai-visibility", label: "AI visibility", icon: MagnifyingGlass },
  { href: "/app/chatgpt-guide", label: "ChatGPT guide", icon: ListChecks },
  { href: "/app/reports", label: "Reports", icon: FileText },
  { href: "/app/locations", label: "Locations", icon: Storefront },
  { href: "/app/settings", label: "Settings", icon: GearSix },
];

/** A small pulsing dot on the link just clicked, until its page is on screen (feedback within a frame). */
function Pending() {
  const { pending } = useLinkStatus();
  return <span aria-hidden className={`ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-brand transition-opacity duration-150 ${pending ? "animate-pulse opacity-100" : "opacity-0"}`} />;
}

export function AppNav() {
  const path = usePathname();
  const ref = useRef<HTMLElement>(null);
  // On phones the nav is one sideways-scrolling row. Show a fade and arrow while more items are off-screen.
  const [more, setMore] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setMore(el.scrollWidth - el.clientWidth - el.scrollLeft > 4);
    update();
    el.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      el.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);
  return (
    <div className="relative">
    <nav ref={ref} aria-label="App" className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 md:mx-0 md:flex-col md:overflow-visible md:p-0">
      {ITEMS.map((i) => {
        // Its own page or a page under it (/app/reports/…), never a neighbour that only shares the prefix.
        const active = path === i.href || (i.href !== "/app" && path.startsWith(`${i.href}/`));
        return (
          <Link key={i.href} href={i.href} aria-current={active ? "page" : undefined}
            className="side-link">
            <i.icon size={18} weight={active ? "fill" : "regular"} className="shrink-0" aria-hidden /> {i.label}
            <Pending />
          </Link>
        );
      })}
    </nav>
    <div aria-hidden className={`pointer-events-none absolute bottom-1 right-0 top-0 flex w-12 items-center justify-end text-brand transition-opacity duration-300 md:hidden ${more ? "opacity-100" : "opacity-0"}`}
      style={{ background: "linear-gradient(to left, var(--color-surface) 45%, transparent)" }}>
      <CaretRight size={16} weight="bold" />
    </div>
    </div>
  );
}
