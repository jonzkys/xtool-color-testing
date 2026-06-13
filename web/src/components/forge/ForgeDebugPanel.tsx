// web/src/components/forge/ForgeDebugPanel.tsx
import { Badge, Card } from "../../ui";
import type { DebugStats } from "../../lib/forge/types";

export function ForgeDebugPanel({
  stats,
  optimizeScanAngle,
}: {
  stats: DebugStats | null;
  optimizeScanAngle?: boolean;
}) {
  if (!stats) return null;
  return (
    <Card padded={false} className="p-2">
      <details>
        <summary className="cursor-pointer select-none list-none font-mono text-[10.5px] font-semibold uppercase tracking-[0.18em] text-[var(--color-ink-muted)] hover:text-[var(--color-ink)] transition-colors px-1 py-0.5">
          Debug
        </summary>
        <div className="p-1 pt-2 font-mono text-[11px] flex flex-col gap-1">
          <div>mm/unit: {stats.mmPerUnit.toFixed(4)} {stats.mmPerUnitConfident ? "✓" : "⚠ unconfident"}</div>
          <div>paths: total {stats.totalPaths} — seed {stats.pathCounts.seed}, perforate {stats.pathCounts.perforate}, deepen {stats.pathCounts.deepen}, clean {stats.pathCounts.clean}, spiral {stats.pathCounts.spiral}</div>
          <div>
            scan ∠: {stats.scanAngleDeg}° {optimizeScanAngle ? "(applied)" : "(off)"}
            {stats.scanAngleReductionPct != null && stats.scanAngleReductionPct > 0 && (
              <> · {stats.scanAngleReductionPct}% fewer lines vs {stats.scanAngleBaselineDeg}°</>
            )}
          </div>
          {stats.warnings.length > 0 && (
            <div className="flex flex-col gap-1 mt-1">
              {stats.warnings.map((w, i) => (
                <Badge key={i} variant="warning" className="block w-full whitespace-normal break-words rounded-md text-left py-1">{w}</Badge>
              ))}
            </div>
          )}
        </div>
      </details>
    </Card>
  );
}
