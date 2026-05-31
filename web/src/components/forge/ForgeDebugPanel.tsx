// web/src/components/forge/ForgeDebugPanel.tsx
import { Badge, Card, CardHeader, CardTitle } from "../../ui";
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
    <Card>
      <CardHeader><CardTitle>Debug</CardTitle></CardHeader>
      <div className="p-2 font-mono text-[11px] flex flex-col gap-1">
        <div>mm/unit: {stats.mmPerUnit.toFixed(4)} {stats.mmPerUnitConfident ? "✓" : "⚠ unconfident"}</div>
        <div>paths: total {stats.totalPaths} — seed {stats.pathCounts.seed}, perforate {stats.pathCounts.perforate}, deepen {stats.pathCounts.deepen}, clean {stats.pathCounts.clean}</div>
        <div>
          scan ∠: {stats.scanAngleDeg}° {optimizeScanAngle ? "(applied)" : "(off)"}
          {stats.scanAngleReductionPct != null && stats.scanAngleReductionPct > 0 && (
            <> · {stats.scanAngleReductionPct}% fewer lines vs {stats.scanAngleBaselineDeg}°</>
          )}
        </div>
        {stats.warnings.length > 0 && (
          <div className="flex flex-col gap-1 mt-1">
            {stats.warnings.map((w, i) => (
              <Badge key={i} variant="warning">{w}</Badge>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}
