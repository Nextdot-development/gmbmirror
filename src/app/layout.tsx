import type { Metadata, Viewport } from "next";
import { DM_Sans, Outfit } from "next/font/google";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
import { BRAND, BRAND_TITLE } from "@/lib/brand";

const dmSans = DM_Sans({ subsets: ["latin"], variable: "--font-dm-sans", display: "swap" });
// Headings: a geometric display face; body text stays DM Sans.
const outfit = Outfit({ subsets: ["latin"], variable: "--font-outfit", display: "swap", weight: ["500", "600", "700"] });

const url = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(url),
  applicationName: BRAND.name,
  title: { default: BRAND_TITLE, template: `%s | ${BRAND.name}` },
  description:
    "Connect your Google Business Profile, reply to reviews faster, and check whether ChatGPT and Gemini name your clinic or business. Built for doctors and local businesses.",
  openGraph: {
    title: BRAND_TITLE,
    description: "See how your business looks on Google and in AI answers, then fix what matters first.",
    type: "website",
    siteName: BRAND.name,
  },
  twitter: { card: "summary_large_image", title: BRAND_TITLE, description: "See how your business looks on Google and in AI answers." },
};

export const viewport: Viewport = { themeColor: "#ffffff", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${dmSans.variable} ${outfit.variable} ${GeistMono.variable}`}>
      <body>
        <a href="#main" className="skip-link button-sm">
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
