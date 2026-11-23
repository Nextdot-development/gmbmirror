import { promises as fs } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { deflateSync } from "node:zlib";

/**
 * A minimal PDF writer for text reports (A4, word-wrapped, several pages).
 *  - textPdf: Helvetica, no embedded font. Covers Latin text only; other characters become "?".
 *  - reportPdf: uses textPdf when the text is all Latin, otherwise embeds Noto Sans and Noto Sans Devanagari
 *    (SIL Open Font License, src/assets/fonts) and shapes every line with HarfBuzz, so Hindi conjuncts and vowel
 *    signs are drawn correctly in Hindi, English or mixed text. Only the glyphs used are embedded (HarfBuzz subset),
 *    and a ToUnicode map keeps the text searchable and copyable.
 */

export type PdfLine = { text: string; size?: number; bold?: boolean; gap?: number };

const W = 595, H = 842, M = 56;

/** WinAnsi-safe text: common typographic characters mapped, anything else outside Latin-1 replaced. */
function clean(s: string): string {
  return s
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/…/g, "...").replace(/₹/g, "Rs ").replace(/·/g, "-").replace(/[▲]/g, "+").replace(/[▼]/g, "-")
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, "?")
    .replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

/** Average Helvetica glyph width (in 1/1000 em) is about 520; good enough for wrapping plain text. */
function wrap(text: string, size: number, width: number): string[] {
  const max = Math.max(10, Math.floor(width / (size * 0.52)));
  const out: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/)) {
      if (!word) continue;
      if ((line ? line.length + 1 : 0) + word.length > max) {
        if (line) out.push(line);
        line = word.length > max ? word.slice(0, max) : word;
      } else line = line ? `${line} ${word}` : word;
    }
    out.push(line);
  }
  return out;
}

