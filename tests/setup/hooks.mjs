// Module resolution for tests only:
//  - "@/..."        -> src/...          (the tsconfig path alias)
//  - "server-only"  -> empty module     (it throws outside the Next.js server on purpose)
//  - extensionless imports             -> try ".ts" (app files) or ".js" (package subpaths like next/headers)
const SRC = new URL("../../src/", import.meta.url);

export async function resolve(specifier, context, next) {
  if (specifier === "server-only") return { url: "data:text/javascript,export {}", shortCircuit: true };
  if (specifier.startsWith("@/")) specifier = new URL(specifier.slice(2), SRC).href;
  try {
    return await next(specifier, context);
  } catch (err) {
    if (/\.[cm]?[jt]sx?$/.test(specifier)) throw err;
    const local = specifier.startsWith(".") || specifier.startsWith("file:");
    // App files are .ts; package subpaths such as "next/headers" ship as .js.
    return next(`${specifier}${local ? ".ts" : ".js"}`, context);
  }
}
