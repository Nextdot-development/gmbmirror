import { test } from "node:test";
import assert from "node:assert/strict";
import { clientKeyFrom, LIMITS, take, trustedProxyHops, UNTRUSTED_CLIENT } from "@/lib/ratelimit";
import { configProblems } from "@/lib/env";

test("no trusted proxy: nothing in X-Forwarded-For is trusted, every request shares one bucket", () => {
  for (const h of [null, "", "203.0.113.5", "1.1.1.1, 2.2.2.2", "garbage"]) assert.equal(clientKeyFrom(h, 0), UNTRUSTED_CLIENT);
});

test("one trusted proxy: the right-most entry is used; entries the client added on the left are ignored", () => {
  assert.equal(clientKeyFrom("198.51.100.7", 1), "198.51.100.7");
  assert.equal(clientKeyFrom("1.2.3.4, 5.6.7.8, 198.51.100.7", 1), "198.51.100.7");
  assert.equal(clientKeyFrom("  9.9.9.9 ,198.51.100.7  ", 1), "198.51.100.7");
});

test("two trusted proxies: the second entry from the right is the client", () => {
  assert.equal(clientKeyFrom("6.6.6.6, 198.51.100.7, 10.0.0.2", 2), "198.51.100.7");
  // Fewer entries than proxies means the request skipped a proxy: not trusted.
  assert.equal(clientKeyFrom("198.51.100.7", 2), UNTRUSTED_CLIENT);
});

test("spoofed requests behind a proxy all land in the real client's bucket", () => {
  const keys = new Set(Array.from({ length: 50 }, (_, i) => clientKeyFrom(`10.0.${i}.1, 172.16.${i}.9, 198.51.100.7`, 1)));
  assert.deepEqual([...keys], ["198.51.100.7"]);
  const k = `signup:ip:${[...keys][0]}:${Date.now()}`;
  const n = LIMITS.signupPerIp.limit;
  const results = Array.from({ length: n + 1 }, () => take(k, LIMITS.signupPerIp).ok);
  assert.deepEqual(results, [...Array(n).fill(true), false]);
});

test("anything that is not an IP address is not trusted", () => {
  for (const h of ["unknown", "evil.example", "1.2.3", "999.1.1.1", "<script>", "1.2.3.4 5.6.7.8"]) assert.equal(clientKeyFrom(h, 1), UNTRUSTED_CLIENT, h);
});

test("addresses are normalised: ports, IPv4-mapped IPv6, and IPv6 grouped by /64", () => {
  assert.equal(clientKeyFrom("198.51.100.7:51234", 1), "198.51.100.7");
  assert.equal(clientKeyFrom("::ffff:198.51.100.7", 1), "198.51.100.7");
  assert.equal(clientKeyFrom("2001:db8:abcd:12:1::5", 1), "2001:db8:abcd:12::/64");
  assert.equal(clientKeyFrom("[2001:0db8:abcd:0012:ffff:ffff:ffff:ffff]:443", 1), "2001:db8:abcd:12::/64");
  assert.equal(clientKeyFrom("2001:db8::1", 1), "2001:db8:0:0::/64");
  assert.equal(clientKeyFrom("fe80::1%eth0", 1), "fe80:0:0:0::/64");
});

test("TRUSTED_PROXY_HOPS parsing", () => {
  assert.equal(trustedProxyHops("0"), 0);
  assert.equal(trustedProxyHops(" 2 "), 2);
  assert.equal(trustedProxyHops("10"), 10);
  for (const v of [undefined, "", "-1", "11", "1.5", "yes", "true"]) assert.equal(trustedProxyHops(v), undefined, String(v));
});

test("startup check: production must set TRUSTED_PROXY_HOPS; invalid values are refused anywhere", () => {
  const base = { APP_MODE: "demo", ALLOW_DEMO_IN_PRODUCTION: "true", SESSION_SECRET: "x".repeat(40) };
  const hopsProblems = (e: Record<string, string>) => configProblems({ ...base, ...e } as unknown as NodeJS.ProcessEnv).filter((p) => p.includes("TRUSTED_PROXY_HOPS"));
  assert.equal(hopsProblems({ NODE_ENV: "production" }).length, 1);
  assert.equal(hopsProblems({ NODE_ENV: "production", TRUSTED_PROXY_HOPS: "1" }).length, 0);
  assert.equal(hopsProblems({ NODE_ENV: "production", TRUSTED_PROXY_HOPS: "0" }).length, 0);
  assert.equal(hopsProblems({ NODE_ENV: "development" }).length, 0);
  assert.equal(hopsProblems({ NODE_ENV: "development", TRUSTED_PROXY_HOPS: "all" }).length, 1);
});

