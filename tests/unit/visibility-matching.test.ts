import { test } from "node:test";
import assert from "node:assert/strict";
import { matchBusiness, questionsFor } from "@/lib/ai";
import type { Business } from "@/lib/types";

const NAME = ["Zentrix Skin Clinic"];

test("exact name, different case or punctuation, counts as named", () => {
  assert.equal(matchBusiness("Try Zentrix Skin Clinic.", NAME).match, "named");
  assert.equal(matchBusiness("Consider ZENTRIX SKIN-CLINIC (Saheed Nagar).", NAME).match, "named");
  assert.equal(matchBusiness("Lotus Spa & Salon", ["Lotus Spa and Salon"]).match, "named");
});

test("an alias counts as named", () => {
  assert.equal(matchBusiness("Many patients choose Dr Rao Skin Care.", ["Zentrix Skin Clinic", "Dr Rao Skin Care"]).match, "named");
});

test("close variants are a possible match, shown as the answer wrote them", () => {
  const m = matchBusiness("Zentrix Skin & Hair Clinic in Patia is popular.", NAME);
  assert.equal(m.match, "possible");
  assert.equal(m.possibleName, "Zentrix Skin & Hair Clinic");
  assert.ok(m.excerpt.startsWith("Zentrix Skin & Hair Clinic"), m.excerpt);
  const typo = matchBusiness("Visit Zentrex Skin Clinic today", NAME);
  assert.equal(typo.match, "possible");
  assert.equal(typo.possibleName, "Zentrex Skin Clinic");
});

test("unrelated or loosely similar text is not a match", () => {
  for (const a of ["Azentrix skin clinical centre", "Alpha Clinic and Beta Dental", "Zentrix and many other skin clinics"]) assert.equal(matchBusiness(a, NAME).match, "none", a);
});

const biz = (over: Partial<Business>): Business => ({ name: "X", website: "https://x.example", location: "Bhubaneswar", category: "Doctor or clinic", type: "healthcare", audit: {}, createdAt: "", ...over });

test("questions use a natural phrase for the category and add custom questions (max 3)", () => {
  const q = questionsFor(biz({ customQuestions: ["a?", "b?", "c?", "d?"] }));
  assert.equal(q[0], "Which are the best clinics in Bhubaneswar? Name a few specific ones.");
  assert.equal(q[1], "I need a trusted clinic in Bhubaneswar. Who would you suggest?");
  assert.deepEqual(q.slice(2), ["a?", "b?", "c?"]);
  assert.equal(questionsFor(biz({ type: "general", category: "Salon or spa", location: "Pune" }))[1], "Can you recommend a good salon in Pune?");
});
