import { test } from "node:test";
import assert from "node:assert/strict";
import { autoBlockers, classifyReview, defaultAutomation, redactForAi, replyIssues } from "@/lib/review-safety";

// Review reply safety: which reviews need the owner, what Claude may see, and what automation may publish.

test("reviews are classified by rating, text and sensitive content", () => {
  assert.deepEqual(classifyReview({ stars: 5, comment: "Lovely staff and short wait." }, "healthcare").sensitive, false);
  assert.equal(classifyReview({ stars: 5, comment: "" }, "general").noText, true);
  assert.equal(classifyReview({ stars: 3, comment: "ok" }, "general").sentiment, "neutral");
  const neg = classifyReview({ stars: 1, comment: "Rude reception." }, "general");
  assert.equal(neg.sentiment, "negative");
  assert.match(neg.reasons[0], /Negative review/);
  // Health details only matter for healthcare businesses; English, Hindi and Hinglish.
  assert.equal(classifyReview({ stars: 5, comment: "Great treatment for my son's acne." }, "healthcare").sensitive, true);
  assert.equal(classifyReview({ stars: 5, comment: "Doctor ne achha ilaj kiya" }, "healthcare").sensitive, true);
  assert.equal(classifyReview({ stars: 5, comment: "डॉक्टर ने दवा अच्छी दी" }, "healthcare").sensitive, true);
  assert.equal(classifyReview({ stars: 5, comment: "The pain au chocolat was great." }, "general").sensitive, false);
  // "report" as a word start, not inside another word.
  assert.equal(classifyReview({ stars: 5, comment: "Very supportive team." }, "healthcare").sensitive, false);
  // Refund, legal and safety complaints need a person in any business.
  assert.equal(classifyReview({ stars: 4, comment: "Still waiting for my refund." }, "general").sensitive, true);
});

test("contact details and long numbers are removed before review text goes to Claude", () => {
  assert.equal(redactForAi("Call me on +91 98765 43210 or mail a.b@example.com, file 1234567890."),
    "Call me on [number removed] or mail [email removed], file [number removed].");
  assert.equal(redactForAi("Room 12 was clean."), "Room 12 was clean.");
});

test("drafted replies are checked for promises, resolution claims, repeated health details and contact data", () => {
  const b = { type: "healthcare" as const, phone: "0674 123 4567", website: "" };
  assert.deepEqual(replyIssues("Thank you, Asha. We are glad the visit went smoothly.", { comment: "Nice staff" }, b), []);
  assert.ok(replyIssues("We guarantee a 100% cure.", { comment: "" }, b).length > 0);
  assert.ok(replyIssues("Your issue has been resolved.", { comment: "" }, b).some((x) => x.includes("solved")));
  assert.ok(replyIssues("Glad the acne treatment worked.", { comment: "My acne treatment went well" }, b).some((x) => x.includes("Repeats health details")));
  assert.ok(replyIssues("Call us on 98765 43210.", { comment: "" }, b).some((x) => x.includes("phone number")));
  assert.deepEqual(replyIssues("Call us on 0674 123 4567.", { comment: "" }, b), [], "the business's own number is fine");
  assert.deepEqual(replyIssues("", { comment: "" }, b), ["The reply is empty."]);
});

test("automatic publishing needs opt-in, a connection, a positive non-sensitive review and a clean reply", () => {
  const on = { ...defaultAutomation(), replies: "auto" as const, autoOptInAt: "2026-11-20T00:00:00Z", autoMinStars: 5 as const };
  const pos = classifyReview({ stars: 5, comment: "Great" }, "general");
  assert.deepEqual(autoBlockers(on, 5, pos, [], true), []);
  assert.ok(autoBlockers(on, 4, classifyReview({ stars: 4, comment: "Good" }, "general"), [], true).length > 0, "4 stars blocked when 5 is the minimum");
  assert.deepEqual(autoBlockers({ ...on, autoMinStars: 4 }, 4, classifyReview({ stars: 4, comment: "Good" }, "general"), [], true), []);
  assert.ok(autoBlockers({ ...on, paused: true }, 5, pos, [], true).includes("Automation is paused."));
  assert.ok(autoBlockers({ ...on, autoOptInAt: undefined }, 5, pos, [], true).length > 0);
  assert.ok(autoBlockers(on, 5, pos, [], false).includes("Google is not connected for this location."));
  assert.ok(autoBlockers(on, 1, classifyReview({ stars: 1, comment: "Bad" }, "general"), [], true).length > 0);
  assert.ok(autoBlockers(on, 5, classifyReview({ stars: 5, comment: "Fixed my refund" }, "general"), [], true).length > 0);
  assert.ok(autoBlockers(on, 5, pos, ["Says the problem is solved."], true).length > 0);
  assert.ok(autoBlockers({ ...on, replies: "approval" }, 5, pos, [], true).length > 0);
});
