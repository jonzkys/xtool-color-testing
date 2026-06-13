// web/src/components/forge/ForgeEstimateStrip.tsx
//
// Horizontal "instrument readout" for the cut-time estimate. Lives at the top
// of the Forge workbench so the time consequence of every knob is always in
// view — the hero number, a stage-share bar coloured like the canvas layers,
// and the budget verdict. Replaces the old right-rail ForgeEstimatePanel.
//
// Renders a placeholder register (em-dashes, empty bar) before the first
// pipeline result so the layout never reflows when the estimate pops in.
import { Badge, Card } from "../../ui";
import type { ForgeEstimate } from "../../lib/forge/estimate";
import { fmtDuration } from "../../lib/cuttime/model";
import { CLASS_COLOR } from "./ForgeCanvas";
import type { GeneratedClass } from "../../lib/forge/types";

/** Stage group → generated class, for colour-matching the canvas legend. */
function classOf(groupName: string): GeneratedClass {
  if (groupName.includes("SEED")) return "seed";
  if (groupName.includes("PERFORATE")) return "perforate";
  if (groupName.includes("CLEAN")) return "clean";
  if (groupName.includes("SPIRAL")) return "spiral";
  return "deepen";
}

const label = (group: string) => group.replace(/^CUT_\d+_/, "").replace(/_/g, " ");

export function ForgeEstimateStrip({
  estimate,
  variant = "full",
}: {
  estimate: ForgeEstimate | null;
  /** "spiral" trims the multi-stage chrome (share bar, per-stage chips,
   *  pockets/bands/budget) that is meaningless for a single continuous cut. */
  variant?: "full" | "spiral";
}) {
  const has = !!estimate && estimate.stages.length > 0;
  const total = has ? estimate.totalSeconds : 0;
  const pctText = has && estimate.overheadPct ? `${Math.round(estimate.overheadPct)}% of incise` : "—";

  if (variant === "spiral") {
    const stage = has ? estimate!.stages[0] : null;
    return (
      <Card padded={false} className="shrink-0 flex items-center gap-5 px-4 py-2.5">
        <div className="shrink-0">
          <div className="font-mono text-[9.5px] font-semibold uppercase tracking-[0.22em] text-[var(--color-ink-subtle)]">
            Estimated cut time
          </div>
          <div className="mt-0.5 font-mono text-[26px] leading-none tabular-nums text-[var(--color-primary)]">
            {has ? fmtDuration(total) : "—:——"}
          </div>
        </div>

        <div aria-hidden className="h-10 w-px shrink-0 bg-[var(--color-border)]" />

        {/* continuity + passes — the spiral's own readout, not a stage breakdown */}
        <div className="min-w-0 flex-1 font-mono text-[11px] tabular-nums text-[var(--color-ink-muted)]">
          {has && stage ? (
            <span className="inline-flex items-center gap-2">
              <span
                aria-hidden
                className="inline-block h-2 w-2 rounded-[2px]"
                style={{ backgroundColor: CLASS_COLOR.spiral }}
              />
              <span className="uppercase tracking-[0.08em] text-[var(--color-ink-subtle)]">
                {stage.pathCount <= 1 ? "continuous spiral" : `${stage.pathCount} spirals`}
              </span>
              · {stage.repeat} pass{stage.repeat === 1 ? "" : "es"}
            </span>
          ) : (
            <span className="text-[var(--color-ink-subtle)]">awaiting first result…</span>
          )}
        </div>

        {/* % of incise + baseline only */}
        <div className="shrink-0 text-right">
          <span className="font-mono text-[12px] tabular-nums text-[var(--color-ink-muted)]">{pctText}</span>
          <div className="mt-1 font-mono text-[10px] tabular-nums text-[var(--color-ink-subtle)]">
            {has ? <>vs baseline {fmtDuration(estimate!.baselineSeconds)}</> : <>&nbsp;</>}
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card padded={false} className="shrink-0 flex items-center gap-5 px-4 py-2.5">
      {/* hero number */}
      <div className="shrink-0">
        <div className="font-mono text-[9.5px] font-semibold uppercase tracking-[0.22em] text-[var(--color-ink-subtle)]">
          Estimated cut time
        </div>
        <div className="mt-0.5 font-mono text-[26px] leading-none tabular-nums text-[var(--color-primary)]">
          {has ? fmtDuration(total) : "—:——"}
        </div>
      </div>

      <div aria-hidden className="h-10 w-px shrink-0 bg-[var(--color-border)]" />

      {/* stage-share bar + per-stage readout */}
      <div className="min-w-0 flex-1">
        <div className="flex h-2.5 overflow-hidden rounded-full border border-[var(--color-border)] bg-[var(--color-bg)]">
          {has &&
            estimate.stages.map((s) => (
              <div
                key={s.groupName}
                title={`${label(s.groupName)} · ${fmtDuration(s.seconds)} · ${s.sliceNumber}×${s.repeat}`}
                style={{
                  width: `${total ? Math.max(0.75, (s.seconds / total) * 100) : 0}%`,
                  backgroundColor: CLASS_COLOR[classOf(s.groupName)],
                }}
              />
            ))}
        </div>
        <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 font-mono text-[10.5px] tabular-nums text-[var(--color-ink-muted)]">
          {has ? (
            estimate.stages.map((s) => (
              <span key={s.groupName} className="inline-flex items-center gap-1.5">
                <span
                  aria-hidden
                  className="inline-block h-2 w-2 rounded-[2px] border border-black/10"
                  style={{ backgroundColor: CLASS_COLOR[classOf(s.groupName)] }}
                />
                <span className="uppercase">{label(s.groupName)}</span>
                {s.pathCount > 1 ? `×${s.pathCount}` : ""} {fmtDuration(s.seconds)} ·{" "}
                {total ? Math.round((s.seconds / total) * 100) : 0}%
              </span>
            ))
          ) : (
            <span className="text-[var(--color-ink-subtle)]">awaiting first result…</span>
          )}
        </div>
      </div>

      {/* budget verdict + counts */}
      <div className="shrink-0 text-right">
        {has && estimate.overBudget ? (
          <Badge variant="warning">{pctText}</Badge>
        ) : (
          <span className="font-mono text-[12px] tabular-nums text-[var(--color-ink-muted)]">{pctText}</span>
        )}
        <div className="mt-1 font-mono text-[10px] tabular-nums text-[var(--color-ink-subtle)]">
          {has ? (
            <>
              baseline {fmtDuration(estimate.baselineSeconds)} · pierces {estimate.pierces} · pockets{" "}
              {estimate.pocketCount} · bands {estimate.bandCount}
              {estimate.budgetX != null && <> · budget {estimate.budgetX}×</>}
            </>
          ) : (
            <>&nbsp;</>
          )}
        </div>
      </div>
    </Card>
  );
}
