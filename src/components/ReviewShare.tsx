"use client";
import { useState } from "react";
import { DownloadSimple, WhatsappLogo } from "@phosphor-icons/react";
import { recordShareEventAction } from "@/app/actions";

/**
 * Share the review link on WhatsApp (wa.me) and download a print-ready QR code.
 * Everyone gets the same link; nothing here filters customers by rating.
 */
export function ReviewShare({ message, businessName, printQr, caption, link }: { message: string; businessName: string; printQr: string; caption: string; link: string }) {
  const [copied, setCopied] = useState<string>();
  async function copy(text: string, kind: "link_copied" | "message_copied", done: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(done);
      void recordShareEventAction(kind);
    } catch {
      setCopied("Copying is blocked in this browser. Select the text and copy it.");
    }
  }
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);

  // wa.me needs the number in international form, digits only. A 10-digit number is treated as Indian (+91).
  const digits = phone.replace(/\D/g, "");
  const intl = digits.length === 10 ? `91${digits}` : digits.length === 11 && digits.startsWith("0") ? `91${digits.slice(1)}` : digits;
  const phoneOk = digits.length === 0 || intl.length >= 11;
  const waHref = `https://wa.me/${phoneOk ? intl : ""}?text=${encodeURIComponent(message)}`;

  async function downloadQr() {
    setBusy(true);
    try {
      const img = new Image();
      img.src = printQr;
      await img.decode();
      const W = 1000, PAD = 80, QR = 800;
      const font = getComputedStyle(document.body).fontFamily || "sans-serif";
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d")!;

      // Wrap the business name to at most two lines.
      ctx.font = `700 56px ${font}`;
      const words = businessName.split(/\s+/);
      const lines: string[] = [];
      let line = "";
      for (const w of words) {
        const next = line ? `${line} ${w}` : w;
        if (ctx.measureText(next).width > W - PAD * 2 && line) { lines.push(line); line = w; } else line = next;
      }
      lines.push(line);
      const nameLines = lines.slice(0, 2);
      const top = PAD + nameLines.length * 68;

      canvas.width = W;
      canvas.height = top + 24 + QR + 120;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.textAlign = "center";
      ctx.fillStyle = "#171a22";
      ctx.font = `700 56px ${font}`;
      nameLines.forEach((l, i) => ctx.fillText(l, W / 2, PAD + 56 + i * 68));
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, (W - QR) / 2, top + 24, QR, QR);
      ctx.fillStyle = "#667085";
      ctx.font = `500 36px ${font}`;
      ctx.fillText(caption, W / 2, top + 24 + QR + 70);

      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
      if (!blob) return;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `review-qr-${businessName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "business"}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      void recordShareEventAction("qr_downloaded");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-full max-w-[260px]">
          <label htmlFor="wa-phone" className="label">Customer&apos;s WhatsApp number (optional)</label>
          <input id="wa-phone" className="field" inputMode="tel" placeholder="98765 43210" value={phone} onChange={(e) => setPhone(e.target.value)}
            aria-invalid={!phoneOk} aria-describedby="wa-hint" />
        </div>
        <a href={waHref} target="_blank" rel="noopener noreferrer" className="btn btn-primary btn-sm" aria-disabled={!phoneOk} onClick={() => void recordShareEventAction("whatsapp_opened")}>
          <WhatsappLogo size={18} weight="fill" aria-hidden /> Share on WhatsApp
        </a>
        <button type="button" className="btn btn-secondary btn-sm" onClick={downloadQr} disabled={busy}>
          <DownloadSimple size={18} aria-hidden /> {busy ? "Preparing" : "Download QR"}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => copy(link, "link_copied", "Review link copied.")}>Copy link</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => copy(message, "message_copied", "Message copied.")}>Copy message</button>
      </div>
      <p id="wa-hint" className={phoneOk ? "hint" : "field-error"}>
        {phoneOk ? "Leave the number empty to pick a contact in WhatsApp. 10-digit numbers get +91 added." : "Enter the full number, with country code if it is not an Indian number."}
      </p>
      {copied ? <p role="status" className="caption-1 text-ok">{copied}</p> : null}
      <p className="caption-2 rounded-xl border border-line bg-surface-2 p-3 text-muted"><span className="caption-3 text-ink">Message: </span>{message}</p>
    </div>
  );
}
