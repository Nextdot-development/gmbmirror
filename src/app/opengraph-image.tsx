import { ImageResponse } from "next/og";
import { BRAND } from "@/lib/brand";

export const alt = `${BRAND.name}: ${BRAND.tagline}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", background: "radial-gradient(circle at 92% 95%, rgba(36, 99, 255, 0.28), transparent 45%), linear-gradient(160deg, #ffffff 0%, #f5f8ff 55%, #e8eeff 100%)", color: "#171a22", display: "flex", flexDirection: "column", justifyContent: "center", padding: 80 }}>
        <div style={{ display: "flex", fontSize: 34, fontWeight: 700, marginBottom: 24, letterSpacing: -1 }}>
          <span style={{ color: "#171a22" }}>GMB</span><span style={{ color: "#2463ff" }}>mirror</span>
        </div>
        <div style={{ fontSize: 72, fontWeight: 700, lineHeight: 1.05, letterSpacing: -2 }}>See how your business looks on Google and in AI answers</div>
      </div>
    ),
    size,
  );
}
