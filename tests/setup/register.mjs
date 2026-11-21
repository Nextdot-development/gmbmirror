// Lets `node --test` import the app's TypeScript files directly (Node 22.18+ strips types natively).
// No test framework or extra dependency is needed. See tests/README.md.
import { register } from "node:module";
register("./hooks.mjs", import.meta.url);
