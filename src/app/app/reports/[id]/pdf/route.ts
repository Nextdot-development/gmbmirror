import { NextRequest, NextResponse } from "next/server";
import { requireScope } from "@/lib/ctx";
import { db } from "@/lib/store";
import { monthlyReportPdf, reportFileName } from "@/lib/report-pdf";
import type { MonthlyReport } from "@/lib/types";

/** One report of the current location as a PDF. Another location's or user's report is never found here. */
export async function GET(_: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { scope } = await requireScope();
  const r = (await db.getLocal<MonthlyReport[]>(scope, "reports", [])).find((x) => x.id === id);
  if (!r) return NextResponse.json({ error: "Report not found." }, { status: 404 });
  return new NextResponse(Buffer.from(await monthlyReportPdf(r)), {
    headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="${reportFileName(r)}"`, "cache-control": "private, no-store" },
  });
}
