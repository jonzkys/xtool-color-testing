import * as React from "react";
import type { ExposureRow, IndexRow } from "./exposureCorrelations";
import { ExposureChromaDisc } from "./ExposureChromaDisc";
import type { FamilyMember, VaryingAxis } from "./recipeFamilies";

interface Props {
  rows: readonly ExposureRow[];
  focusedId: number | null;
  /** The current X axis — emphasised in the indices readout so the
   *  user sees at a glance what the scatter is comparing. */
  highlightIndex?: IndexRow;
  onDiscHover?: (id: number) => void;
  onDiscLeave?: () => void;
  onDiscClick?: (id: number) => void;
  /** Optional: mirrors ExposurePage's exposure brush so the disc
   *  fades out-of-range entries in lockstep with the scatter. */
  dimRange?: readonly [number, number] | null;
  /** Optional: the recipe family the focused entry belongs to. */
  focusedFamily?: readonly FamilyMember[] | null;
  /** All families the focused entry belongs to (one per varying axis). */
  availableFamilies?: readonly (readonly FamilyMember[])[];
  /** Which axis filter is currently active, if any. */
  activeFilterAxis?: VaryingAxis | null;
  /** Activate a family filter for the given axis. */
  onSetFilter?: (axis: VaryingAxis, anchorRowId: number) => void;
  /** Clear the active family filter. */
  onClearFilter?: () => void;
}

const INDEX_LABELS: Record<IndexRow, string> = {
  total_exposure_index: "TOTAL_EXPOSURE",
  ablation_aggression_index: "AGGRESSION",
  delivery_smoothness_index: "SMOOTHNESS",
  pulse_intensity_index: "PULSE_INTENSITY",
  pulse_energy_index: "PULSE_ENERGY",
  pulse_spacing_mm: "PULSE_SPACING_MM",
  line_spacing_index: "LINE_SPACING",
};

const INDEX_ORDER: IndexRow[] = [
  "total_exposure_index",
  "ablation_aggression_index",
  "delivery_smoothness_index",
  "pulse_intensity_index",
  "pulse_energy_index",
  "pulse_spacing_mm",
  "line_spacing_index",
];

function fmt(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs === 0) return "0";
  if (abs < 1e-3 || abs >= 1e5) return n.toExponential(2);
  return n.toPrecision(4);
}

const PARAM_FIELDS: { key: string; label: string; suffix?: string }[] = [
  { key: "power", label: "Power", suffix: " %" },
  { key: "speed", label: "Speed", suffix: " mm/s" },
  { key: "frequency", label: "Frequency", suffix: " kHz" },
  { key: "density", label: "Density" },
  { key: "passes", label: "Passes" },
  { key: "pulse_width", label: "Pulse width", suffix: " ns" },
];

