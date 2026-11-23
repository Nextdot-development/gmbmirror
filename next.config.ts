import type { NextConfig } from "next";

const dev = process.env.NODE_ENV !== "production";

const PDF_FILES = ["./src/assets/fonts/*.ttf", "./node_modules/harfbuzzjs/dist/*.wasm"];

/**
 * Content Security Policy. Everything loads from this site only; the browser never talks to Google,
 * Supabase or an AI provider directly (those calls are made by the server).
 * 'unsafe-inline' stays on scripts because Next.js writes inline scripts to start the page. Removing it
 * needs per-request nonces, which would make every page dynamic. Dev mode also needs eval and a websocket.
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self'${dev ? " ws: wss:" : ""}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()" },
  // Browsers only act on this over https, so it is harmless on http://localhost.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

const config: NextConfig = {
  poweredByHeader: false,
  // The project folder is the workspace root. Without this, a package-lock.json higher up (for example in the home
  // folder) makes Next.js warn and guess the root.
  turbopack: { root: __dirname },
  // HarfBuzz (PDF text shaping for Hindi) loads its WebAssembly file from its own package folder, so it is not bundled.
  serverExternalPackages: ["harfbuzzjs"],
  // Files read at run time that a serverless deployment (Vercel) must ship with every function that makes a report
  // PDF: the download route, the reports page ("Email me this report") and the job runner (monthly report emails).
  outputFileTracingIncludes: {
    "/app/reports/[id]/pdf": PDF_FILES,
    "/app/reports": PDF_FILES,
    "/api/jobs/run": PDF_FILES,
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default config;
