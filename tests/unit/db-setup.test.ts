import { test } from "node:test";
import assert from "node:assert/strict";
import { X509Certificate, createHash } from "node:crypto";
import { SUPABASE_ROOT_CA, connectionString, isSupabaseHost, sslFor } from "@/lib/db-ssl";
// @ts-expect-error: a plain JavaScript script, run by operators with node
import { envLocalContent, normalise } from "../../scripts/setup-database.mjs";

// The database connection: Supabase's CA is built in, so no certificate has to be configured, and TLS is always verified.

test("the built-in Supabase root certificate is the published one (fingerprint) and still valid", () => {
  const c = new X509Certificate(SUPABASE_ROOT_CA);
  assert.match(c.subject, /CN=Supabase Root 2021 CA/);
  assert.equal(c.fingerprint256, "80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA");
  assert.ok(c.ca && new Date(c.validTo) > new Date());
  assert.equal(createHash("sha256").update(c.raw).digest("hex").length, 64);
});

test("TLS: none for local databases, the built-in CA for Supabase, the system list elsewhere; always verified", () => {
  assert.equal(sslFor("127.0.0.1", {}), false);
  assert.equal(sslFor("localhost", {}), false);
  assert.deepEqual(sslFor("aws-0-ap-south-1.pooler.supabase.com", {}), { rejectUnauthorized: true, ca: SUPABASE_ROOT_CA });
  assert.deepEqual(sslFor("db.abcdefghijklmnopqrst.supabase.co", {}), { rejectUnauthorized: true, ca: SUPABASE_ROOT_CA });
  assert.deepEqual(sslFor("db.example.com", {}), { rejectUnauthorized: true });
  const pem = "-----BEGIN CERTIFICATE-----\\nMIIB\\n-----END CERTIFICATE-----";
  assert.deepEqual(sslFor("db.example.com", { DATABASE_CA_CERT: pem }), { rejectUnauthorized: true, ca: pem.replace(/\\n/g, "\n") }, "an explicit CA still wins");
  assert.deepEqual(sslFor("aws-0-x.pooler.supabase.com", { DATABASE_CA_CERT: "put-the-cert-here" }), { rejectUnauthorized: true, ca: SUPABASE_ROOT_CA }, "a value that is not a certificate is ignored");
  assert.ok(!isSupabaseHost("supabase.com.evil.example") && !isSupabaseHost("evilsupabase.com"));
});

test("TLS options in the URL cannot weaken verification", () => {
  const { url, host } = connectionString("postgresql://u:p@aws-0-x.pooler.supabase.com:6543/postgres?sslmode=no-verify&supa=base-pooler.x&application_name=a");
  assert.equal(host, "aws-0-x.pooler.supabase.com");
  assert.ok(!url.includes("sslmode") && !url.includes("supa=") && url.includes("application_name=a"));
});

const REF = "abcdefghijklmnopqrst";
const POOLER = "aws-0-ap-south-1.pooler.supabase.com";
/** Answers the password prompt and records that it was asked, and whether Enter-to-keep was offered. */
const answer = (reply: string) => {
  const asked: string[] = [];
  const ask = async (q: string, o?: { hidden?: boolean }) => { assert.equal(o?.hidden, true, "password input is hidden"); asked.push(q); return reply; };
  return { ask, asked };
};

test("setup: the dashboard string with [YOUR-PASSWORD] requires the password and encodes special characters", async () => {
  const a = answer("p@ss/w#rd$1'\"");
  const s = await normalise(`postgresql://postgres.${REF}:[YOUR-PASSWORD]@${POOLER}:6543/postgres`, REF, a.ask);
  assert.equal(a.asked.length, 1);
  assert.ok(!a.asked[0].includes("Enter to keep"));
  assert.equal(decodeURIComponent(new URL(s).password), "p@ss/w#rd$1'\"");
  assert.ok(!/[$#'"]/.test(s), "nothing left to confuse the .env.local file");
  await assert.rejects(normalise(`postgresql://postgres.${REF}:[YOUR-PASSWORD]@${POOLER}:6543/postgres`, REF, answer("").ask), /No password entered/);
  await assert.rejects(normalise(`postgresql://postgres.${REF}@${POOLER}:6543/postgres`, REF, answer("").ask), /No password entered/);
});

test("setup: a string that already has a password still asks; Enter keeps it, a new one replaces it", async () => {
  const keep = answer("");
  assert.equal(decodeURIComponent(new URL(await normalise(`postgresql://postgres.${REF}:old%24pw@${POOLER}:6543/postgres`, REF, keep.ask)).password), "old$pw");
  assert.ok(keep.asked[0].includes("Enter to keep"));
  const fresh = answer("new-pw");
  assert.equal(new URL(await normalise(`postgresql://postgres.${REF}:old@${POOLER}:6543/postgres`, REF, fresh.ask)).password, "new-pw");
});

test("setup: session pooler port is moved to the transaction pooler; wrong project and direct host are refused", async () => {
  const s = await normalise(`DATABASE_URL="postgresql://postgres.${REF}:secret@${POOLER}:5432/postgres"`, REF, answer("").ask);
  assert.equal(new URL(s).port, "6543");
  await assert.rejects(normalise(`postgresql://postgres.otherprojectref00000:secret@${POOLER}:6543/postgres`, REF, answer("x").ask), /different Supabase project/);
  await assert.rejects(normalise(`postgresql://postgres:secret@db.${REF}.supabase.co:5432/postgres`, REF, answer("x").ask), /direct connection/);
  await assert.rejects(normalise("https://example.com", REF, answer("x").ask), /not a connection string/);
});

test("setup: .env.local gets APP_MODE and DATABASE_URL once; the old inactive template is replaced; other settings are kept", () => {
  const url = "postgresql://postgres.x:s@h.pooler.supabase.com:6543/postgres";
  const fromTemplate = envLocalContent("# INACTIVE until you fill in the values\n# APP_MODE=supabase\n# DATABASE_URL=postgresql://...\n# DATABASE_CA_CERT=\"...\"\n", url);
  assert.equal(fromTemplate.match(/^APP_MODE=supabase$/gm)?.length, 1);
  assert.equal(fromTemplate.match(/^DATABASE_URL=/gm)?.length, 1);
  assert.ok(!fromTemplate.includes("INACTIVE") && !fromTemplate.includes("DATABASE_CA_CERT"));
  const again = envLocalContent(`${fromTemplate}\nNEXT_PUBLIC_APP_URL=http://localhost:3000\n`, url.replace("s@", "t@"));
  assert.equal(again.match(/^DATABASE_URL=/gm)?.length, 1);
  assert.ok(again.includes(":t@") && again.includes("NEXT_PUBLIC_APP_URL=http://localhost:3000"));
});

test("setup: saving twice does not repeat the header", () => {
  const url = "postgresql://postgres.x:s@h.pooler.supabase.com:6543/postgres";
  const twice = envLocalContent(envLocalContent("", url), url);
  assert.equal(twice, envLocalContent("", url));
});
