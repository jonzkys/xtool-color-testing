import { Badge, Card, CardHeader, CardTitle } from "../../ui";
import type { ForgeEstimate } from "../../lib/forge/estimate";
import { fmtDuration } from "../../lib/cuttime/model";

const label = (group: string) => group.replace(/^CUT_\d+_/, "").replace(/_/g, " ");

export function ForgeEstimatePanel({ estimate }: { estimate: ForgeEstimate | null }) {
  if (!estimate || estimate.stages.length === 0) return null;
  const { totalSeconds, baselineSeconds, overheadPct, overBudget, budgetX } = estimate;
  const pctText = overheadPct ? `${Math.round(overheadPct)}% of incise` : "—";
  return (
    <Card>
      <CardHeader><CardTitle>Estimated cut time</CardTitle></CardHeader>
      <div className="p-2 font-mono text-[11px] flex flex-col gap-2">
        <div className="flex items-baseline justify-between">
          <span className="text-[var(--color-ink)] text-sm tabular-nums">{fmtDuration(totalSeconds)}</span>
          {/* Only the confirmed `warning` variant is used (matches ForgeDebugPanel);
              the neutral case is a plain muted span. */}
          {overBudget
            ? <Badge variant="warning">{pctText}</Badge>
            : <span className="text-[var(--color-ink-muted)] tabular-nums">{pctText}</span>}
        </div>
        <table className="w-full table-fixed">
          <colgroup><col /><col className="w-14" /><col className="w-10" /><col className="w-12" /></colgroup>
          <thead>
            <tr className="text-left text-[var(--color-ink-muted)]">
              <th>stage</th><th className="text-right">time</th><th className="text-right">%</th><th className="text-right">sl×rp</th>
            </tr>
          </thead>
          <tbody>
            {estimate.stages.map((s) => (
              <tr key={s.groupName}>
                <td className="truncate">{label(s.groupName)}{s.pathCount > 1 ? ` ×${s.pathCount}` : ""}</td>
                <td className="text-right tabular-nums">{fmtDuration(s.seconds)}</td>
                <td className="text-right tabular-nums">{totalSeconds ? Math.round((s.seconds / totalSeconds) * 100) : 0}</td>
                <td className="text-right tabular-nums">{s.sliceNumber}×{s.repeat}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="text-[10px] text-[var(--color-ink-subtle)] flex flex-wrap gap-x-3 gap-y-0.5">
          <span>baseline incise {fmtDuration(baselineSeconds)}</span>
          <span>pierces {estimate.pierces}</span>
          <span>pockets {estimate.pocketCount}</span>
          <span>bands {estimate.bandCount}</span>
          {budgetX != null && <span>budget {budgetX}×</span>}
        </div>
      </div>
    </Card>
  );
}
