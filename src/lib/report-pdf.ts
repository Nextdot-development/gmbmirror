import "server-only";
import { reportPdf, type PdfLine } from "./pdf";
import { BRAND } from "./brand";
import type { MonthlyReport } from "./types";

/** The PDF of one monthly report: the same file for the download and the email attachment. */
export async function monthlyReportPdf(r: MonthlyReport): Promise<Uint8Array> {
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
  return reportPdf(lines);
}

export const reportFileName = (r: MonthlyReport) => `report-${r.month}.pdf`;