export const ExposureFocusedCard: React.FC<Props> = ({
  rows,
  focusedId,
  highlightIndex,
  onDiscHover,
  onDiscLeave,
  onDiscClick,
  dimRange,
  focusedFamily,
  availableFamilies,
  activeFilterAxis,
  onSetFilter,
  onClearFilter,
}) => {
  const focused = focusedId == null ? null : rows.find((r) => r.id === focusedId) ?? null;

  return (
    <div className="flex flex-col gap-3">
      {/* Disc — always visible. The card stays readable when nothing
          is focused so the rail doesn't collapse to a tiny stub. */}
      <div className="flex justify-center">
        <ExposureChromaDisc
          rows={rows}
          focusedId={focusedId}
          size={150}
          onHover={onDiscHover}
          onLeave={onDiscLeave}
          onClick={onDiscClick}
          dimRange={dimRange}
        />
      </div>

      {/* Swatch — only when focused. */}
      {focused && (
        <div className="flex items-center gap-2">
          <div
            className="h-9 w-9 shrink-0 rounded-[3px] border border-[color:var(--color-border-strong)]"
            style={{ background: focused.hex }}
            aria-label={`swatch ${focused.hex}`}
          />
          <div className="flex flex-col leading-tight">
            <span className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-[color:var(--color-ink-subtle)]">
              Hex
            </span>
            <span className="font-mono text-[12.5px] tabular-nums text-[color:var(--color-ink)]">
              {focused.hex.toUpperCase()}
            </span>
          </div>
        </div>
      )}

      {!focused && (
        <div className="border-t border-[color:var(--color-border)] pt-3 text-center">
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[color:var(--color-ink-subtle)]">
            Idle
          </p>
          <p className="font-mono text-[11px] text-[color:var(--color-ink-muted)] mt-1 leading-snug">
            Hover or click any dot to inspect its recipe and indices.
          </p>
        </div>
      )}

      {focused && (
        <>
          <div className="border-t border-[color:var(--color-border)] pt-3">
            <div className="font-mono text-[9.5px] uppercase tracking-[0.22em] text-[color:var(--color-ink-subtle)] font-semibold mb-2">
              Recipe
            </div>
            <div className="flex flex-col gap-1">
              {PARAM_FIELDS.map((field) => {
                const v = focused.params?.[field.key];
                if (v == null) return null;
                return (
                  <div
                    key={field.key}
                    className="flex justify-between items-baseline font-mono text-[11.5px]"
                  >
                    <span className="text-[10px] uppercase tracking-[0.16em] text-[color:var(--color-ink-subtle)]">
                      {field.label}
                    </span>
                    <span className="tabular-nums text-[color:var(--color-ink)]">
                      {String(v)}
                      {field.suffix ?? ""}
                    </span>
                  </div>
                );
              })}
            </div>
            {focused.test_id != null && (
              <a
                href={`#/tests/${focused.test_id}`}
                className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:var(--color-primary)] hover:underline mt-2 inline-block"
              >
                → Source test #{focused.test_id}
              </a>
            )}
            {focused && focusedFamily && focusedFamily.length >= 3 && (
              <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:var(--color-ink-subtle)] mt-2">
                Member of {focusedFamily.length}-entry {focusedFamily[0].varyingAxis} sweep
              </div>
            )}
          </div>

          {focused && (activeFilterAxis || (availableFamilies && availableFamilies.length > 0)) && (
            <div className="mt-3 border-t border-[color:var(--color-border)] pt-3">
              <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:var(--color-ink-subtle)] mb-2">
                {activeFilterAxis ? "Filter active" : "Filter to sweep"}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {activeFilterAxis ? (
                  <button
                    type="button"
                    onClick={onClearFilter}
                    className="px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.16em] rounded-sm border border-[color:var(--color-primary)] text-[color:var(--color-primary)] hover:bg-[color:var(--color-surface-elevated)]"
                  >
                    Clear ({activeFilterAxis})
                  </button>
                ) : (
                  (availableFamilies ?? []).map((fam) => {
                    const axis = fam[0].varyingAxis;
                    return (
                      <button
                        key={axis}
                        type="button"
                        onClick={() => onSetFilter?.(axis, focused.id)}
                        className="px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.16em] rounded-sm border border-[color:var(--color-border)] text-[color:var(--color-ink-muted)] hover:border-[color:var(--color-primary)] hover:text-[color:var(--color-primary)]"
                      >
                        {axis} ({fam.length})
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          )}

          <div className="border-t border-[color:var(--color-border)] pt-3">
            <div className="font-mono text-[9.5px] uppercase tracking-[0.22em] text-[color:var(--color-ink-subtle)] font-semibold mb-2">
              Indices
            </div>
            <div className="flex flex-col gap-1">
              {INDEX_ORDER.map((key) => {
                const isHighlighted = key === highlightIndex;
                const v =
                  key === "pulse_spacing_mm"
                    ? focused.indices.pulse_spacing_mm
                    : (focused.indices[key] as number | null);
                return (
                  <div
                    key={key}
                    className={[
                      "flex justify-between items-baseline font-mono text-[11.5px] rounded-[3px] -mx-1 px-1 py-0.5",
                      isHighlighted
                        ? "bg-[color:var(--color-primary-tint)]"
                        : "",
                    ].join(" ")}
                  >
                    <span
                      className={[
                        "text-[10px] uppercase tracking-[0.16em]",
                        isHighlighted
                          ? "text-[color:var(--color-primary)] font-semibold"
                          : "text-[color:var(--color-ink-subtle)]",
                      ].join(" ")}
                    >
                      {INDEX_LABELS[key]}
                    </span>
                    <span
                      className={[
                        "tabular-nums",
                        isHighlighted
                          ? "text-[color:var(--color-primary)] font-semibold"
                          : "text-[color:var(--color-ink)]",
                      ].join(" ")}
                    >
                      {fmt(v as number | null)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
};
