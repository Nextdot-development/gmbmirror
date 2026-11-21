import "server-only";
import { env } from "./env";
import type { Business, Recommendation, ReportSection, VisibilityCheck, VisibilityResult } from "./types";
import { AUDIT_ITEMS, categoryInfo, copyFor } from "./business";
import { mergeAiRecommendations, parseJsonObject, type GrowthView } from "./growth";
import { medicalWarnings } from "./medical";
import { createHash } from "node:crypto";
import { checkAiAllowance, currentUser, recordAiUsage } from "./ai-usage";
import { redactForAi } from "./review-safety";

const TIMEOUT_MS = 45_000;

/** One place for provider calls: a time limit, and error messages that say what actually went wrong. */
async function call(provider: string, keyName: string, modelName: string, url: string, init: RequestInit): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (e) {
    if (e instanceof Error && e.name === "TimeoutError") throw new Error(`${provider} did not answer within ${TIMEOUT_MS / 1000} seconds. Try again.`);
    throw new Error(`Could not reach ${provider}. Check the connection and try again.`);
  }
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) throw new Error(`${provider} rejected the API key (${res.status}). Check ${keyName}.`);
    if (res.status === 400 || res.status === 404) throw new Error(`${provider} rejected the request (${res.status}). Check ${modelName}.`);
    if (res.status === 429) throw new Error(`${provider} is rate limiting this account (429). Wait a minute and try again.`);
    if (res.status >= 500) throw new Error(`${provider} is having problems (${res.status}). Try again in a few minutes.`);
    throw new Error(`${provider} request failed (${res.status}).`);
  }
  try {
    return await res.json();
  } catch {
    throw new Error(`${provider} sent a response that could not be read. Try again.`);
  }
}

/**
 * Current Claude models think before answering by default, and thinking counts toward max_tokens.
 * `maxTokens` is the size of the visible answer we want; the request allows room for thinking on top.
 * Effort is kept low for these short writing tasks (raise it per call when the task needs more reasoning).
 */
type ClaudeOpts = { feature?: string; cache?: boolean };
const cache = new Map<string, { at: number; text: string }>();
const CACHE_MS = 60 * 60_000;
const RETRYABLE = /\((429|5\d\d)\)|did not answer within|Could not reach/;

async function claude(system: string, user: string, maxTokens = 500, effort: "low" | "medium" | "high" = "low", opts: ClaudeOpts = {}): Promise<string> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY is not set in .env");
  const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";
  // Identical requests for derived, repeatable text (summaries, explanations) are answered from a short cache.
  // Per user: one account's cached text is never served to another.
  const cacheKey = opts.cache ? createHash("sha256").update(`${(await currentUser()) ?? ""}\n${model}\n${system}\n${user}`).digest("hex") : "";
  const hit = cacheKey ? cache.get(cacheKey) : undefined;
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.text;
  await checkAiAllowance();
  // Older models (Claude 4.5 and earlier) reject the effort setting.
  const supportsEffort = !/^claude-(3|haiku-4-5|sonnet-4-5|sonnet-4-0|sonnet-4-2|opus-4-0|opus-4-1)/.test(model);
  const request = () => call("Claude", "ANTHROPIC_API_KEY", "ANTHROPIC_MODEL", `${process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com"}/v1/messages`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model,
      max_tokens: Math.max(4000, maxTokens * 4),
      ...(supportsEffort ? { output_config: { effort } } : {}),
      system,
      messages: [{ role: "user", content: user }],
    }),
  });
  let raw: unknown;
  try {
    raw = await request();
  } catch (e) {
    // One retry after a short wait, only for rate limits, server errors, timeouts and network problems.
    if (!(e instanceof Error) || !RETRYABLE.test(e.message)) throw e;
    await new Promise((r) => setTimeout(r, Number(process.env.AI_RETRY_DELAY_MS ?? 1500)));
    raw = await request();
  }
  const json = raw as { content?: { type: string; text?: string }[]; stop_reason?: string; usage?: { input_tokens?: number; output_tokens?: number } };
  await recordAiUsage(opts.feature ?? "other", json.usage?.input_tokens ?? 0, json.usage?.output_tokens ?? 0);
  if (json.stop_reason === "refusal") throw new Error("Claude declined to write this. Rephrase the request and try again.");
  if (json.stop_reason === "max_tokens") throw new Error("Claude's answer was cut off before it finished. Try again.");
  const text = (json.content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join("").trim();
  if (cacheKey && text) {
    if (cache.size > 500) cache.clear();
    cache.set(cacheKey, { at: Date.now(), text });
  }
  return text;
}

