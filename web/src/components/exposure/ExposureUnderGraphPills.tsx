import type { ActiveFilters } from "./exposureFilters";

type Lens = "all" | "validation" | "sweep";

interface Props {
  filters: ActiveFilters;
  onChange: (next: ActiveFilters) => void;
  /** Whether crop mode is active. When on, plain-drag on the scatter
   *  draws a marquee that zooms the viewport on release. */
  cropMode: boolean;
  onCropModeChange: (active: boolean) => void;
}

/** Compute the effective lens by collapsing testKind + validatedOnly
 *  into a single mutually-exclusive control. */
function readLens(f: ActiveFilters): Lens {
  if (f.testKind === "validation") return "validation";
  if (f.testKind === "sweep") return "sweep";
  return "all";
}

function applyLens(f: ActiveFilters, lens: Lens): ActiveFilters {
  switch (lens) {
    case "all":
      return { ...f, testKind: "all", validatedOnly: false };
    case "validation":
      return { ...f, testKind: "validation", validatedOnly: true };
    case "sweep":
      return { ...f, testKind: "sweep", validatedOnly: false };
  }
}

/** Always-visible one-click filter chips that sit directly under the
 *  scatter. Two clusters today: a Lens radio (All / Validation /
 *  Sweep) and an Outliers / brush trim toggle. The Lens folds the
 *  `testKind` + `validatedOnly` filters into a single mutually-
 *  exclusive control — most users only ever want one of the three
 *  views and tucking them in a slide-out was the wrong default. */
export function ExposureUnderGraphPills({
  filters: f, onChange, cropMode, onCropModeChange,
}: Props) {
  const lens = readLens(f);

  return (
    <div className="flex items-center gap-3 flex-wrap px-1">
      <div
        role="radiogroup"
        aria-label="lens"
        className="inline-flex border border-[color:var(--color-border)] rounded-sm overflow-hidden"
      >
        {(["all", "validation", "sweep"] as const).map((l) => {
          const active = l === lens;
          return (
            <button
              key={l}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(applyLens(f, l))}
              className={
                "whitespace-nowrap px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.16em] transition-colors " +
                (active
                  ? "bg-[color:var(--color-primary)] text-white"
                  : "bg-[color:var(--color-surface)] text-[color:var(--color-ink-muted)] hover:bg-[color:var(--color-surface-elevated)] hover:text-[color:var(--color-ink)]")
              }
            >
              {l}
            </button>
          );
        })}
      </div>

      <div className="ml-auto flex items-center gap-2">
        <button
          type="button"
          role="switch"
          aria-checked={cropMode}
          onClick={() => onCropModeChange(!cropMode)}
          title={cropMode
            ? "Crop mode on — drag a rectangle on the chart to zoom in (Esc cancels)"
            : "Drag a rectangle on the chart to zoom in"}
          className={
            "whitespace-nowrap px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.16em] rounded-sm border transition-colors " +
            (cropMode
              ? "border-[color:var(--color-primary)] text-[color:var(--color-primary)] bg-[color:var(--color-surface-elevated)]"
              : "border-[color:var(--color-border)] text-[color:var(--color-ink-muted)] hover:border-[color:var(--color-primary)]")
          }
        >
          ◰ crop
        </button>

        <button
          type="button"
          role="switch"
          aria-checked={f.trimOutliers}
          onClick={() => onChange({ ...f, trimOutliers: !f.trimOutliers })}
          title={f.trimOutliers
            ? "Bounds clamped to 1st/99th percentile — click to show outliers"
            : "Showing all data — click to clamp to 1st/99th percentile"}
          className={
            "whitespace-nowrap px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.16em] rounded-sm border transition-colors " +
            (f.trimOutliers
              ? "border-[color:var(--color-primary)] text-[color:var(--color-primary)] bg-[color:var(--color-surface-elevated)]"
              : "border-[color:var(--color-border)] text-[color:var(--color-ink-muted)] hover:border-[color:var(--color-primary)]")
          }
        >
          ⌖ trim 1/99%
        </button>

        {f.brushRange && (
          <button
            type="button"
            onClick={() => onChange({ ...f, brushRange: null })}
            title="Clear brush range"
            className="whitespace-nowrap px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.16em] rounded-sm border border-[color:var(--color-primary)] text-[color:var(--color-primary)] bg-[color:var(--color-surface-elevated)] hover:bg-[color:var(--color-surface)]"
          >
            ⌗ brush {f.brushRange[0]}–{f.brushRange[1]} ×
          </button>
        )}
      </div>
    </div>
  );
}
