import { cn } from "../ui";
import type { GridStability } from "../color/variability";

/**
 * Small mono-caps pill that lives next to the Field-manual button on
 * both Spectrum pages. Tells the user at a glance whether the loaded
 * test has replicate-data variance worth drilling into, and how much.
 *
 *   STABILITY · ΔE 2.3 · 8 RESULTS · 3 UNSTABLE CELLS
 *
 * When the test has at most one result, the chip greys out and reads
 * "single run" — still present so users learn the feature exists
 * without uploading extra runs.
 *
 * Clickable when ``onJumpToUnstable`` is wired + there's an unstable
 * cell to jump to. Inherits the ΔE-tone convention from the rest of
 * the page (orange when anything warrants attention).
 */
export function StabilityChip({
  stability,
  onJumpToUnstable,
}: {
  stability: GridStability;
  onJumpToUnstable?: () => void;
}) {
  const hasReplicates = stability.cellsWithReplicates > 0;
  const hasUnstable = stability.unstableCount > 0;

  // Grey when nothing to say, orange when any unstable cells, slate
  // when there are replicates but no outliers — matches the tone-chip
  // language used on the per-axis residual cards.
  const tone = !hasReplicates
    ? "idle"
    : hasUnstable
      ? "warn"
      : "calm";

  const clickable = hasUnstable && onJumpToUnstable != null;

  return (
    <button
      type="button"
      onClick={clickable ? onJumpToUnstable : undefined}
      disabled={!clickable}
      title={
        clickable
          ? `Jump to first unstable cell (ΔE > 2.0, ${stability.unstableCount} total)`
          : hasReplicates
            ? `All ${stability.cellsWithReplicates} replicated cells look stable`
            : "Upload another result to see per-cell variability"
      }
      className={cn(
        "inline-flex items-center gap-2 h-8 px-3 rounded-full",
        "font-mono text-[10.5px] font-semibold tracking-[0.14em] uppercase",
        "border transition-colors",
        clickable ? "cursor-pointer" : "cursor-default",
        tone === "idle" &&
          "border-[color:var(--color-border-strong)] bg-[color:var(--color-surface-elevated)] text-[color:var(--color-ink-subtle)]",
        tone === "calm" &&
          "border-[color:var(--color-secondary)]/40 bg-[color:var(--color-secondary-tint)] text-[color:var(--color-secondary)]",
        tone === "warn" &&
          "border-[color:var(--color-primary)]/40 bg-[color:var(--color-primary-tint)] text-[color:var(--color-primary)] hover:bg-[color:var(--color-primary)] hover:text-white hover:border-[color:var(--color-primary)]",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          tone === "idle" && "bg-[color:var(--color-ink-subtle)]",
          tone === "calm" && "bg-[color:var(--color-secondary)]",
          tone === "warn" && "bg-[color:var(--color-primary)]",
        )}
      />
      <span className="opacity-70">Stability</span>
      {hasReplicates ? (
        <>
          <span className="tabular-nums">ΔE {stability.meanSpread.toFixed(1)}</span>
          <Sep />
          <span className="tabular-nums">{stability.resultCount} results</span>
          {hasUnstable && (
            <>
              <Sep />
              <span className="tabular-nums">{stability.unstableCount} unstable</span>
            </>
          )}
        </>
      ) : (
        <span>single run</span>
      )}
    </button>
  );
}

function Sep() {
  return (
    <span aria-hidden className="opacity-40 font-normal tracking-normal">
      ·
    </span>
  );
}
