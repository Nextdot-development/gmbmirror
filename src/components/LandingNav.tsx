"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { CaretDown } from "@phosphor-icons/react";
import { Logo } from "./Logo";

const PLATFORM = [
  { href: "/#reviews", label: "Review replies", note: "Draft, edit and approve replies to Google reviews" },
  { href: "/#visibility", label: "AI visibility checks", note: "See whether AI assistants name your business" },
  { href: "/#posts", label: "Google posts", note: "Write posts, with a wording check for clinics" },
  { href: "/#checklist", label: "Profile checklist", note: "Fix the profile details that matter first" },
];

const LINKS = [
  { href: "/#features", label: "Features" },
  { href: "/#solutions", label: "Solutions" },
  { href: "/#pricing", label: "Pricing" },
  { href: "/#resources", label: "Resources" },
];

export function LandingNav() {
  const [open, setOpen] = useState(false);
  const [drop, setDrop] = useState(false);
  const dropRef = useRef<HTMLDivElement>(null);
  // The nav starts transparent over the light hero and turns solid once the page scrolls.
  const [top, setTop] = useState(true);
  useEffect(() => {
    const onScroll = () => setTop(window.scrollY < 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        setDrop(false);
      }
    };
    const onClick = (e: MouseEvent) => {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) setDrop(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onClick);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onClick);
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <>
      <nav className="nav-bar" aria-label="Main" data-over={top && !open}>
        <div className="mx-auto flex h-16 w-full max-w-[1200px] items-center justify-between gap-4 px-6">
          <div className="flex items-center gap-8">
            <Logo />
            <div className="hidden items-center gap-1 lg:flex">
              <div className="relative" ref={dropRef} onMouseEnter={() => setDrop(true)} onMouseLeave={() => setDrop(false)}>
                <button type="button" className="nav-link" aria-expanded={drop} aria-haspopup="true" aria-controls="platform-menu" onClick={() => setDrop((v) => !v)}>
                  Platform <CaretDown size={12} weight="bold" aria-hidden className={`transition-transform duration-300 ${drop ? "rotate-180" : ""}`} />
                </button>
                {/* The 8px gap is bridged so the pointer can travel from the button to the panel. */}
                <div className="absolute left-0 top-full h-2 w-full" aria-hidden />
                <div id="platform-menu" className={`nav-drop ${drop ? "is-open" : ""}`}>
                  {PLATFORM.map((p) => (
                    <a key={p.href} href={p.href} tabIndex={drop ? 0 : -1} onClick={() => setDrop(false)}>
                      <span className="title-4 block">{p.label}</span>
                      <span className="caption-5 block text-muted">{p.note}</span>
                    </a>
                  ))}
                </div>
              </div>
              {LINKS.map((l) => (
                <a key={l.href} href={l.href} className="nav-link">{l.label}</a>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/login" className="nav-link hidden sm:inline-flex">Sign in</Link>
            <Link href="/signup" className="btn btn-primary btn-sm hidden sm:inline-flex">Create account</Link>
            <button
              type="button"
              className="btn btn-ghost btn-sm relative z-[70] lg:hidden"
              aria-label={open ? "Close menu" : "Open menu"}
              aria-expanded={open}
              onClick={() => setOpen((v) => !v)}
            >
              <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden>
                <line className="burger-line" x1="4" x2="20" y1="8" y2="8" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
                  style={{ transform: open ? "translateY(4px) rotate(45deg)" : "none" }} />
                <line className="burger-line" x1="4" x2="20" y1="16" y2="16" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
                  style={{ transform: open ? "translateY(-4px) rotate(-45deg)" : "none" }} />
              </svg>
            </button>
          </div>
        </div>
      </nav>
      <div className={`menu-panel lg:hidden ${open ? "is-open" : ""}`} aria-hidden={!open}>
        <ul className="flex flex-col gap-5">
          {[...PLATFORM, ...LINKS, { href: "/login", label: "Sign in" }, { href: "/signup", label: "Create account" }].map((l, i) => (
            <li key={l.href} className="menu-link" style={{ transitionDelay: open ? `${Math.min(i * 50, 400)}ms` : "0ms" }}>
              <a href={l.href} className="heading-5" onClick={() => setOpen(false)} tabIndex={open ? 0 : -1}>{l.label}</a>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