async function openai(q: string, system?: string): Promise<string> {
  const j = (await call("OpenAI", "OPENAI_API_KEY", "OPENAI_MODEL", "https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({ model: process.env.OPENAI_MODEL, messages: [...(system ? [{ role: "system", content: system }] : []), { role: "user", content: q }] }),
  })) as { choices?: { message?: { content?: string } }[] };
  return j.choices?.[0]?.message?.content ?? "";
}

async function gemini(q: string, system?: string): Promise<string> {
  const j = (await call("Gemini", "GEMINI_API_KEY", "GEMINI_MODEL", `https://generativelanguage.googleapis.com/v1beta/models/${process.env.GEMINI_MODEL}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY! },
    body: JSON.stringify({ ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}), contents: [{ parts: [{ text: q }] }] }),
  })) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  return j.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
}

/** Language instruction for drafts. The safety rules in each prompt apply whatever the language. */
function languageRule(b: Business): string {
  switch (b.language) {
    case "hi":
      return "Write in Hindi using Devanagari script. Keep the business name, people's names and medical terms as they are normally written. ";
    case "hinglish":
      return "Write in Hinglish: everyday Hindi mixed with common English words, written only in Roman (English) letters, never Devanagari. ";
    default:
      return "Write in English. ";
  }
}

export type ReplyVariant = "new" | "regenerate" | "shorter" | "longer" | "professional" | "friendly";

const VARIANT: Record<Exclude<ReplyVariant, "new">, string> = {
  regenerate: "Write a different reply from the current one: new wording and structure, same facts.",
  shorter: "Rewrite the current reply shorter: 1 to 2 sentences, same meaning.",
  longer: "Rewrite the current reply with a little more detail from the review: 3 to 5 sentences. Add nothing that is not in the review.",
  professional: "Rewrite the current reply in a more formal, professional tone.",
  friendly: "Rewrite the current reply in a warmer, more personal tone, still respectful.",
};

/**
 * A reply to one review. Claude gets the rating, the review text with contact details removed, the business facts,
 * and up to three of the owner's earlier published replies as style examples. `current` is the text to rewrite.
 */
export async function draftReply(
  b: Business,
  review: { stars: number; comment: string; firstName: string },
  opts: { variant?: ReplyVariant; current?: string; styleExamples?: string[] } = {},
): Promise<string> {
  const c = copyFor(b.type);
  const variant = opts.variant ?? "new";
  const tone = review.stars >= 4 ? "Thank them warmly for the specific things they mention."
    : review.stars === 3 ? "Thank them, acknowledge what was good and what was not, and say how they can reach the business."
    : review.stars >= 1 ? "Thank them, own the problem without arguing or blaming, apologise once, and invite them to contact the business directly so it can be looked into. Never say the problem is already fixed."
    : "Google shows no star rating. Thank them for the feedback.";
  const facts = [`Business: ${b.name}, ${categoryInfo(b.category, b.type).about} in ${b.location}.`, b.services?.length ? `Services: ${b.services.join(", ")}.` : ""].filter(Boolean).join(" ");
  const examples = (opts.styleExamples ?? []).slice(0, 3).map((e, i) => `Example ${i + 1}: ${e}`).join("\n");
  const system =
    `You write public replies to Google reviews. ${facts} ` +
    `Rules: plain and warm, specific to what the reviewer wrote, address them by first name if one is given. No exclamation marks, no marketing phrases, no invented facts, ` +
    `no promises, no offers, and never mention anything the reviewer did not say. ${c.replyRule} ` +
    (b.type === "healthcare"
      ? `Even if the reviewer mentions them, do not repeat who was treated (for example a child or family member), symptoms, test results, diagnoses, treatments or the reason for the visit. ` +
        `Make no medical claims. Talk only about service: waiting time, communication, staff, cleanliness. `
      : "") +
    `${tone} ` +
    (review.comment.trim() ? "" : `The reviewer left only a star rating, no text: keep it to 1 or 2 sentences and do not guess what they liked or disliked. `) +
    (examples ? `Match the owner's usual style and length, shown in these earlier replies, without copying their sentences:\n${examples}\n` : "") +
    (variant === "new" ? "Length: 2 to 4 sentences. " : `${VARIANT[variant]} `) +
    languageRule(b) + `Every rule above applies in every language, including any translated wording. Output only the reply text.`;
  const user = `Reviewer first name: ${review.firstName || "(not given)"}\nRating: ${review.stars ? `${review.stars} of 5` : "not given"}\n` +
    `Review: ${redactForAi(review.comment) || "(no text, rating only)"}` + (opts.current && variant !== "new" ? `\n\nCurrent reply:\n${opts.current}` : "");
  return claude(system, user, 500, "low", { feature: "review_reply" });
}

const POST_KIND: Record<string, string> = {
  STANDARD: "an update post",
  EVENT: "an event post (the event title and dates are shown by Google separately; do not repeat the dates)",
  OFFER: "an offer post (Google shows the offer title, dates, coupon and terms separately; do not invent a discount)",
};
const CTA_TEXT: Record<string, string> = { BOOK: "Book", ORDER: "Order online", SHOP: "Buy", LEARN_MORE: "Learn more", SIGN_UP: "Sign up", CALL: "Call now" };

function postSystem(b: Business, kind: string, cta: string | undefined, previous: string[]): string {
  const rules = b.type === "healthcare"
    ? "This is a healthcare business. No guarantees, no cure claims, no superlatives, no offers or discounts, no patient details or stories, no before and after claims. Share general, useful information only."
    : "No made up prices, offers, awards or facts.";
  const c = categoryInfo(b.category, b.type);
  return `You write Google Business Profile posts for ${b.name}, ${c.about} in ${b.location}. ` +
    (b.services?.length ? `Services they actually offer: ${b.services.join(", ")}. Mention a service only if it fits the topic. ` : "") +
    `This is ${POST_KIND[kind] ?? POST_KIND.STANDARD}. Write 60 to 130 words, well under 900 characters. Plain language, no hashtags, no emojis, no exclamation marks. ` +
    `Mention ${b.location} once, naturally, where a customer would; never repeat keywords. ${rules} ` +
    (cta ? `The post has a "${CTA_TEXT[cta]}" button, so end with one short sentence that leads to it, without a link. ` : "") +
    (previous.length ? `Recent posts (do not repeat their topic angle, opening or sentences):\n${previous.map((p) => `- ${p.slice(0, 200)}`).join("\n")}\n` : "") +
    languageRule(b) + `Every rule above applies in every language, including any translated wording.`;
}

/** One post draft (fallback when the variations cannot be used). */
export async function draftPost(b: Business, topic: string, opts: { kind?: string; cta?: string; previous?: string[] } = {}): Promise<string> {
  return claude(postSystem(b, opts.kind ?? "STANDARD", opts.cta, opts.previous ?? []) + " Output only the post text.", `Topic: ${topic}`, 600, "low", { feature: "post" });
}

/**
 * Three different post drafts for one topic, as structured output (a JSON array of strings), validated: each must be
 * 40 to 1500 characters and different from the others. Returns null when the answer cannot be used.
 */
export async function draftPostVariants(b: Business, topic: string, opts: { kind?: string; cta?: string; previous?: string[] } = {}): Promise<string[] | null> {
  const out = await claude(
    postSystem(b, opts.kind ?? "STANDARD", opts.cta, opts.previous ?? []) +
      ` Write three versions that differ in angle and opening (for example: practical tip, what to expect, invitation). Return only a JSON array of three strings.`,
    `Topic: ${topic}`, 1500, "low", { feature: "post_variants" },
  );
  try {
    const arr = JSON.parse(out.match(/\[[\s\S]*\]/)?.[0] ?? "");
    if (!Array.isArray(arr)) return null;
    const texts = [...new Set(arr.filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter((x) => x.length >= 40 && x.length <= 1500))];
    return texts.length >= 2 ? texts.slice(0, 3) : null;
  } catch {
    return null;
  }
}

export function questionsFor(b: Business): string[] {
  const c = categoryInfo(b.category, b.type);
  const base =
    b.type === "healthcare"
      ? [`Which are the best ${c.many} in ${b.location}? Name a few specific ones.`, `I need a trusted ${c.one} in ${b.location}. Who would you suggest?`]
      : [`What are the best ${c.many} in ${b.location}? Name a few specific ones.`, `Can you recommend a good ${c.one} in ${b.location}?`];
  // One service question when services are listed (the first one), so checks also cover what the business offers.
  const service = b.services?.[0] ? [`Where can I get ${b.services[0].toLowerCase()} in ${b.location}? Name a few places.`] : [];
  return [...base, ...service, ...(b.customQuestions ?? []).slice(0, 3)];
}

function normalise(s: string) {
  return s.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

function editDistance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

/** Same word, or a one-letter slip in a longer word ("Zentrex" for "Zentrix"). */
const near = (a: string, b: string) => a === b || (a.length >= 5 && b.length >= 5 && editDistance(a, b) <= 1);

function excerptAround(answer: string, phrase: string): string {
  const raw = answer.replace(/\s+/g, " ");
  const first = phrase.split(" ")[0] ?? "";
  const idx = raw.toLowerCase().indexOf(first.toLowerCase());
  const start = Math.max(0, (idx >= 0 ? idx : 0) - 60);
  return raw.slice(start, start + 200);
}

/**
 * named: the name or an alias appears as whole words.
 * possible: every word of a name appears in order with at most 2 extra words in between, allowing a one-letter
 * slip in longer words, e.g. "Zentrix Skin & Hair Clinic" for "Zentrix Skin Clinic". Not counted in the score.
 */
export function matchBusiness(answer: string, names: string[]): { match: "named" | "possible" | "none"; excerpt: string; possibleName?: string } {
  const a = normalise(answer);
  // Normalised words, each paired with the original token it came from, so a possible match can be shown
  // as the answer wrote it ("Zentrix Skin & Hair Clinic"), not as "zentrix skin and hair clinic".
  const words: string[] = [];
  const orig: number[] = [];
  const tokens = answer.split(/\s+/).filter(Boolean);
  tokens.forEach((tok, k) => {
    for (const w of normalise(tok).split(" ").filter(Boolean)) {
      words.push(w);
      orig.push(k);
    }
  });
  const clean = names.map(normalise).filter(Boolean);
  for (const n of clean) if (` ${a} `.includes(` ${n} `)) return { match: "named", excerpt: excerptAround(answer, n) };
  for (const n of clean) {
    const t = n.split(" ");
    for (let i = 0; i < words.length; i++) {
      if (!near(words[i], t[0])) continue;
      let k = 1, j = i + 1;
      const limit = Math.min(words.length, i + t.length + 2);
      while (k < t.length && j < limit) {
        if (near(words[j], t[k])) k++;
        j++;
      }
      if (k === t.length) {
        const seen = words.slice(i, j).join(" ");
        if (seen !== n) {
          const shown = tokens.slice(orig[i], orig[j - 1] + 1).join(" ").replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
          return { match: "possible", excerpt: excerptAround(answer, shown), possibleName: shown };
        }
      }
    }
  }
  return { match: "none", excerpt: "" };
}

type Provider = {
  id: "claude" | "chatgpt" | "gemini";
  label: string;
  ready: boolean;
  complete: (system: string, user: string, maxTokens: number) => Promise<string>;
};

export const providers = (): Provider[] => [
  { id: "claude", label: "Claude", ready: env.anthropicConfigured(), complete: (s, u, m) => claude(s, u, m) },
  { id: "chatgpt", label: "ChatGPT (OpenAI API)", ready: env.openaiConfigured(), complete: (s, u) => openai(u, s) },
  { id: "gemini", label: "Gemini (Google API)", ready: env.geminiConfigured(), complete: (s, u) => gemini(u, s) },
];

const EXTRACT = "Extract the business names recommended in the text. Return a JSON array of strings only. Return [] if none.";

function parseList(out: string): string[] {
  const m = out.match(/\[[\s\S]*\]/);
  if (!m) throw new Error("no JSON array");
  const arr = JSON.parse(m[0]);
  if (!Array.isArray(arr)) throw new Error("not an array");
  return arr.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((x) => x.trim()).slice(0, 6);
}

/** Lists competitors with the provider that wrote the answer, then Claude as a fallback. */
async function listNames(answer: string, p: Provider): Promise<{ names: string[]; failed: boolean }> {
  const order = [p, ...providers().filter((x) => x.id === "claude" && x.ready && x.id !== p.id)];
  for (const x of order) {
    try {
      return { names: parseList(await x.complete(EXTRACT, answer, 200)), failed: false };
    } catch {
      /* try the next one */
    }
  }
  return { names: [], failed: true };
}

/**
 * Asks every configured provider every question. A provider that fails is reported, and the other providers'
 * results are still returned. Throws only when no provider produced a usable answer.
 */
export async function runVisibility(b: Business): Promise<{ results: VisibilityResult[]; failedProviders: { label: string; error: string }[] }> {
  const ready = providers().filter((p) => p.ready);
  const names = [b.name, ...(b.aliases ?? [])];
  const questions = questionsFor(b);
  const failedProviders: { label: string; error: string }[] = [];
  const results: VisibilityResult[] = [];

  await Promise.all(
    ready.map(async (p) => {
      const settled = await Promise.allSettled(
        questions.map(async (q): Promise<VisibilityResult> => {
          const answer = await p.complete("Answer like a helpful assistant. Be specific.", q, 600);
          // An empty answer says nothing about visibility, so it counts as a failure, not "Not named".
          if (!answer.trim()) throw new Error(`${p.label} returned an empty answer.`);
          const m = matchBusiness(answer, names);
          const others = m.match === "named" ? { names: [], failed: false } : await listNames(answer, p);
          return {
            provider: p.id,
            providerLabel: p.label,
            question: q,
            found: m.match === "named",
            match: m.match,
            possibleName: m.possibleName,
            excerpt: m.excerpt,
            mentionedBusinesses: others.names,
            extractionFailed: others.failed || undefined,
          };
        }),
      );
      const failure = settled.find((s): s is PromiseRejectedResult => s.status === "rejected");
      // A provider with any failed question is reported as failed and its partial answers are dropped,
      // so each saved provider is compared on the same questions.
      if (failure) failedProviders.push({ label: p.label, error: failure.reason instanceof Error ? failure.reason.message : "The request failed." });
      else for (const s of settled) if (s.status === "fulfilled") results.push(s.value);
    }),
  );

  if (!results.length) throw new Error(failedProviders.map((f) => f.error).join(" ") || "The check failed. Try again in a minute.");
  const order = ready.map((p) => p.id);
  results.sort((x, y) => order.indexOf(x.provider) - order.indexOf(y.provider) || questions.indexOf(x.question) - questions.indexOf(y.question));
  return { results, failedProviders };
}

/** 3 to 5 specific next steps written by AI from the check. Returns null if no provider could write them. */
export async function visibilityFixes(b: Business, check: Pick<VisibilityCheck, "results">): Promise<string[] | null> {
  const missing = AUDIT_ITEMS.filter((i) => (i.healthcareOnly ? b.type === "healthcare" : true) && !b.audit[i.key]).map((i) => i.label);
  const competitors = [...new Set(check.results.flatMap((r) => r.mentionedBusinesses))].slice(0, 10);
  const count = (m: string) => check.results.filter((r) => (r.match ?? (r.found ? "named" : "none")) === m).length;
  const rules =
    b.type === "healthcare"
      ? "This is a healthcare business. Never suggest guarantees, cure claims, superlatives such as best doctor, discounts or offers, patient testimonials, before and after claims, or sharing patient details. Do not suggest asking only happy patients for reviews."
      : "Never suggest fake reviews, review gating, or made-up offers.";
  const system =
    `You advise the owner of ${b.name}, a ${b.category} in ${b.location}, on being named by AI assistants. ` +
    `Write 3 to 5 specific, practical actions they can do this month, based only on the facts given. Plain language, one sentence each, no hype, no promises of results. ${rules} ` +
    `Return a JSON array of strings only.`;
  const facts =
    `Answers that named the business: ${count("named")} of ${check.results.length}. Possible matches (a close variant of the name): ${count("possible")}.\n` +
    `Businesses named instead: ${competitors.join(", ") || "none listed"}.\n` +
    `Profile checklist items not done yet: ${missing.join("; ") || "none"}.\n` +
    `Website: ${b.website || "none given"}. Known names: ${[b.name, ...(b.aliases ?? [])].join(", ")}.`;
  const ready = providers().filter((p) => p.ready);
  for (const p of [...ready.filter((x) => x.id === "claude"), ...ready.filter((x) => x.id !== "claude")]) {
    try {
      // Healthcare: drop any suggestion that trips the medical wording check before it is shown.
      const list = parseList(await p.complete(system, facts, 500)).filter((f) => b.type !== "healthcare" || medicalWarnings(f).length === 0);
      if (list.length >= 3) return list.slice(0, 5);
    } catch {
      /* try the next provider */
    }
  }
  return null;
}

export const METHODOLOGY =
  "We ask each connected AI model two plain customer questions about your category and city, plus any questions you added, then check whether your business name or one of your other names appears in the answer. " +
  "A close variant of the name is shown as a possible match and is not counted in the score. The score is the share of answers that named you. " +
  "These are API answers from the model's own knowledge. They can differ from what the public ChatGPT, Claude or Gemini apps show, which may use live web search and personal settings. " +
  "A result is a snapshot for the date shown. It is not an official ranking from Google or OpenAI and does not predict leads.";

/* ---------------- Growth recommendations and action-plan content ---------------- */

/**
 * Asks Claude to choose and explain the top 3 issues. It receives only facts this app measured (our scores,
 * counts, verdicts and dates, never Google's own content) and the candidate issues with their evidence.
 * The reply is validated by mergeAiRecommendations; anything unusable falls back to the rules.
 */
export async function aiGrowthRecommendations(b: Business, view: GrowthView): Promise<Recommendation[] | null> {
  const c = categoryInfo(b.category, b.type);
  const rules =
    b.type === "healthcare"
      ? "This is a healthcare business. Never suggest guarantees, cure claims, superlatives such as best doctor, discounts or offers, testimonials, or sharing patient details."
      : "Never suggest fake reviews, buying reviews, review gating, or made-up offers.";
  const system =
    `You prioritise growth actions for the owner of ${c.about} in India, who is not technical. ` +
    "You get facts measured by this product and a list of candidate issues, each with evidence. Choose the 3 candidates that matter most for this business now. " +
    "For each, write a short title, why it matters, 2 to 6 practical steps, and the expected benefit. Use only the facts given; never invent numbers, competitors, reviews or results. " +
    `Never promise rankings, leads, calls or revenue. Plain English. ${rules} Do not quote the words you are told to avoid, even to warn against them. ` +
    'Reply with JSON only: {"recommendations":[{"id":"<candidate id>","title":"...","why":"...","steps":["..."],"benefit":"...","difficulty":"Easy|Medium|Advanced","priority":"Critical|High|Medium"}]}';
  const facts = {
    business: { category: c.label, kind: c.about, type: b.type, city: b.location },
    measures: view.measures.map((m) => ({ measure: m.label, value: m.value ?? "not measured", detail: m.detail })),
    candidates: view.candidates.slice(0, 10).map((x) => ({ id: x.id, title: x.title, priority: x.priority, difficulty: x.difficulty, evidence: x.evidence })),
  };
  const out = await claude(system, JSON.stringify(facts), 900);
  return mergeAiRecommendations(view, parseJsonObject(out), b.type === "healthcare");
}

const CONTENT_BRIEF: Record<NonNullable<Recommendation["contentKind"]>, string> = {
  description: "Write a Google Business Profile description of 300 to 600 characters: who the business is, its main services and the area it serves. No links, prices, offers or phone numbers.",
  photos: "Write a numbered shot list of 10 photos to add to the Google profile (entrance, reception, inside, team at work, main services, signage). One short line each, with a tip on light and privacy.",
  review_request: "Write a short, polite message (under 300 characters) asking a customer to share their honest experience on Google, with the placeholder [review link]. Ask everyone the same way; never ask only happy customers.",
  website_text: "Write a short block for the website home page in plain text: business name, area and city, main services, opening hours placeholder [hours] and phone placeholder [phone], so search engines and AI assistants can read it.",
  faq: "Write 4 short questions and answers for the business's website that a customer might ask an AI assistant (services, location, timings, how to book). Use placeholders like [hours] for facts you do not know.",
};

/** Content for an action plan, for the owner to review and copy. Nothing is published. */
export async function draftActionContent(b: Business, kind: NonNullable<Recommendation["contentKind"]>): Promise<string> {
  const c = categoryInfo(b.category, b.type);
  const healthcare =
    b.type === "healthcare" ? " This is a healthcare business: no guarantees, cure claims, superlatives such as best doctor, offers or patient details." : "";
  const system =
    `You draft content for the owner of ${b.name}, ${c.about} in ${b.location}, India. ${CONTENT_BRIEF[kind]} ` +
    `Use only the facts given; use a placeholder in square brackets for anything you do not know. Plain text only, no markdown headings.${healthcare}`;
  const facts = `Business: ${b.name}. Category: ${c.label}. City: ${b.location}.${b.website ? ` Website: ${b.website}.` : ""}${b.aliases?.length ? ` Also known as: ${b.aliases.join(", ")}.` : ""}`;
  const text = (await claude(system, facts, 500)).trim();
  if (text.length < 20) throw new Error("Claude returned an empty draft. Try again.");
  return text.slice(0, 2500);
}

/**
 * A 3 to 5 sentence summary of a monthly report, written only from the report's own facts. Structured input, plain
 * output; the facts contain no customer or patient details.
 */
export async function writeReportSummary(b: Business, month: string, sections: ReportSection[]): Promise<string> {
  const facts = sections.map((s) => `${s.title}: ${s.available ? s.lines.join(" ") : `not available (${s.reason})`}`).join("\n");
  const text = await claude(
    `You write the executive summary of a monthly Google Business Profile report for the owner of ${b.name} (${categoryInfo(b.category, b.type).about} in ${b.location}). ` +
      `Write 3 to 5 plain sentences in English: what improved, what needs attention, and the single most useful next step. Use only the facts given; ` +
      `do not invent numbers, causes or results, and say nothing about data marked not available beyond that it is missing. No hype, no headings, no bullet points.`,
    `Month: ${month}\n${facts}`,
    400, "low", { feature: "report_summary", cache: true },
  );
  if (text.length < 40 || text.length > 1500) throw new Error("Claude's summary was not usable.");
  return text;
}

/** A short, plain explanation of Business Profile performance numbers. Only the numbers given; no guessed causes. */
export async function explainInsights(b: Business, facts: string): Promise<string> {
  const text = await claude(
    `You explain Google Business Profile performance figures to the owner of ${b.name} (${categoryInfo(b.category, b.type).about} in ${b.location}). ` +
      `Write 3 to 4 plain sentences in English: what changed most, what is steady, and one practical thing to try next. Use only the figures given. ` +
      `Do not invent causes: say "may" when suggesting a reason. Metrics marked "not reported" are unknown, not zero. No headings, no lists.`,
    facts, 350, "low", { feature: "insights_explanation", cache: true },
  );
  if (text.length < 40 || text.length > 1200) throw new Error("Claude's explanation was not usable.");
  return text;
}

/** Why competitors may be more visible, from comparison counts only (no competitor names or Google content). */
export async function explainCompetitors(b: Business, facts: string): Promise<string> {
  const text = await claude(
    `You advise the owner of ${b.name} (${categoryInfo(b.category, b.type).about} in ${b.location}) on local Google visibility. ` +
      `From the comparison counts given, write 3 to 5 plain sentences: where nearby competitors are ahead, why that may help them appear higher ` +
      `(say "may", Google does not publish its ranking), and the two most useful things to do first. Use only the facts given; invent no numbers, names or results. ` +
      (b.type === "healthcare" ? "Never suggest offers, discounts, guarantees or patient testimonials. " : "Never suggest fake reviews or review gating. ") +
      `No headings, no lists.`,
    facts, 400, "low", { feature: "competitor_insight", cache: true },
  );
  if (text.length < 40 || text.length > 1500) throw new Error("Claude's explanation was not usable.");
  return text;
}
