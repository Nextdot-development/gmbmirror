import Link from "next/link";
import { BRAND } from "@/lib/brand";

/** Brand mark: a blue tile with a white location pin. Colours come from the theme tokens. */
export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      <rect width="64" height="64" rx="16" fill="var(--color-brand)" />
      <path d="M32 13c-8.3 0-15 6.6-15 14.8C17 38.9 32 51 32 51s15-12.1 15-23.2C47 19.6 40.3 13 32 13Z" fill="#ffffff" />
      <circle cx="32" cy="27.5" r="5.5" fill="var(--color-brand)" />
    </svg>
  );
}

/** Text wordmark: "GMB" in the ink colour, "mirror" in brand blue, set in the display face. */
export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`font-[family-name:var(--font-display)] font-semibold tracking-[-0.02em] ${className}`}>
      GMB<span className="text-brand">mirror</span>
    </span>
  );
}

export function Logo({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="inline-flex items-center gap-2.5 text-[1.125rem] leading-6" aria-label={`${BRAND.name} home`}>
      <LogoMark />
      <Wordmark />
    </Link>
  );
}