test("Supabase mode accepts the publishable key or the legacy anon key, and needs DATABASE_URL", () => {
  const base = { APP_MODE: "supabase", SESSION_SECRET: "s".repeat(40), NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co" };
  const p = (e: Record<string, string>) => configProblems({ ...base, ...e } as unknown as NodeJS.ProcessEnv);
  const db = { DATABASE_URL: "postgresql://u:p@db.example.com:6543/postgres" };
  assert.deepEqual(p({ ...db, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_x" }), []);
  assert.deepEqual(p({ ...db, NEXT_PUBLIC_SUPABASE_ANON_KEY: "eyJ" }), []);
  assert.ok(p(db).some((x) => x.includes("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY")));
  assert.ok(p({ NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "k" }).some((x) => x.startsWith("DATABASE_URL is required")));
  assert.ok(p({ NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "k", DATABASE_URL: "mysql://x" }).some((x) => x.includes("must start with postgresql://")));
});

test("demo mode can never run on Vercel, even with ALLOW_DEMO_IN_PRODUCTION", () => {
  const e = (x: Record<string, string>) => configProblems({ APP_MODE: "demo", SESSION_SECRET: "s".repeat(40), NODE_ENV: "production", TRUSTED_PROXY_HOPS: "1", ALLOW_DEMO_IN_PRODUCTION: "true", ...x } as unknown as NodeJS.ProcessEnv);
  assert.deepEqual(e({}), [], "a production build on your own machine may still opt in");
  assert.ok(e({ VERCEL: "1" })[0].includes("cannot run on Vercel"));
  assert.ok(e({ VERCEL_ENV: "preview" })[0].includes("cannot run on Vercel"));
});

test("DATABASE_URL structure: a value cut short, unencoded special characters or another project are refused at startup, without repeating the value", async () => {
  const { configProblems, databaseUrlProblem } = await import("@/lib/env");
  const H = "aws-1-ap-southeast-2.pooler.supabase.com";
  const SB = "https://abcdefghijklmnopqrst.supabase.co";
  const ok = `postgresql://postgres.abcdefghijklmnopqrst:S3cret-pass@${H}:6543/postgres`;
  assert.equal(databaseUrlProblem(ok, SB), undefined);
  assert.equal(databaseUrlProblem(`postgresql://postgres.abcdefghijklmnopqrst:[S3cret-pass]@${H}:6543/postgres`, SB), undefined, "brackets in the password are read correctly");
  assert.equal(databaseUrlProblem("postgresql://postgres@127.0.0.1:5432/gmb", SB), undefined, "local test databases have no password");
  // The production failure of 21 November: "getaddrinfo ENOTFOUND postgres." from a value with no user:password@host.
  assert.match(databaseUrlProblem("postgresql://postgres.", SB)!, /looks cut short/);
  assert.match(databaseUrlProblem(`postgresql://postgres.abcdefghijklmnopqrst:ab/cd@${H}:6543/postgres`, SB)!, /must be URL-encoded/);
  assert.match(databaseUrlProblem(`postgresql://postgres.abcdefghijklmnopqrst@${H}:6543/postgres`, SB)!, /no password/);
  assert.match(databaseUrlProblem(`postgresql://postgres.otherprojectref00000:pw@${H}:6543/postgres`, SB)!, /different Supabase project/);
  const all = configProblems({ APP_MODE: "supabase", SESSION_SECRET: "s".repeat(40), NEXT_PUBLIC_SUPABASE_URL: SB, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "k", DATABASE_URL: "postgresql://postgres.secretpart:hunter2-pass/x@h" } as unknown as NodeJS.ProcessEnv);
  assert.ok(all.some((p) => p.startsWith("DATABASE_URL")));
  assert.ok(!all.join(" ").includes("hunter2") && !all.join(" ").includes("secretpart"), "the value is never repeated");
});

test("startup warnings: a Google redirect URI for another address, and an unused Supabase admin key (values never repeated)", async () => {
  const { configWarnings } = await import("@/lib/env");
  const base = { NODE_ENV: "production", NEXT_PUBLIC_APP_URL: "https://gmbmirror.vercel.app" } as unknown as NodeJS.ProcessEnv;
  assert.deepEqual(configWarnings({ ...base, GOOGLE_REDIRECT_URI: "https://gmbmirror.vercel.app/api/google/callback" }), []);
  const w = configWarnings({ ...base, GOOGLE_REDIRECT_URI: "http://localhost:3000/api/google/callback", SUPABASE_SERVICE_ROLE_KEY: "eyJsecret" });
  assert.equal(w.length, 2);
  assert.ok(w[0].startsWith("GOOGLE_REDIRECT_URI") && w[1].startsWith("SUPABASE_SERVICE_ROLE_KEY"));
  assert.ok(!w.join(" ").includes("localhost") && !w.join(" ").includes("eyJsecret"));
});
