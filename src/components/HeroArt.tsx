import { CheckCircle, Sparkle } from "@phosphor-icons/react/dist/ssr";

/**
 * Hero illustration: a small neighbourhood drawn as an isometric map in white and blue, with one business
 * standing out under a location pin. Drawn in markup so it stays sharp at any size and needs no image file.
 * Decorative sample content, described to screen readers by one label.
 */
const CX = 520, CY = 60, CELL = 120, PAD = 14, SIZE = CELL - PAD * 2, N = 5;
type Pt = readonly [number, number];
const P = (x: number, y: number, z = 0): Pt => [0.866 * (x - y) + CX, 0.5 * (x + y) + CY - z];
const pts = (a: Pt[]) => a.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");

const HEIGHTS: Record<string, number> = { "0,1": 44, "1,3": 66, "2,0": 34, "2,2": 104, "3,4": 50, "4,1": 60, "3,1": 26, "1,0": 22, "4,3": 36, "0,4": 30, "1,1": 18 };
const MAIN = "2,2";

const BLOCKS = Array.from({ length: N * N }, (_, k) => {
  const i = k % N, j = Math.floor(k / N);
  return { key: `${i},${j}`, x: i * CELL + PAD, y: j * CELL + PAD, h: HEIGHTS[`${i},${j}`] ?? 0, order: i + j };
}).sort((a, b) => a.order - b.order);

const PIN = "M0 0C-14-24-26-34-26-52a26 26 0 1 1 52 0C26-34 14-24 0 0Z";

export function HeroArt() {
  const main = BLOCKS.find((b) => b.key === MAIN)!;
  const [mx, my] = P(main.x + SIZE / 2, main.y + SIZE / 2, main.h);
  const small: Pt[] = [P(60, 420), P(540, 540), P(420, 180)];
  return (
    <div className="relative mx-auto aspect-[1040/690] w-full max-w-[720px]" role="img" aria-label="Illustration: a neighbourhood map with one business highlighted by a location pin, and example cards for a review, an AI answer and a profile checklist">
      <svg viewBox="0 0 1040 690" className="absolute inset-0 h-full w-full overflow-visible" aria-hidden>
        {/* ground slab */}
        <polygon points={pts([P(0, 600), P(600, 600), P(600, 600, -20), P(0, 600, -20)])} fill="#c9d7fa" />
        <polygon points={pts([P(600, 0), P(600, 600), P(600, 600, -20), P(600, 0, -20)])} fill="#b3c6f6" />
        <polygon points={pts([P(0, 0), P(600, 0), P(600, 600), P(0, 600)])} fill="#f5f8ff" stroke="#80a5ff" strokeOpacity="0.6" />

        {/* streets */}
        {Array.from({ length: N - 1 }, (_, k) => (k + 1) * CELL).map((v) => (
          <g key={v} stroke="#2463ff" strokeOpacity="0.2" strokeDasharray="3 9" strokeLinecap="round">
            <polyline points={pts([P(v, 0), P(v, 600)])} fill="none" />
            <polyline points={pts([P(0, v), P(600, v)])} fill="none" />
          </g>
        ))}

        {/* a route along the streets to the highlighted business */}
        <polyline points={pts([P(120, 600), P(120, 480), P(360, 480), P(360, 360)])} fill="none" stroke="#2463ff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="1 10" />

        {/* small pins on the ground */}
        {small.map(([x, y], i) => (
          <g key={i} transform={`translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(0.5)`}>
            <path d={PIN} fill="#80a5ff" />
            <circle cx="0" cy="-52" r="10" fill="#ffffff" />
          </g>
        ))}

        {/* blocks and buildings, back to front */}
        {BLOCKS.map((b) => {
          const { x, y, h } = b, s = SIZE, isMain = b.key === MAIN;
          if (!h) return <polygon key={b.key} points={pts([P(x, y), P(x + s, y), P(x + s, y + s), P(x, y + s)])} fill="#e8eeff" fillOpacity="0.7" stroke="#80a5ff" strokeOpacity="0.35" />;
          return (
            <g key={b.key}>
              <polygon points={pts([P(x, y + s), P(x + s, y + s), P(x + s, y + s, h), P(x, y + s, h)])} fill={isMain ? "#2463ff" : "#dce5f5"} />
              <polygon points={pts([P(x + s, y), P(x + s, y + s), P(x + s, y + s, h), P(x + s, y, h)])} fill={isMain ? "#1749d6" : "#b9cbef"} />
              <polygon points={pts([P(x, y, h), P(x + s, y, h), P(x + s, y + s, h), P(x, y + s, h)])} fill={isMain ? "#ffffff" : "#ffffff"} stroke="#dce5f5" />
            </g>
          );
        })}

        {/* highlighted business */}
        <ellipse className="pulse-ring" cx={mx} cy={my} rx="58" ry="33" fill="none" stroke="#2463ff" strokeWidth="2" />
        <ellipse cx={mx} cy={my} rx="20" ry="11" fill="#1749d6" opacity="0.2" />
        <g className="float" >
          <g transform={`translate(${mx.toFixed(1)} ${my.toFixed(1)}) scale(1.25)`}>
            <path d={PIN} fill="#1749d6" transform="translate(5 0)" />
            <path d={PIN} fill="#2463ff" />
            <circle cx="0" cy="-52" r="11" fill="#ffffff" />
          </g>
        </g>
      </svg>

      {/* floating example cards */}
      <div className="float-slow absolute left-0 top-[2%] w-[40%] max-w-[230px] rounded-2xl bg-surface p-3 text-ink shadow-[var(--shadow-lift)] sm:p-4">
        <p className="caption-4 flex items-center gap-1.5 text-brand"><Sparkle size={14} weight="fill" className="text-accent" /> AI answer</p>
        <p className="caption-1 mt-1.5">&ldquo;A few clinics people mention are&hellip;&rdquo;</p>
        <p className="caption-5 mt-2 text-muted">Is your name in it?</p>
      </div>
      <div className="float absolute right-0 top-[8%] w-[38%] max-w-[220px] rounded-2xl bg-surface p-3 text-ink shadow-[var(--shadow-lift)] sm:p-4">
        <p className="tracking-[2px] text-star">★★★★★</p>
        <p className="caption-1 mt-1">&ldquo;Explained everything clearly.&rdquo;</p>
        <p className="caption-5 mt-2 inline-flex items-center gap-1 text-ok"><CheckCircle size={14} weight="fill" /> Reply drafted</p>
      </div>
      <div className="float-slow absolute bottom-0 right-[4%] w-[38%] max-w-[220px] rounded-2xl bg-surface p-3 text-ink shadow-[var(--shadow-lift)] sm:p-4">
        <p className="caption-4 text-muted">Profile checklist</p>
        <p className="title-4 mt-1">8 of 11 done</p>
        <div className="meter mt-2"><span style={{ width: "73%" }} /></div>
      </div>
    </div>
  );
}
