// web/src/components/forge/SpiralGeometryHelp.tsx
//
// "?" help affordance for the Spiral page's Cut geometry controls: a small
// trigger by the heading opens a modal with an annotated diagram of the spiral
// channel plus plain definitions. Self-contained — owns its open state — so the
// rail just drops <SpiralGeometryHelp /> into the card header.
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "../../ui";

const SPIRAL = "#ec4899"; // matches the canvas spiral arms
const EDGE = "#64748b"; // slate — the part edge, matches the canvas source contour

/** Annotated, not-to-scale diagram of the spiral channel. aria-hidden — the
 *  definition list below carries the accessible description. */
function GeometryDiagram() {
  // Part edge (rounded rect) + concentric arms fanning outward on the scrap side.
  const px = 64, py = 58, pw = 118, ph = 82, pr = 18; // part rect
  const arms = [1, 2, 3, 4, 5];
  const step = 9; // visual pitch between arms
  return (
    <svg
      viewBox="0 0 470 196"
      className="w-full"
      role="img"
      aria-hidden
      style={{ background: "var(--color-bg)" }}
    >
      <defs>
        <linearGradient id="sg-arms" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor={SPIRAL} stopOpacity="0.35" />
          <stop offset="1" stopColor={SPIRAL} stopOpacity="0.7" />
        </linearGradient>
      </defs>

      {/* concentric spiral arms (outermost first) */}
      {arms
        .slice()
        .reverse()
        .map((k) => {
          const i = k * step;
          return (
            <rect
              key={k}
              x={px - i}
              y={py - i}
              width={pw + 2 * i}
              height={ph + 2 * i}
              rx={pr + i}
              fill="none"
              stroke={SPIRAL}
              strokeOpacity={0.3 + (1 - k / 5) * 0.45}
              strokeWidth={1}
            />
          );
        })}

      {/* the part itself */}
      <rect x={px} y={py} width={pw} height={ph} rx={pr} fill="rgba(100,116,139,0.07)" stroke={EDGE} strokeWidth={1.4} />
      {/* an interior hole, with one inside arm — the "inside" case */}
      <circle cx={px + pw / 2} cy={py + ph / 2} r={15} fill="none" stroke={EDGE} strokeWidth={1.2} />
      <circle cx={px + pw / 2} cy={py + ph / 2} r={9} fill="none" stroke={SPIRAL} strokeWidth={1} strokeOpacity={0.7} />

      {/* entry dot on the outermost arm */}
      <circle cx={px + pw / 2} cy={py - 5 * step} r={3} fill={SPIRAL} />

      {/* ── channel width: edge → outermost arm, on the right ── */}
      {(() => {
        const y = py + ph / 2;
        const x0 = px + pw; // part right edge
        const x1 = px + pw + 5 * step; // outer arm right edge
        return (
          <g stroke={EDGE} strokeWidth={1} fill="none">
            <line x1={x0} y1={y - 7} x2={x0} y2={y + 7} />
            <line x1={x1} y1={y - 7} x2={x1} y2={y + 7} />
            <line x1={x0} y1={y} x2={x1} y2={y} />
            <path d={`M${x0 + 3} ${y - 3} L${x0} ${y} L${x0 + 3} ${y + 3}`} />
            <path d={`M${x1 - 3} ${y - 3} L${x1} ${y} L${x1 - 3} ${y + 3}`} />
          </g>
        );
      })()}
      <text x={px + pw + 5 * step + 10} y={py + ph / 2 - 2} className="sg-label" fill="var(--color-ink-muted)">CHANNEL WIDTH</text>
      <text x={px + pw + 5 * step + 10} y={py + ph / 2 + 11} className="sg-sub" fill="var(--color-ink-subtle)">edge → outer arm</text>

      {/* ── pitch: magnifier callout of two adjacent arms ── */}
      <line x1={px + pw / 2 + 16} y1={py - 5 * step} x2={326} y2={44} stroke={EDGE} strokeWidth={0.75} strokeDasharray="2 2" />
      <g>
        <circle cx={352} cy={44} r={30} fill="var(--color-surface)" stroke="var(--color-border)" strokeWidth={1} />
        <line x1={336} y1={36} x2={368} y2={36} stroke={SPIRAL} strokeWidth={1.2} />
        <line x1={336} y1={52} x2={368} y2={52} stroke={SPIRAL} strokeWidth={1.2} />
        <g stroke={EDGE} strokeWidth={1} fill="none">
          <line x1={352} y1={37} x2={352} y2={51} />
          <path d={`M349 39 L352 36 L355 39`} />
          <path d={`M349 49 L352 52 L355 49`} />
        </g>
      </g>
      <text x={388} y={41} className="sg-label" fill="var(--color-ink-muted)">PITCH</text>
      <text x={388} y={54} className="sg-sub" fill="var(--color-ink-subtle)">arm spacing</text>

      {/* ── side labels: outside arms (top-left leader) + inside hole (in body) ── */}
      <line x1={30} y1={26} x2={60} y2={16} stroke={EDGE} strokeWidth={0.75} strokeDasharray="2 2" />
      <text x={12} y={22} className="sg-label" fill="var(--color-ink-muted)">OUTSIDE · scrap</text>
      <text x={px + pw / 2} y={py + ph / 2 + 27} textAnchor="middle" className="sg-sub" fill="var(--color-ink-subtle)">INSIDE · holes</text>

      <style>{`
        .sg-label { font-family: var(--font-mono, ui-monospace, monospace); font-size: 9px; letter-spacing: 0.12em; }
        .sg-sub { font-family: var(--font-mono, ui-monospace, monospace); font-size: 8px; letter-spacing: 0.04em; }
      `}</style>
    </svg>
  );
}

