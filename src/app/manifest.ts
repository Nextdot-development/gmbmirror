import type { MetadataRoute } from "next";
import { BRAND, BRAND_TITLE } from "@/lib/brand";

/** Web app manifest: the name shown when the site is added to a phone's home screen. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: BRAND_TITLE,
    short_name: BRAND.name,
    description: "See how your business looks on Google and in AI answers, then fix what matters first.",
    start_url: "/app",
    display: "standalone",
    background_color: "#f5f8ff",
    theme_color: "#ffffff",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
