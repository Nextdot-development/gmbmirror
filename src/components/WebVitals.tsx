"use client";
import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { useReportWebVitals } from "next/web-vitals";

/**
 * Sends page-speed measurements to /api/vitals: Web Vitals (LCP, INP, CLS, FCP, TTFB) and "NAV", the time from a
 * click on an in-app link to the new page being on screen. Only the metric, its value, its rating and the route
 * pattern are sent (IDs and query strings are removed): nothing about the person or their business.
 */
const route = (p: string) => p.replace(/\/[0-9a-f-]{8,}(?=\/|$)/gi, "/[id]").slice(0, 80);

function send(name: string, value: number, rating?: string) {
  const body = JSON.stringify({ name, value: Math.round(name === "CLS" ? value * 1000 : value), rating, route: route(location.pathname) });
  try {
    if (!navigator.sendBeacon?.("/api/vitals", new Blob([body], { type: "application/json" }))) {
      void fetch("/api/vitals", { method: "POST", body, keepalive: true, headers: { "content-type": "application/json" } });
    }
  } catch {
    /* measurements are optional */
  }
}

const report = (m: { name: string; value: number; rating?: string }) => send(m.name, m.value, m.rating);

export function WebVitals() {
  useReportWebVitals(report);
  const path = usePathname();
  const clickedAt = useRef<number | null>(null);
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement | null)?.closest?.("a[href^='/']");
      if (a && !e.defaultPrevented && e.button === 0 && !e.metaKey && !e.ctrlKey) clickedAt.current = performance.now();
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);
  useEffect(() => {
    if (clickedAt.current === null) return;
    const started = clickedAt.current;
    clickedAt.current = null;
    // Measured when the new page has painted.
    requestAnimationFrame(() => setTimeout(() => send("NAV", performance.now() - started), 0));
  }, [path]);
  return null;
}
