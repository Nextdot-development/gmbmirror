import { NextRequest, NextResponse } from "next/server";
import { requireScope } from "@/lib/ctx";
import { db } from "@/lib/store";
import { reportPdf, type PdfLine } from "@/lib/pdf";
import { BRAND } from "@/lib/brand";
import type { MonthlyReport } from "@/lib/types";

/** One report of the current location as a PDF. Another location's or user's report is never found here. */
export async function GET(_: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { scope } = await requireScope();
  const r = (await db.getLocal<MonthlyReport[]>(scope, "reports", [])).find((x) => x.id === id);
  if (!r) return NextResponse.json({ error: "Report not found." }, { status: 404 });
  const lines: PdfLine[] = [
    { text: `${r.business}, ${r.location}`, size: 18, bold: true },
    { text: `Monthly report: ${r.month}${r.partial ? " (month to date)" : ""}`, size: 13, gap: 4 },
    { text: `Made ${r.generatedAt.slice(0, 16).replace("T", " ")} UTC`, size: 9, gap: 2 },
    { text: "Summary", size: 13, bold: true, gap: 14 },
    { text: r.summary ?? `AI summary not available${r.summaryError ? `: ${r.summaryError}` : "."}`, gap: 4 },
    ...(r.summary ? [{ text: "Written by Claude from the facts below.", size: 8, gap: 2 }] : []),
  ];
  for (const s of r.sections) {
    lines.push({ text: s.title, size: 13, bold: true, gap: 14 });
    if (s.available) for (const l of s.lines) lines.push({ text: `- ${l}`, gap: 2 });
    if (s.reason) lines.push({ text: s.available ? s.reason : `Not available: ${s.reason}`, size: 9, gap: 2 });
  }
  lines.push({ text: `Made with ${BRAND.name}. Questions: ${BRAND.email}`, size: 8, gap: 18 });
  return new NextResponse(Buffer.from(await reportPdf(lines)), {
    headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="report-${r.month}.pdf"`, "cache-control": "private, no-store" },
  });
}
