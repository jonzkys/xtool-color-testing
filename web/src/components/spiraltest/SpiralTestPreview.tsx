import type { SpiralTestResult } from "../../lib/forge/spiralTest";

interface Props { result: SpiralTestResult; }

/** Draw the generated cut arms (dark) + label strokes (ember) + footprint box. */
export function SpiralTestPreview({ result }: Props) {
  const { footprintMm: f } = result;
  const path = (poly: { x: number; y: number }[]) =>
    poly.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${f.w} ${f.h}`} className="h-full w-full" role="img"
      aria-label="Spiral test grid preview" style={{ background: "var(--color-surface)" }}>
      <rect x={0} y={0} width={f.w} height={f.h} fill="none"
        stroke={result.overBed ? "var(--color-primary)" : "var(--color-border)"} strokeWidth={0.3} />
      {result.cutPaths.map((p, i) =>
        p.rings.map((ring, j) => (
          <path key={`c${i}-${j}`} d={path(ring)} fill="none" stroke="var(--color-ink)" strokeWidth={0.15} opacity={0.7} />
        )),
      )}
      {result.labelOutlines.map((lbl, i) => (
        <path key={`l${i}`} d={lbl.rings.map((r) => path(r) + "Z").join(" ")}
          fillRule="nonzero" fill="var(--color-primary)" stroke="none" />
      ))}
    </svg>
  );
}
