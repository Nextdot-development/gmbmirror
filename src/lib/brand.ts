/**
 * The product's public identity, in one place. Every page, title, share image, report and legal page reads it.
 * Internal identifiers (package name, storage keys, cookie names, environment variable names) are not renamed.
 */
export const BRAND = {
  name: "GMBmirror",
  tagline: "AI-Powered Google Business Profile Growth Platform",
  /** Public contact and support address. Shown as a mailto link; this app does not send email. */
  email: "gmbmirror@gmail.com",
} as const;

export const BRAND_TITLE = `${BRAND.name} — ${BRAND.tagline}`;
