import * as React from "react";
import { ListFilterPlus } from "lucide-react";
import type { ExposureRow } from "./exposureCorrelations";
import type { FamilyMember, VaryingAxis } from "./recipeFamilies";
import { type FilterableParam, FILTERABLE_PARAMS } from "./exposureFilters";

interface Props {
  rows: readonly ExposureRow[];
  focusedId: number | null;
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
  /** Optional slot rendered below the family-filter section when focused. */
  neighboursSlot?: React.ReactNode;
  /** Returns true when an `eq` clause for (param, value) is already
   *  in the active filter set. Drives the apply-filter button state. */
  hasParamValueFilter?: (param: FilterableParam, value: number) => boolean;
  /** Toggle an eq clause for (param, value). */
  onTogglePerParamFilter?: (param: FilterableParam, value: number) => void;
}

const PARAM_FIELDS: {
  key: string;
  label: string;
  suffix?: string;
  /** Optional renderer for non-numeric values (booleans, enums). */
  format?: (v: number | string | boolean) => string;
}[] = [
  { key: "power", label: "Power", suffix: " %" },
  { key: "speed", label: "Speed", suffix: " mm/s" },
  { key: "frequency", label: "Frequency", suffix: " kHz" },
  { key: "density", label: "Density" },
  { key: "passes", label: "Passes" },
  { key: "pulse_width", label: "Pulse width", suffix: " ns" },
  { key: "scan_angle", label: "Scan angle", suffix: "°" },
  { key: "crosshatch", label: "Crosshatch", format: (v) => (v ? "yes" : "no") },
  { key: "angle_mode", label: "Angle mode", format: (v) => String(v).toLowerCase() },
  { key: "unidirectional", label: "Unidirectional", format: (v) => (v ? "yes" : "no") },
];

export const ExposureFocusedCard: React.FC<Props> = ({
  rows,
  focusedId,
  focusedFamily,
  availableFamilies,
  activeFilterAxis,
  onSetFilter,
  onClearFilter,
  neighboursSlot,
  hasParamValueFilter,
  onTogglePerParamFilter,
}) => {
  const focused = focusedId == null ? null : rows.find((r) => r.id === focusedId) ?? null;

  return (
    <div className="flex flex-col gap-3">
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
                const param = field.key as FilterableParam;
                const isFilterableParam = (FILTERABLE_PARAMS as readonly string[]).includes(field.key);
                const numericValue = typeof v === "number" ? v : null;
                const isActive =
                  isFilterableParam && numericValue != null &&
                  (hasParamValueFilter?.(param, numericValue) ?? false);
                return (
                  <div
                    key={field.key}
                    data-role="recipe-row"
                    data-active={isActive ? "true" : "false"}
                    className={
                      "flex justify-between items-baseline font-mono text-[11.5px] px-1 py-0.5 rounded-sm " +
                      (isActive ? "bg-[color:var(--color-surface-elevated)]" : "")
                    }
                  >
                    <span className="text-[10px] uppercase tracking-[0.16em] text-[color:var(--color-ink-subtle)]">
                      {field.label}
                    </span>
                    <div className="flex items-baseline gap-2">
                      <span className="tabular-nums text-[color:var(--color-ink)]">
                        {field.format ? field.format(v as number | string | boolean) : String(v)}
                        {field.format ? "" : field.suffix ?? ""}
                      </span>
                      {isFilterableParam && onTogglePerParamFilter && numericValue != null && (
                        <button
                          type="button"
                          aria-pressed={isActive}
                          aria-label={
                            isActive
                              ? `Remove ${field.label.toLowerCase()} = ${numericValue} filter`
                              : `Filter scatter to ${field.label.toLowerCase()} = ${numericValue}`
                          }
                          onClick={() => onTogglePerParamFilter(param, numericValue)}
                          title={
                            isActive
                              ? `Filtering scatter to ${field.label.toLowerCase()} = ${numericValue}${field.suffix ?? ""} — click to remove`
                              : `Filter scatter to ${field.label.toLowerCase()} = ${numericValue}${field.suffix ?? ""}`
                          }
                          className={
                            "h-[20px] w-[20px] grid place-items-center rounded-sm transition-colors " +
                            (isActive
                              ? "bg-[color:var(--color-primary)] text-white"
                              : "text-[color:var(--color-ink-subtle)] hover:bg-[color:var(--color-primary-tint)] hover:text-[color:var(--color-primary)]")
                          }
                        >
                          <ListFilterPlus className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden />
                        </button>
                      )}
                    </div>
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

          {focused && neighboursSlot}
        </>
      )}
    </div>
  );
};
