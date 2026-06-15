// web/src/components/forge/SpiralGeometryPanel.tsx
// Live path-geometry readout for the Spiral Cut page: how the current outline +
// Simplify / Max-points settings turn into exported cut objects, BEFORE export.
// Replaces the raw debug dump — the only residual debug (mm/unit) lives here too.
import { Card, CardHeader, CardTitle } from "../../ui";
import type { DebugStats, SpiralConfig } from "../../lib/forge/types";

function Row({ label, value, tone }: { label: string; value: string | number; tone?: "ok" | "warn" }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-[var(--color-ink-muted)]">{label}</span>
      <span
        className={
          "font-mono text-[12px] tabular-nums " +
          (tone === "warn"
            ? "text-[color:var(--color-destructive)]"
            : tone === "ok"
            ? "text-[var(--color-primary)]"
            : "text-[var(--color-ink)]")
        }
      >
        {value}
      </span>
    </div>
  );
}

export function SpiralGeometryPanel({ stats, spiral }: { stats: DebugStats | null; spiral: SpiralConfig }) {
  if (!stats) return null;
  const objs = stats.spiralExportObjects;
  const strands = stats.pathCounts.spiral;
  // Distinguish WHY there's more than one object: the cap chunked a path
  // ("cap-split", Max-points fixes it) vs the geometry has several disconnected
  // strands ("multi-path", raising Max-points won't help).
  const status = objs <= 1 ? "continuous" : objs > strands ? "cap-split" : "multi-path";
  return (
    <Card>
      <CardHeader>
        <CardTitle>Path geometry</CardTitle>
      </CardHeader>
      <div className="flex flex-col gap-1.5 p-2">
        <Row label="Cut objects" value={`${objs} · ${status}`} tone={objs <= 1 ? "ok" : "warn"} />
        <Row label="Spiral paths" value={strands} />
        <Row label="Points" value={stats.spiralPoints.toLocaleString()} />
        <div className="my-0.5 border-t border-[var(--color-border)]" />
        <Row label="Simplify" value={`${spiral.simplifyEpsMm} mm`} />
        <Row label="Max / path" value={spiral.maxPathPoints.toLocaleString()} />
        <Row
          label="mm / unit"
          value={`${stats.mmPerUnit.toFixed(4)}${stats.mmPerUnitConfident ? " ✓" : " ⚠"}`}
        />
      </div>
    </Card>
  );
}