const PARAMS: Array<{ name: string; body: string }> = [
  {
    name: "Channel width",
    body: "Total width of the venting channel swept on the scrap side of the contour. Wider channels vent more and sever more cleanly — 0.8 mm cuts 3 mm brass through. (mm)",
  },
  {
    name: "Pitch",
    body: "Spacing between adjacent spiral arms — set to roughly a beam width so the arms overlap and the whole channel ablates with no uncut ridges between passes. (mm)",
  },
  {
    name: "Min channel",
    body: "The narrowest the channel is allowed to shrink to where scrap is tight (a thin neck between features). Below this, Forge stops narrowing and warns instead of cutting an unventable sliver. (mm)",
  },
  {
    name: "Side",
    body: "Which side of the contour the channel runs. Outside spirals into the scrap around the silhouette (the usual cut-out); inside spirals into holes.",
  },
];

export function SpiralGeometryHelp() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          title="What do these settings do?"
          aria-label="What do these cut-geometry settings do?"
          className="shrink-0 grid h-5 w-5 place-items-center rounded-[5px] border border-[var(--color-border)] text-[var(--color-ink-muted)] hover:text-[var(--color-primary)] hover:border-[var(--color-primary)]/50 transition-colors"
        >
          <span aria-hidden className="text-[11px] leading-none font-semibold">?</span>
        </button>
      </DialogTrigger>
      <DialogContent width="lg">
        <DialogHeader>
          <DialogTitle>Cut geometry</DialogTitle>
          <DialogDescription>How the spiral channel is built around your part.</DialogDescription>
        </DialogHeader>

        <div className="rounded-[10px] border border-[var(--color-border)] overflow-hidden">
          <GeometryDiagram />
        </div>

        <dl className="mt-4 grid grid-cols-[120px_1fr] gap-x-4 gap-y-3">
          {PARAMS.map((p) => (
            <div key={p.name} className="contents">
              <dt className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.1em] text-[var(--color-ink-muted)] pt-0.5">
                {p.name}
              </dt>
              <dd className="text-[13px] leading-snug text-[var(--color-ink)]">{p.body}</dd>
            </div>
          ))}
        </dl>

        <p className="mt-4 text-[11px] text-[var(--color-ink-subtle)]">
          The preview is a schematic — arm spacing is exaggerated so the passes read; the real cut packs them at the pitch above.
        </p>
      </DialogContent>
    </Dialog>
  );
}