export function textPdf(lines: PdfLine[]): Uint8Array {
  const pages: string[] = [];
  let ops: string[] = [];
  let y = H - M;
  const flush = () => {
    pages.push(ops.join("\n"));
    ops = [];
    y = H - M;
  };
  for (const l of lines) {
    const size = l.size ?? 11;
    y -= l.gap ?? 0;
    for (const w of wrap(l.text, size, W - 2 * M)) {
      if (y - size < M) flush();
      y -= size * 1.35;
      ops.push(`BT /${l.bold ? "F2" : "F1"} ${size} Tf ${M} ${y.toFixed(1)} Td (${clean(w)}) Tj ET`);
    }
  }
  flush();
  // Objects: 1 catalog, 2 pages, 3 font regular, 4 font bold, then a page and a content stream per page.
  const objs: string[] = [];
  objs[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  const kids = pages.map((_, i) => `${5 + i * 2} 0 R`).join(" ");
  objs[2] = `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`;
  objs[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
  objs[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";
  pages.forEach((content, i) => {
    const page = 5 + i * 2, stream = page + 1;
    objs[page] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${stream} 0 R >>`;
    objs[stream] = `<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`;
  });
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let i = 1; i < objs.length; i++) {
    offsets[i] = Buffer.byteLength(pdf, "latin1");
    pdf += `${i} 0 obj\n${objs[i]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objs.length}\n0000000000 65535 f \n${offsets.slice(1).map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  pdf += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(pdf, "latin1"));
}

/* ---------------- Unicode text (Hindi, English and mixed) ---------------- */

/** True when every character survives in Helvetica (after the typographic replacements in clean()). */
export function latinOnly(lines: PdfLine[]): boolean {
  return lines.every((l) => !/[^\x20-\x7E\xA0-\xFF]/.test(l.text.replace(/[‘’“”–—…₹·▲▼]/g, "")));
}

/** The font files ship with the app in src/assets/fonts (fixed paths, so the build knows exactly what is read). */
const FONTS = {
  latin: { read: () => fs.readFile(path.join(process.cwd(), "src/assets/fonts/NotoSans-Regular.ttf")), name: "NotoSans-Regular", tag: "U1" },
  latinBold: { read: () => fs.readFile(path.join(process.cwd(), "src/assets/fonts/NotoSans-Bold.ttf")), name: "NotoSans-Bold", tag: "U2" },
  deva: { read: () => fs.readFile(path.join(process.cwd(), "src/assets/fonts/NotoSansDevanagari-Regular.ttf")), name: "NotoSansDevanagari-Regular", tag: "U3" },
  devaBold: { read: () => fs.readFile(path.join(process.cwd(), "src/assets/fonts/NotoSansDevanagari-Bold.ttf")), name: "NotoSansDevanagari-Bold", tag: "U4" },
} as const;
type FontKey = keyof typeof FONTS;

type Hb = typeof import("harfbuzzjs");
type HbFont = InstanceType<Hb["Font"]>;
type Subsetter = (font: Uint8Array, glyphs: number[]) => Uint8Array;
/** `chars`: glyph ID to the character that maps to it in the font's cmap (the reverse of the font's character table). */
type Loaded = { hb: Hb; subset: Subsetter; fonts: Record<FontKey, { data: Uint8Array; font: HbFont; upem: number; chars: Map<number, string>; covers: Set<number> }> };
const cache = globalThis as unknown as { __gmbPdfFonts?: Promise<Loaded> };

/**
 * HarfBuzz's subsetter (harfbuzz-subset.wasm, shipped with harfbuzzjs; it needs no imports). Keeps only the given
 * glyphs and keeps their glyph IDs, so the shaped glyph IDs stay valid in the embedded font.
 */
async function loadSubsetter(): Promise<Subsetter> {
  const wasm = await fs.readFile(require_resolve("harfbuzzjs/dist/harfbuzz-subset.wasm"));
  const { instance } = await WebAssembly.instantiate(wasm, {});
  const x = instance.exports as Record<string, (...a: number[]) => number> & { memory: WebAssembly.Memory };
  const RETAIN_GIDS = 0x2, NO_HINTING = 0x1, NO_LAYOUT_CLOSURE = 0x200;
  return (font, glyphs) => {
    const ptr = x.malloc(font.length);
    new Uint8Array(x.memory.buffer).set(font, ptr);
    const blob = x.hb_blob_create(ptr, font.length, 0 /* duplicate */, 0, 0);
    x.free(ptr);
    const face = x.hb_face_create(blob, 0);
    const input = x.hb_subset_input_create_or_fail();
    if (!input) throw new Error("Could not prepare the PDF font.");
    const set = x.hb_subset_input_glyph_set(input);
    for (const g of glyphs) x.hb_set_add(set, g);
    x.hb_subset_input_set_flags(input, RETAIN_GIDS | NO_HINTING | NO_LAYOUT_CLOSURE);
    const sub = x.hb_subset_or_fail(face, input);
    x.hb_subset_input_destroy(input);
    x.hb_face_destroy(face);
    x.hb_blob_destroy(blob);
    if (!sub) throw new Error("Could not prepare the PDF font.");
    const out = x.hb_face_reference_blob(sub);
    const lenPtr = x.malloc(4);
    const data = x.hb_blob_get_data(out, lenPtr);
    const len = new Uint32Array(x.memory.buffer, lenPtr, 1)[0];
    const bytes = new Uint8Array(x.memory.buffer).slice(data, data + len);
    x.free(lenPtr);
    x.hb_blob_destroy(out);
    x.hb_face_destroy(sub);
    return bytes;
  };
}
// Resolved at run time, so bundlers leave the package where it is (it is a server external package).
const require_resolve = (id: string) => createRequire(path.join(process.cwd(), "package.json")).resolve(id);

function loadFonts(): Promise<Loaded> {
  cache.__gmbPdfFonts ??= (async () => {
    const hb = await import("harfbuzzjs");
    const fonts = {} as Loaded["fonts"];
    for (const k of Object.keys(FONTS) as FontKey[]) {
      const data = new Uint8Array(await FONTS[k].read());
      const face = new hb.Face(new hb.Blob(data));
      const font = new hb.Font(face);
      const chars = new Map<number, string>();
      const covers = new Set<number>();
      for (const u of face.collectUnicodes()) {
        const gid = font.nominalGlyph(u);
        if (gid) covers.add(u);
        if (gid && !chars.has(gid)) chars.set(gid, String.fromCodePoint(u));
      }
      fonts[k] = { data, font, upem: face.upem, chars, covers };
    }
    return { hb, subset: await loadSubsetter(), fonts };
  })().catch((e) => {
    cache.__gmbPdfFonts = undefined;
    throw e;
  });
  return cache.__gmbPdfFonts;
}

/**
 * One shaped glyph. `cluster` identifies its syllable and `ctext` is that syllable's text; `single`: the only glyph in
 * it. `text`: what this glyph stands for (its character, or for a conjunct ligature the part of the syllable that the
 * other glyphs do not cover).
 */
type Glyph = { font: FontKey; gid: number; x: number; y: number; cluster: string; ctext: string; single: boolean; text: string };

/** Splits text into Devanagari and other runs. Spaces, digits and punctuation stay with the run around them. */
const DEVA = /[ऀ-ॿ꣠-ꣿ᳐-᳿]/;
const NEUTRAL = /[\s\d.,:;!?()"'\-‌‍–—₹%+/]/;
export function scriptRuns(text: string): { text: string; deva: boolean }[] {
  const out: { text: string; deva: boolean }[] = [];
  let cur = "", deva: boolean | null = null;
  for (const ch of text) {
    const neutral = NEUTRAL.test(ch), d = DEVA.test(ch);
    if (deva === null || neutral || d === deva) {
      cur += ch;
      if (!neutral && deva === null) deva = d;
    } else {
      out.push({ text: cur, deva: deva });
      cur = ch;
      deva = d;
    }
  }
  if (cur) out.push({ text: cur, deva: Boolean(deva) });
  return out;
}

/** Shapes a line into positioned glyphs (in points from the line start, for the given size), in visual order. */
function shape(L: Loaded, text: string, bold: boolean, size: number): { glyphs: Glyph[]; width: number } {
  const glyphs: Glyph[] = [];
  let pen = 0;
  scriptRuns(text).forEach((run, ri) => {
    const tryFont = (key: FontKey) => {
      const f = L.fonts[key];
      const buf = new L.hb.Buffer();
      buf.addText(run.text);
      buf.guessSegmentProperties();
      L.hb.shape(f.font, buf);
      return { key, k: size / f.upem, infos: buf.getGlyphInfos(), pos: buf.getGlyphPositions() };
    };
    const main: FontKey = run.deva ? (bold ? "devaBold" : "deva") : bold ? "latinBold" : "latin";
    const other: FontKey = run.deva ? (bold ? "latinBold" : "latin") : bold ? "devaBold" : "deva";
    let r = tryFont(main);
    // A character the font does not have (glyph 0): use the other font if it has every character.
    if (r.infos.some((g) => g.codepoint === 0)) {
      const alt = tryFont(other);
      if (!alt.infos.some((g) => g.codepoint === 0)) r = alt;
    }
    const starts = [...new Set(r.infos.map((g) => g.cluster))].sort((a, b) => a - b);
    const clusterText = (c: number) => run.text.slice(c, starts.find((s) => s > c) ?? run.text.length);
    // Shares each syllable's characters out among its glyphs: a glyph that is one character's own glyph (in the font's
    // character table) takes that character; whatever is left goes to the first other glyph (a conjunct or combined
    // sign). Compared in decomposed form, so a precomposed letter such as ज़ matches ज + ़.
    const chars = L.fonts[r.key].chars;
    const members = new Map<number, number[]>();
    r.infos.forEach((g, i) => members.set(g.cluster, [...(members.get(g.cluster) ?? []), i]));
    const textFor: string[] = [];
    for (const [cluster, idx] of members) {
      let rest = clusterText(cluster).normalize("NFD");
      const own = idx.map((i) => {
        const c = chars.get(r.infos[i].codepoint)?.normalize("NFD");
        if (c && rest.includes(c)) { rest = rest.replace(c, ""); return c; }
        return undefined;
      });
      let given = false;
      idx.forEach((i, n) => {
        if (own[n] !== undefined) textFor[i] = own[n]!.normalize("NFC");
        else if (!given) { textFor[i] = rest.normalize("NFC"); given = true; }
        else textFor[i] = "";
      });
    }
    r.infos.forEach((g, i) => {
      glyphs.push({ font: r.key, gid: g.codepoint, x: pen + r.pos[i].xOffset * r.k, y: r.pos[i].yOffset * r.k,
        cluster: `${ri}:${g.cluster}`, ctext: clusterText(g.cluster), single: members.get(g.cluster)!.length === 1, text: textFor[i] });
      pen += r.pos[i].xAdvance * r.k;
    });
  });
  return { glyphs, width: pen };
}

/** Word wrap by measured width. A word wider than the line is broken between letters (grapheme clusters). */
function wrapShaped(L: Loaded, text: string, bold: boolean, size: number, width: number): string[] {
  const w = (t: string) => shape(L, t, bold, size).width;
  const out: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/)) {
      if (!word) continue;
      const tryLine = line ? `${line} ${word}` : word;
      if (w(tryLine) <= width) { line = tryLine; continue; }
      if (line) out.push(line);
      if (w(word) <= width) { line = word; continue; }
      line = "";
      for (const { segment: g } of new Intl.Segmenter("hi", { granularity: "grapheme" }).segment(word)) {
        if (line && w(line + g) > width) { out.push(line); line = g; } else line += g;
      }
    }
    out.push(line);
  }
  return out;
}

const hex4 = (n: number) => n.toString(16).padStart(4, "0").toUpperCase();
const utf16hex = (s: string) => [...s].map((ch) => {
  const c = ch.codePointAt(0)!;
  if (c < 0x10000) return hex4(c);
  const v = c - 0x10000;
  return hex4(0xd800 + (v >> 10)) + hex4(0xdc00 + (v & 0x3ff));
}).join("");

async function unicodePdf(lines: PdfLine[]): Promise<Uint8Array> {
  const L = await loadFonts();
  const used = Object.fromEntries((Object.keys(FONTS) as FontKey[]).map((k) => [k, new Map<number, string | undefined>()])) as Record<FontKey, Map<number, string | undefined>>;
  const pages: string[] = [];
  let ops: string[] = [];
  let y = H - M;
  const flush = () => { pages.push(ops.join("\n")); ops = []; y = H - M; };
  for (const l of lines) {
    const size = l.size ?? 11, bold = Boolean(l.bold);
    y -= l.gap ?? 0;
    for (const text of wrapShaped(L, drawable(L, text_(l.text)), bold, size, W - 2 * M)) {
      if (y - size < M) flush();
      y -= size * 1.45;
      const parts: string[] = ["BT"];
      let font: FontKey | null = null, span: string | null = null;
      for (const g of shape(L, text, bold, size).glyphs) {
        const map = used[g.font];
        // Each glyph maps to its own character (ToUnicode). Readers that support ActualText (Acrobat, Chrome) also get
        // each multi-glyph syllable's text in logical order, since Devanagari draws some vowel signs before the consonant.
        if (!map.get(g.gid)) map.set(g.gid, g.single ? g.ctext : g.text || undefined);
        if (g.cluster !== span) {
          if (span !== null) parts.push("EMC");
          span = g.cluster;
          parts.push(g.single ? "/Span <<>> BDC" : `/Span << /ActualText <FEFF${utf16hex(g.ctext)}> >> BDC`);
        }
        if (g.font !== font) { parts.push(`/${FONTS[g.font].tag} ${size} Tf`); font = g.font; }
        parts.push(`1 0 0 1 ${(M + g.x).toFixed(2)} ${(y + g.y).toFixed(2)} Tm <${hex4(g.gid)}> Tj`);
      }
      if (span !== null) parts.push("EMC");
      parts.push("ET");
      ops.push(parts.join("\n"));
    }
  }
  flush();

  // Objects: 1 catalog, 2 pages, then the fonts used, then a page and a content stream per page.
  const objs: (string | Buffer)[] = ["", "", ""];
  const add = (o: string | Buffer) => objs.push(o) - 1;
  const stream = (dict: string, data: Buffer) => Buffer.concat([Buffer.from(`<< ${dict} /Length ${data.length} >>\nstream\n`, "latin1"), data, Buffer.from("\nendstream", "latin1")]);
  const fontRefs: string[] = [];
  for (const key of Object.keys(FONTS) as FontKey[]) {
    const map = used[key];
    if (!map.size) continue;
    const f = L.fonts[key], name = `${String.fromCharCode(65 + fontRefs.length)}AAAAA+${FONTS[key].name}`;
    const ext = f.font.hExtents(), k = 1000 / f.upem;
    const gids = [...map.keys()].sort((a, b) => a - b);
    const sub = Buffer.from(L.subset(f.data, gids));
    const file = add(stream(`/Length1 ${sub.length} /Filter /FlateDecode`, deflateSync(sub)));
    const desc = add(`<< /Type /FontDescriptor /FontName /${name} /Flags 32 /FontBBox [-600 ${Math.round(ext.descender * k)} 2000 ${Math.round(ext.ascender * k)}] /ItalicAngle 0 /Ascent ${Math.round(ext.ascender * k)} /Descent ${Math.round(ext.descender * k)} /CapHeight ${Math.round(ext.ascender * k * 0.7)} /StemV ${key.endsWith("Bold") ? 140 : 80} /FontFile2 ${file} 0 R >>`);
    const widths = gids.map((g) => `${g} [${Math.round(f.font.glyphHAdvance(g) * k)}]`).join(" ");
    const cid = add(`<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${name} /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${desc} 0 R /CIDToGIDMap /Identity /DW 0 /W [${widths}] >>`);
    const mapped = gids.filter((g) => map.get(g));
    const chunks: string[] = [];
    for (let i = 0; i < mapped.length; i += 100) {
      const part = mapped.slice(i, i + 100);
      chunks.push(`${part.length} beginbfchar\n${part.map((g) => `<${hex4(g)}> <${utf16hex(map.get(g)!)}>`).join("\n")}\nendbfchar`);
    }
    const cmap = `/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n${chunks.join("\n")}\nendcmap\nCMapName currentdict /CMap defineresource pop\nend\nend`;
    const toUni = add(stream("/Filter /FlateDecode", deflateSync(Buffer.from(cmap, "latin1"))));
    const type0 = add(`<< /Type /Font /Subtype /Type0 /BaseFont /${name} /Encoding /Identity-H /DescendantFonts [${cid} 0 R] /ToUnicode ${toUni} 0 R >>`);
    fontRefs.push(`/${FONTS[key].tag} ${type0} 0 R`);
  }
  const kids: number[] = [];
  for (const content of pages) {
    const page = objs.length;
    kids.push(page);
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << ${fontRefs.join(" ")} >> >> /Contents ${page + 1} 0 R >>`);
    objs.push(stream("/Filter /FlateDecode", deflateSync(Buffer.from(content, "latin1"))));
  }
  objs[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objs[2] = `<< /Type /Pages /Kids [${kids.map((x) => `${x} 0 R`).join(" ")}] /Count ${pages.length} >>`;

  const parts: Buffer[] = [Buffer.from("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n", "latin1")];
  let size = parts[0].length;
  const offsets: number[] = [];
  for (let i = 1; i < objs.length; i++) {
    offsets[i] = size;
    const body = typeof objs[i] === "string" ? Buffer.from(objs[i] as string, "latin1") : (objs[i] as Buffer);
    const chunk = Buffer.concat([Buffer.from(`${i} 0 obj\n`, "latin1"), body, Buffer.from("\nendobj\n", "latin1")]);
    parts.push(chunk);
    size += chunk.length;
  }
  parts.push(Buffer.from(`xref\n0 ${objs.length}\n0000000000 65535 f \n${offsets.slice(1).map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${size}\n%%EOF\n`, "latin1"));
  return new Uint8Array(Buffer.concat(parts));
}

/** Typographic characters the fonts may lack, made plain (the fonts have ₹, dashes and curly quotes). */
const text_ = (s: string) => s.replace(/[▲]/g, "+").replace(/[▼]/g, "-");

/** Plain stand-ins for symbols neither font has, so they are never silently dropped from a sentence. */
const STAND_IN: Record<string, string> = { "★": "*", "☆": "*", "✓": "OK", "✔": "OK", "✗": "x", "✘": "x", "✕": "x", "→": "->", "←": "<-", "⚠": "!", "❌": "x", "✅": "OK" };
const fontChars = new WeakMap<Loaded, Set<number>>();

/**
 * Replaces every character that neither embedded font can draw: a known symbol by its plain stand-in, anything else
 * by "?" (as the Latin-only PDF does). Combining marks, joiners and spaces are kept (HarfBuzz handles them).
 */
function drawable(L: Loaded, text: string): string {
  let have = fontChars.get(L);
  if (!have) {
    have = new Set<number>();
    for (const f of Object.values(L.fonts)) for (const u of f.covers) have.add(u);
    fontChars.set(L, have);
  }
  const ok = (c: string) => have!.has(c.codePointAt(0)!);
  let out = "";
  for (const ch of text) {
    if (ch === "\uFE0F") continue; // emoji presentation selector: nothing to draw
    if (ok(ch) || /\s|\p{M}|[\u200C\u200D]/u.test(ch) || [...ch.normalize("NFD")].every((c) => ok(c) || /\p{M}/u.test(c))) out += ch;
    else out += STAND_IN[ch] ?? "?";
  }
  return out;
}

/** The report PDF: Helvetica for Latin-only text, the embedded Unicode fonts (shaped) for anything else. */
export async function reportPdf(lines: PdfLine[]): Promise<Uint8Array> {
  return latinOnly(lines) ? textPdf(lines) : unicodePdf(lines);
}

/** For tests: the glyphs HarfBuzz produces for a line, in visual order. */
export async function shapeForTest(text: string, bold = false) {
  return shape(await loadFonts(), text, bold, 11).glyphs;
}
