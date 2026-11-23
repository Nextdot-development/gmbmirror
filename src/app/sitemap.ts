import type { MetadataRoute } from "next";
import { TRUST_PAGES } from "@/lib/legal";

/** Public pages only; the app itself (/app) needs a sign-in and is not listed. */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/+$/, "");
  return ["/", ...TRUST_PAGES.map((p) => p.href), "/signup", "/login"].map((p) => ({ url: `${base}${p === "/" ? "" : p}`, changeFrequency: "monthly" as const, priority: p === "/" ? 1 : 0.5 }));
}
