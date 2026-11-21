import { test } from "node:test";
import { inflateSync } from "node:zlib";
import assert from "node:assert/strict";
import { profileScore } from "@/lib/profile-score";
import { reportPdf, scriptRuns, shapeForTest, textPdf } from "@/lib/pdf";

test("profile score: transparent points, unknown items left out, steps only where points were lost", () => {
  const full = profileScore({ location: "l", fetchedAt: "", title: "X", hours: ["Monday 09:00–18:00"], phone: "1", website: "w", category: "Dentist",
    description: "x".repeat(300), verified: true, openStatus: "OPEN", rating: 4.6, reviewCount: 80 });
  assert.equal(full.score, 100);
  assert.ok(full.items.every((i) => i.steps.length === 0));
  const sparse = profileScore({ location: "l", fetchedAt: "", title: "X", hours: [] });
  // Verified, status, reviews and rating are not reported: left out, not zero.
  assert.equal(sparse.checked, 5);
  assert.equal(sparse.score, 0);
  const hours = sparse.items.find((i) => i.key === "hours")!;
  assert.deepEqual([hours.points, hours.max], [0, 15]);
  assert.ok(hours.steps.length > 0);
  assert.equal(sparse.items.find((i) => i.key === "verified")!.points, null);
  const partial = profileScore({ location: "l", fetchedAt: "", title: "X", hours: ["a"], phone: "1", description: "x".repeat(120), verified: false });
  // verified 0/15, category 0/10, hours 15/15, phone 10/10, website 0/10, description 8/15 => 33 of 75
  assert.equal(partial.score, Math.round((33 / 75) * 100));
});

test("PDF: valid structure, several pages for long text, unsupported characters replaced", () => {
  const pdf = Buffer.from(textPdf([{ text: "Report – ₹500 “quoted”", size: 16, bold: true }, ...Array.from({ length: 120 }, (_, i) => ({ text: `Line ${i} (with brackets) and a backslash \\` }))])).toString("latin1");
  assert.ok(pdf.startsWith("%PDF-1.4"));
  assert.ok(pdf.trimEnd().endsWith("%%EOF"));
  assert.match(pdf, /\/Count [2-9]/);
  assert.ok(pdf.includes("Report - Rs 500 \"quoted\""));
  assert.ok(pdf.includes("\\(with brackets\\)"));
  // The xref offset points at the xref table.
  const start = Number(pdf.match(/startxref\n(\d+)/)![1]);
  assert.equal(pdf.slice(start, start + 4), "xref");
  assert.ok(Buffer.from(textPdf([{ text: "हिन्दी" }])).toString("latin1").includes("(??????)"));
});

/* ---------- Unicode report PDFs (Hindi, English, mixed) ---------- */

/** The decompressed page content of a Unicode PDF: every glyph drawn, as hex glyph IDs. */
function drawnGlyphs(pdf: Buffer): string[] {
  const out: string[] = [];
  const bin = pdf.toString("latin1");
  for (const m of bin.matchAll(/stream\n/g)) {
    const start = m.index! + m[0].length;
    const end = bin.indexOf("\nendstream", start);
    try {
      const text = inflateSync(pdf.subarray(start, end)).toString("latin1");
      for (const g of text.matchAll(/<([0-9A-F]{4})> Tj/g)) out.push(g[1]);
    } catch {
      // Not a deflated stream.
    }
  }
  return out;
}

const xrefOk = (pdf: string) => {
  const start = Number(pdf.match(/startxref\n(\d+)/)![1]);
  return pdf.slice(start, start + 4) === "xref";
};

test("report PDF: English-only text keeps the plain Helvetica PDF (no embedded font)", async () => {
  const pdf = Buffer.from(await reportPdf([{ text: "Zentrix Skin Clinic – ₹500 “offer”", bold: true }, { text: "Profile views 1,240" }])).toString("latin1");
  assert.ok(pdf.includes("/BaseFont /Helvetica"));
  assert.ok(!pdf.includes("/FontFile2"));
  assert.ok(pdf.includes("Zentrix Skin Clinic - Rs 500 \"offer\""));
  assert.ok(xrefOk(pdf));
});

test("report PDF: Hindi and mixed text embed subset Noto fonts with a text map; nothing becomes '?'", async () => {
  const bytes = Buffer.from(await reportPdf([
    { text: "मासिक रिपोर्ट: नवंबर 2026", size: 16, bold: true },
    { text: "Mixed line: Google rating 4.6, रेटिंग 4.6 है।" },
  ]));
  const pdf = bytes.toString("latin1");
  assert.ok(pdf.startsWith("%PDF-1.4"));
  assert.ok(pdf.trimEnd().endsWith("%%EOF"));
  assert.ok(xrefOk(pdf));
  assert.match(pdf, /\/BaseFont \/[A-Z]{6}\+NotoSansDevanagari-Bold/);
  assert.match(pdf, /\/BaseFont \/[A-Z]{6}\+NotoSansDevanagari-Regular/);
  assert.match(pdf, /\/BaseFont \/[A-Z]{6}\+NotoSans-Regular/);
  assert.equal((pdf.match(/\/Encoding \/Identity-H/g) ?? []).length, 3);
  assert.equal((pdf.match(/\/ToUnicode \d+ 0 R/g) ?? []).length, 3);
  // Every character has a real glyph (glyph 0 means a missing character), and no Helvetica text is mixed in.
  const glyphs = drawnGlyphs(bytes);
  assert.ok(glyphs.length > 30);
  assert.ok(!glyphs.includes("0000"));
  assert.ok(!pdf.includes("/Helvetica"));
  // Only the glyphs used are embedded: four whole fonts would be about 1.7 MB.
  assert.ok(pdf.length < 80_000, `PDF is ${pdf.length} bytes`);
});

test("report PDF: Devanagari is shaped (vowel sign i drawn first, conjuncts joined), Latin uses the Latin font", async () => {
  // कि: the vowel sign ि is drawn before क.
  const ki = await shapeForTest("कि");
  assert.equal(ki.length, 2);
  assert.equal(ki[0].text, "ि");
  assert.equal(ki[1].text, "क");
  // क्ष is a conjunct: fewer glyphs than characters (क + ् + ष).
  assert.ok((await shapeForTest("क्ष")).length < 3);
  const mixed = await shapeForTest("Google रेटिंग");
  assert.ok(mixed.some((g) => g.font === "latin") && mixed.some((g) => g.font === "deva"));
  assert.deepEqual(scriptRuns("Google rating 4.6, रेटिंग 4.6 है।").map((r) => r.deva), [false, true]);
});

test("report PDF: long Hindi text wraps onto several pages", async () => {
  const para = "इस महीने आपकी प्रोफ़ाइल का स्कोर बढ़ा और समीक्षाओं के जवाब समय पर दिए गए। ".repeat(8);
  const pdf = Buffer.from(await reportPdf(Array.from({ length: 30 }, () => ({ text: para })))).toString("latin1");
  assert.match(pdf, /\/Count [2-9]/);
  assert.ok(xrefOk(pdf));
});
