import type { AxisHelp } from "./stabilityHelpCopy";
import { StabilityHelpSchematic } from "./StabilityHelpSchematic";

/* Stability-side help card body. Lifted out of StabilityHelpTip so the
 * tip wrapper itself can become content-agnostic in a follow-up refactor.
 * Render contract is unchanged from the original `HelpCardBody`. */
export function StabilityHelpCardBody({ help }: { help: AxisHelp }) {
  return (
    <div className="px-3.5 py-3 flex flex-col gap-3" style={{ width: 340 }}>
      <div className="font-mono text-[10px] tracking-[0.18em] uppercase font-semibold text-[color:var(--color-ink-subtle)]">
        {help.heading}
      </div>
      <div className="flex items-start gap-3">
        <div className="shrink-0 pt-0.5">
          <StabilityHelpSchematic schematic={help.schematic} />
        </div>
        <div className="flex flex-col gap-2.5 min-w-0 flex-1">
          <div className="flex flex-col gap-1">
            <div className="font-mono text-[8.5px] tracking-[0.22em] uppercase font-semibold text-[color:var(--color-ink-subtle)]">
              Definition
            </div>
            <p className="font-mono text-[11.5px] leading-relaxed text-[color:var(--color-ink)] m-0">
              {help.definition}
            </p>
          </div>
          <div className="flex flex-col gap-1">
            <div className="font-mono text-[8.5px] tracking-[0.22em] uppercase font-semibold text-[color:var(--color-ink-subtle)]">
              How to read it
            </div>
            <p className="font-mono text-[11.5px] leading-relaxed text-[color:var(--color-ink-muted)] m-0">
              {help.guide}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
