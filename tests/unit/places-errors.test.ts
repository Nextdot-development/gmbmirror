import { test } from "node:test";
import assert from "node:assert/strict";
import { PlacesError } from "@/lib/places";

const KEY = "AIzaFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKE123";

test("ACCESS_DENIED names the Cloud setting and keeps Google's own code", () => {
  const e = new PlacesError(403, { status: "PERMISSION_DENIED", message: "Permission denied on the service.", details: [{ reason: "ACCESS_DENIED" }] }, KEY);
  assert.match(e.message, /enable "Places API \(New\)"/);
  assert.match(e.message, /403 PERMISSION_DENIED ACCESS_DENIED/);
  assert.equal(e.denied, true);
});

test("each key restriction gets its own explanation", () => {
  const msg = (reason: string) => new PlacesError(403, { status: "PERMISSION_DENIED", details: [{ reason }] }).message;
  assert.match(msg("API_KEY_SERVICE_BLOCKED"), /API restrictions/);
  assert.match(msg("API_KEY_HTTP_REFERRER_BLOCKED"), /certain websites/);
  assert.match(msg("SERVICE_DISABLED"), /not enabled/);
  assert.match(new PlacesError(400, { status: "INVALID_ARGUMENT", details: [{ reason: "API_KEY_INVALID" }] }).message, /not a valid key/);
  assert.equal(new PlacesError(403, { details: [{ reason: "API_KEY_HTTP_REFERRER_BLOCKED" }] }).denied, false);
});

test("the key never appears in the message, even if Google echoes it", () => {
  const e = new PlacesError(403, { message: `Key ${KEY} denied`, details: [{ reason: "ACCESS_DENIED" }] }, KEY);
  assert.ok(!e.message.includes(KEY));
  const e2 = new PlacesError(403, { message: `Key ${KEY} denied` });
  assert.ok(!e2.message.includes(KEY));
});

test("quota and unknown errors keep a plain fallback", () => {
  assert.match(new PlacesError(429, { status: "RESOURCE_EXHAUSTED" }).message, /quota/);
  assert.match(new PlacesError(503, {}).message, /having problems.*Google: 503/);
});
