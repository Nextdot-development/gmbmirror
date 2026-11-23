/**
 * Facts the legal pages state about the operator. Only confirmed facts go here: a value left undefined is not shown
 * (the page uses neutral wording instead), so nothing is invented. See docs/COMPLIANCE_AUDIT.md for the open items.
 */
export const LEGAL: {
  /** Date the legal pages were last changed (shown on each page). */
  updated: string;
  /** Legal name of the person or company that operates GMBmirror. */
  operator?: string;
  /** Postal address for legal notices. */
  address?: string;
  /** Governing law and courts, for example "the laws of India; courts of Bhubaneswar, Odisha". */
  governingLaw?: string;
} = {
  updated: "21 November 2026",
};

/** The public trust pages, in menu order. */
export const TRUST_PAGES = [
  { href: "/about", label: "About" },
  { href: "/privacy", label: "Privacy policy" },
  { href: "/terms", label: "Terms of service" },
  { href: "/cookies", label: "Cookie policy" },
  { href: "/data-deletion", label: "Data deletion" },
  { href: "/security", label: "Security" },
  { href: "/contact", label: "Contact" },
] as const;
